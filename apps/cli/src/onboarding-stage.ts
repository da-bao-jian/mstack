import { type ProposalInput, ProposalStore } from "@mstack/proposals";
import { bindingCeremony } from "./bind-ceremony.ts";
import { readConfig } from "./config.ts";
import { Checks, configChecks } from "./preflight/checks.ts";
import { showProposal } from "./proposal-view.ts";
import type { Runtime } from "./run.ts";

export async function stageOnboarding(input: ProposalInput, rt: Runtime) {
	const checks = new Checks(rt.now);
	await configChecks(await readConfig(rt.home), checks, input.owner);
	input.preflightPlan.checks = [...checks.plan, ...input.preflightPlan.checks];
	const store = new ProposalStore(rt.home, rt.now);
	const p = await store.stage(input);
	const preview = await store.preview(p.id, async () => ({
		ok: true,
		checkedAt: rt.now(),
		checks: input.preflightPlan.checks.map((c) => ({
			route: c.route,
			name: c.name,
			...(c.route === "staged" ? { detail: c.detail } : {}),
			ok: true,
		})),
	}));
	printStaged(preview, rt);
	return preview;
}
export function printStaged(
	p: Awaited<ReturnType<ProposalStore["get"]>>,
	rt: Runtime,
) {
	if (p.submit.binding) rt.out(bindingCeremony(p));
	rt.out(showProposal(p));
	rt.out(
		`Stopped before signing. To authorize, name ${p.id} and run mob sign ${p.id}.`,
	);
}
