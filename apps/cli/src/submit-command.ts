import type { CreateTask, ResizeTask } from "@mstack/mobius-api";
import {
	ApiKeyRejected,
	ApiKeyScope,
	ApiRateLimited,
	IdempotencyConflict,
	StrategyApiClient,
} from "@mstack/mobius-api";
import { MobiusClient } from "@mstack/mobius-client";
import type { Json, Proposal } from "@mstack/proposals";
import { ProposalStore, publicText, runPreflight } from "@mstack/proposals";
import pkg from "../package.json";
import { type Config, getConfig, readConfig, UsageError } from "./config.ts";
import { cliKeyStore, keyFor } from "./key-store.ts";
import { CheckFailure, Checks, configChecks } from "./preflight/checks.ts";
import { proposalView } from "./proposal-view.ts";
import { restageProposal } from "./restage.ts";
import type { Runtime } from "./run.ts";

function taskId(route: string): string | undefined {
	return route.match(/^\/v1\/delta-neutral\/tasks\/([^/]+)\//)?.[1];
}

/**
 * Runs the stored preflight again on the exact record about to be sent, and
 * checks the body against the evidence and purpose the human was shown. The
 * record is a local file the agent's OS user can edit; the server's key caps
 * remain the hard limit.
 */
async function recheck(p: Proposal, config: Config, rt: Runtime) {
	const refuse = (reason: string): never => {
		throw new UsageError(
			`${p.id} ${reason}; nothing was sent. Run the original command again.`,
		);
	};
	// Read checks target the public Mobius API, as they did at staging.
	const result = await runPreflight(
		p,
		new MobiusClient({
			base: String(getConfig(config, "api_base")),
			version: pkg.version,
			fetch: rt.fetch,
		}),
		rt.now,
	);
	const checks = new Checks(rt.now);
	try {
		await configChecks(config, checks, p.owner, true);
	} catch (error) {
		if (!(error instanceof CheckFailure)) throw error;
	}
	const failed = [...result.checks, ...checks.checks].find((c) => !c.ok);
	if (failed)
		refuse(
			`failed its preflight again (${failed.name ?? failed.route}: ${failed.error})`,
		);
	const body = p.submit.body;
	const fact = (name: string) => {
		const check = p.preflightPlan.checks.find(
			(c) => c.route === "staged" && c.name === name,
		);
		return check && "detail" in check ? check.detail : undefined;
	};
	if (p.submit.route === "/v1/delta-neutral/tasks") {
		const legs = [
			`${body.longVenue}:${body.longMarket}`,
			`${body.shortVenue}:${body.shortMarket}`,
		];
		const venues = fact("key.venues")?.match(/^covered · (.+)$/)?.[1];
		const cap = fact("key.maxSizeUsd")?.match(/^(\S+) <= /)?.[1];
		const shown = /^Open \S+: long (\S+), short (\S+), \$(\S+) per leg$/.exec(
			p.purpose,
		);
		if (
			(venues !== undefined &&
				venues !== `${body.longVenue}, ${body.shortVenue}`) ||
			(cap !== undefined && Number(cap) !== body.sizeUsd) ||
			(shown &&
				(shown[1] !== legs[0] ||
					shown[2] !== legs[1] ||
					Number(shown[3]) !== body.sizeUsd))
		)
			refuse("no longer matches the request its preflight checked");
		return `long ${legs[0]} · short ${legs[1]} · $${body.sizeUsd} per leg`;
	}
	const task = taskId(p.submit.route);
	if (
		!task ||
		!p.purpose.startsWith(
			`${p.submit.route.slice(p.submit.route.lastIndexOf("/") + 1)} task ${task}.`,
		) ||
		p.preflightPlan.checks.some(
			(c) =>
				c.route === "/api/arbitrage/task" &&
				(c.params as { taskId?: string }).taskId !== task,
		)
	)
		refuse("no longer matches the request its preflight checked");
	return [
		`task ${task}`,
		...["longTargetBase", "shortTargetBase"]
			.filter((key) => body[key] !== undefined)
			.map((key) => `${key} ${body[key]}`),
	].join(" · ");
}

export async function submitCommand(
	id: string,
	json: boolean,
	rt: Runtime,
): Promise<void> {
	const store = new ProposalStore(rt.home, rt.now, rt.err);
	// An expired Proposal is restaged under a new id that needs new consent.
	if (
		(await store.get(id)).status === "expired" &&
		(await restageProposal(id, rt))
	)
		return;
	// Existence and terminal/expiry checks happen in submitApi before policy or key use.
	await store.assertSignable(id);
	const config = await readConfig(rt.home);
	let client: StrategyApiClient | undefined;
	try {
		const result = await store.submitApi(id, {
			policy: config.policy ?? "manual",
			prepare: async (proposal) => {
				const request = await recheck(proposal, config, rt);
				const stored = await (await cliKeyStore(rt)).get(proposal.owner);
				if (!stored) throw new UsageError("no key: run mob onboard");
				client = new StrategyApiClient({
					base: proposal.submit.base,
					key: keyFor(stored, proposal.submit.base),
					version: pkg.version,
					fetch: rt.fetch,
					now: rt.now,
				});
				// The final request, printed before anything is sent.
				(json ? rt.err : rt.out)(
					publicText(
						`Sending ${id}: POST ${proposal.submit.route} · ${request}`,
					),
				);
			},
			submit: async (proposal) => {
				if (!client) throw new Error("API key client was not prepared");
				const options = {
					idempotencyKey: proposal.submit.idempotencyKey as string,
					signal: rt.signal,
				};
				if (proposal.submit.route === "/v1/delta-neutral/tasks")
					return (await client.createTask(
						proposal.submit.body as unknown as CreateTask,
						options,
					)) as unknown as Json;
				const current = taskId(proposal.submit.route);
				if (!current) throw new Error("Invalid Strategy API route");
				if (proposal.submit.route.endsWith("/cancel"))
					return (await client.cancelTask(current, options)) as unknown as Json;
				if (proposal.submit.route.endsWith("/close"))
					return (await client.closeTask(current, options)) as unknown as Json;
				if (proposal.submit.route.endsWith("/resize"))
					return (await client.resizeTask(
						current,
						proposal.submit.body as ResizeTask,
						options,
					)) as unknown as Json;
				throw new Error("Invalid Strategy API route");
			},
		});
		if (json) {
			rt.out(JSON.stringify(proposalView(result), null, 2));
			return;
		}
		const answer = result.answer as Record<string, unknown>;
		rt.out(
			`${id}: accepted, not executed; \`mob status\` shows the worker state (task ${answer.taskId}, status ${answer.status}).`,
		);
	} catch (error) {
		if (error instanceof ApiKeyRejected)
			throw new UsageError("key rejected; run `mob keys show`");
		if (error instanceof ApiKeyScope)
			throw new UsageError(error.serverError ?? error.message);
		if (error instanceof ApiRateLimited)
			throw new UsageError(
				`rate limited; Retry-After: ${error.retryAfterSeconds ?? "not provided"} seconds`,
			);
		if (error instanceof IdempotencyConflict) {
			const current = error.taskId;
			if (current && client) {
				const task = await client.getTask(current);
				rt.out(
					`Idempotency conflict; current task ${task.taskId} is ${task.status}.`,
				);
				return;
			}
			throw new UsageError(error.serverError ?? error.message);
		}
		throw error;
	}
}
