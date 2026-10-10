import type { MobiusClient } from "@mstack/mobius-client";
import { canonical, type PreflightResult, type Proposal } from "./model.ts";
/** A serializable read-and-assert plan; no executable code is loaded from disk. */
export async function runPreflight(
	p: Proposal,
	client: MobiusClient,
	now = Date.now,
): Promise<PreflightResult> {
	const checks: PreflightResult["checks"] = [];
	for (const check of p.preflightPlan.checks) {
		try {
			const answer = await client.read(check.route, check.params);
			for (const assertion of check.assertions) {
				let value: unknown = answer;
				for (const field of assertion.path) {
					if (
						!value ||
						typeof value !== "object" ||
						!Object.hasOwn(value, field)
					)
						throw new Error(
							`Preflight field missing: ${assertion.path.join(".")}`,
						);
					value = (value as Record<string, unknown>)[field];
				}
				if (canonical(value) !== canonical(assertion.equals))
					throw new Error(
						`Preflight assertion failed: ${assertion.path.join(".")}`,
					);
			}
			checks.push({ route: check.route, ok: true });
		} catch (error) {
			checks.push({
				route: check.route,
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return { ok: checks.every((c) => c.ok), checkedAt: now(), checks };
}
