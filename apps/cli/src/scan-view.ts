import type { Opportunity, RankedOpportunities } from "@mstack/opportunities";

export interface ViewOptions {
	market?: string;
	top: number;
	topExec?: number;
	allPairs: boolean;
	executable: boolean;
	minApy?: number;
	includeThin?: boolean;
}

export function scanView(
	result: RankedOpportunities,
	options: ViewOptions,
): {
	view: { executable: Opportunity[]; anywhere: Opportunity[] };
	thinHidden: number;
} {
	const candidates = result.opportunities.filter(
		(r) =>
			(!options.market || r.base === options.market) &&
			(!options.executable || r.executable) &&
			(options.minApy === undefined || r.spreadAnnualizedPct >= options.minApy),
	);
	const rows = candidates.filter(
		(r) => options.includeThin || !r.flags.includes("thin"),
	);
	const thinHidden = candidates.length - rows.length;
	rows.sort((a, b) => {
		if (a.netApyPct === null) return b.netApyPct === null ? 0 : 1;
		if (b.netApyPct === null) return -1;
		return b.netApyPct - a.netApyPct;
	});
	const select = (candidates: Opportunity[], limit: number) => {
		const seen = new Set<string>();
		return candidates
			.filter((r) => {
				if (options.allPairs) return true;
				if (seen.has(r.base)) return false;
				seen.add(r.base);
				return true;
			})
			.slice(0, limit);
	};
	const view = {
		executable: select(
			rows.filter((r) => r.executable),
			options.executable ? options.top : (options.topExec ?? 5),
		),
		anywhere: options.executable ? [] : select(rows, options.top),
	};
	return { view, thinHidden };
}
