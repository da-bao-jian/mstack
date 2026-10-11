export const API_BUDGET_MS = 15_000;
const API_SLOW_MS = 3000;
export function reachability(latencyMs: number): "ok" | "slow" {
	return latencyMs >= API_SLOW_MS ? "slow" : "ok";
}
export function reachabilityLabel(latencyMs: number): string {
	return `${reachability(latencyMs)} · ${latencyMs >= 1000 ? `${(latencyMs / 1000).toFixed(1)} s` : `${latencyMs} ms`}`;
}
