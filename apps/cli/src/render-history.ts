import type { history } from "./commands/history.ts";
import { footer, pct, table } from "./render.ts";

export function renderHistory(
	data: Awaited<ReturnType<typeof history>>,
	now: number,
) {
	const { history, unsupported, missing, bestPair, failed, unmatched } = data;
	const human = [
		table(
			[
				"venue:market",
				"samples",
				"hours",
				"avg/hour",
				"annualized",
				"min/hour",
				"max/hour",
			],
			history.map((r) => [
				`${r.venue}:${r.market}`,
				r.sampleCount,
				r.hoursCovered.toFixed(2),
				pct(
					r.averageRatePerHour === null ? null : r.averageRatePerHour * 100,
					6,
				),
				pct(r.annualizedPct, 2),
				pct(r.minRatePerHour === null ? null : r.minRatePerHour * 100, 6),
				pct(r.maxRatePerHour === null ? null : r.maxRatePerHour * 100, 6),
			]),
		),
		...[...unsupported, ...missing].map((r) => `${r.venue}: ${r.reason}`),
		bestPair
			? `Best average spread: long ${bestPair.long} / short ${bestPair.short}: ${pct(bestPair.spreadRate1hPct, 6)}/hour, ${pct(bestPair.spreadAnnualizedPct, 2)}/year (gross; coverage can differ)`
			: "Best average spread: unavailable",
	].join("\n");
	return {
		human,
		ending: footer(
			{
				...data,
				failed: failed.map((f) => ({
					venue: f.market ? `${f.venue}:${f.market}` : f.venue,
					error: f.error,
				})),
			},
			unmatched.length,
			now,
		),
	};
}
