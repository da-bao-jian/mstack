import { MobiusClient } from "@mstack/mobius-client";
import {
	type Proposal,
	type ProposalInput,
	runPreflight,
} from "@mstack/proposals";
import pkg from "../package.json";
import { readConfig } from "./config.ts";
import { stageOnboarding } from "./onboarding-stage.ts";
import { Checks, configChecks } from "./preflight/checks.ts";
import type { Runtime } from "./run.ts";

/** Refresh only the two non-trading intents. The new id always needs new consent. */
export async function refreshExpired(
	p: Proposal,
	rt: Runtime,
): Promise<boolean> {
	const legal =
		p.submit.route === "/legal/acceptance" && p.signing.type === "typed";
	const prepare =
		/^\/api\/binding\/(hl|aster|lighter)\/prepare$/.test(p.submit.route) &&
		p.signing.type === "text" &&
		p.submit.binding?.step === "prepare";
	if (
		p.status !== "expired" ||
		p.signatureAttemptedAt !== undefined ||
		p.signature ||
		(!legal && !prepare)
	)
		return false;
	await configChecks(await readConfig(rt.home), new Checks(rt.now), p.owner);
	const fresh: ProposalInput = structuredClone({
		kind: p.kind,
		owner: p.owner,
		purpose: p.purpose,
		signing: p.signing,
		submit: p.submit,
		preflightPlan: p.preflightPlan,
	});
	const timestamp = Math.floor(rt.now() / 1000);
	if (legal && fresh.signing.type === "typed") {
		fresh.submit.body.signedAt = timestamp;
		fresh.signing.typedData.message = {
			...fresh.signing.typedData.message,
			signedAt: timestamp,
		};
	} else if (fresh.signing.type === "text") {
		const nonce = crypto.randomUUID();
		const previous = `nonce=${p.submit.body.nonce} timestamp=${p.submit.body.timestamp}`;
		if (!fresh.signing.message.includes(previous))
			throw new Error(
				"Cannot refresh binding: signing timestamp/nonce do not match intent",
			);
		fresh.signing.message = fresh.signing.message.replace(
			previous,
			`nonce=${nonce} timestamp=${timestamp}`,
		);
		Object.assign(fresh.submit.body, { nonce, timestamp });
	}
	const checks = await runPreflight(
		{
			...p,
			createdAt: timestamp * 1000,
			expiresAt: timestamp * 1000 + 300_000,
		},
		new MobiusClient({
			base: p.submit.base,
			version: pkg.version,
			fetch: rt.fetch,
		}),
		rt.now,
	);
	if (!checks.ok)
		throw new Error(
			`Cannot refresh ${p.id}: ${checks.checks
				.filter((c) => !c.ok)
				.map((c) => c.error)
				.join("; ")}`,
		);
	fresh.preflightPlan.checks = fresh.preflightPlan.checks.filter(
		(c) => !c.name?.startsWith("config."),
	);
	rt.out(`${p.id} is expired; staging the same intent for fresh approval.`);
	await stageOnboarding(fresh, rt);
	return true;
}
