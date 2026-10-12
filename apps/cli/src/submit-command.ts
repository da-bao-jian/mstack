import type { CreateTask, ResizeTask } from "@mstack/mobius-api";
import {
	ApiKeyRejected,
	ApiKeyScope,
	ApiRateLimited,
	IdempotencyConflict,
	StrategyApiClient,
} from "@mstack/mobius-api";
import type { Json } from "@mstack/proposals";
import { ProposalStore } from "@mstack/proposals";
import pkg from "../package.json";
import { readConfig, UsageError } from "./config.ts";
import { cliKeyStore } from "./key-store.ts";
import { proposalView } from "./proposal-view.ts";
import type { Runtime } from "./run.ts";

function taskId(route: string): string | undefined {
	return route.match(/^\/v1\/delta-neutral\/tasks\/([^/]+)\//)?.[1];
}

export async function submitCommand(
	id: string,
	json: boolean,
	rt: Runtime,
): Promise<void> {
	const store = new ProposalStore(rt.home, rt.now, rt.err);
	// Existence and terminal/expiry checks happen in submitApi before policy or key use.
	await store.assertSignable(id);
	const config = await readConfig(rt.home);
	let client: StrategyApiClient | undefined;
	try {
		const result = await store.submitApi(id, {
			policy: config.policy ?? "manual",
			prepare: async (proposal) => {
				const stored = await (await cliKeyStore(rt)).get(proposal.owner);
				if (!stored) throw new UsageError("no key: run mob onboard");
				client = new StrategyApiClient({
					base: proposal.submit.base,
					key: stored.key,
					version: pkg.version,
					fetch: rt.fetch,
					now: rt.now,
				});
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
