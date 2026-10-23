import type {
	Opportunity,
	PriceGap,
	RankedOpportunities,
} from "@mstack/opportunities";

export interface ViewOptions {
	market?: string;
	top: number;
	topExec?: number;
	allPairs: boolean;
	executable: boolean;
	minApy?: number;
	includeThin?: boolean;
	includeCrossDeployment?: boolean;
}

export function scanView(
	result: RankedOpportunities,
	options: ViewOptions,
): {
	view: { executable: Opportunity[]; anywhere: Opportunity[] };
	thinHidden: number;
	crossDeploymentHidden: number;
	mismatchHidden: number;
} {
	// Prices too far apart to be one asset (BB the stock and BB the token).
	const mismatchHidden = result.opportunities.filter((r) =>
		r.flags.includes("price-mismatch"),
	).length;
	const candidates = result.opportunities.filter(
		(r) =>
			(!options.market || r.base === options.market) &&
			(!options.executable || r.executable) &&
			(options.minApy === undefined ||
				r.spreadAnnualizedPct >= options.minApy) &&
			!r.flags.includes("price-mismatch"),
	);
	const liquid = candidates.filter(
		(r) => options.includeThin || !r.flags.includes("thin"),
	);
	const thinHidden = candidates.length - liquid.length;
	const crossDeploymentHidden = options.includeCrossDeployment
		? 0
		: liquid.filter((r) => r.flags.includes("cross-deployment")).length;
	const rows = liquid.filter(
		(r) =>
			options.includeCrossDeployment || !r.flags.includes("cross-deployment"),
	);
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
			rows.filter(
				(r) =>
					r.executable &&
					(options.includeCrossDeployment ||
						!r.flags.includes("cross-deployment")),
			),
			options.executable ? options.top : (options.topExec ?? 5),
		),
		anywhere: options.executable ? [] : select(rows, options.top),
	};
	return { view, thinHidden, crossDeploymentHidden, mismatchHidden };
}

/** Price gaps arrive widest first; the same thin, deployment and per-base rules apply. */
export function priceView(
	gaps: PriceGap[],
	options: Omit<ViewOptions, "market" | "minApy">,
): {
	view: { executable: PriceGap[]; anywhere: PriceGap[] };
	thinHidden: number;
	crossDeploymentHidden: number;
} {
	const liquid = gaps.filter(
		(r) => options.includeThin || !r.flags.includes("thin"),
	);
	const rows = liquid.filter(
		(r) =>
			options.includeCrossDeployment || !r.flags.includes("cross-deployment"),
	);
	const select = (candidates: PriceGap[], limit: number) => {
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
	return {
		view: {
			executable: select(
				rows.filter((r) => r.executable),
				options.executable ? options.top : (options.topExec ?? 5),
			),
			anywhere: options.executable ? [] : select(rows, options.top),
		},
		thinHidden: gaps.length - liquid.length,
		crossDeploymentHidden: liquid.length - rows.length,
	};
}
