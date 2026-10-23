import {
	type AssetClass,
	groupAssets,
	type OpportunityLeg,
	type RwaCategory,
	rankOpportunities,
	rankPriceGaps,
	VENUE_INFO,
	venueKey,
	venueKind,
} from "@mstack/opportunities";
import { getConfig, numberFlag, readConfig, UsageError } from "../config.ts";
import { priceView, scanView } from "../scan-view.ts";
import { category } from "./markets.ts";
import { pairKey, type Realized, realizedSpreads } from "./realized.ts";
import {
	base,
	type Runtime,
	selectedVenues,
	snapshot,
	withRateCount,
} from "./runtime.ts";

export interface ScanOptions {
	sizeUsd?: number;
	market?: string;
	venues?: readonly string[];
	topExec?: number;
	top?: number;
	allPairs?: boolean;
	executable?: boolean;
	minApy?: number;
	minVolume24hUsd?: number;
	includeThin?: boolean;
	includeCrossDeployment?: boolean;
	holdDays?: number;
	includeFull?: boolean;
	kind?: string;
	anchor?: string;
	minOpenInterestUsd?: number;
	/** Add settled funding spreads over 1, 7 and 30 days to the shown pairs. */
	realized?: boolean;
	rwa?: boolean;
	crypto?: boolean;
	category?: string;
}

type Leg = Pick<OpportunityLeg, "venue" | "market" | "openInterestUsd">;

/** The leg filters shared by funding and price scans. */
function legFilter(
	options: ScanOptions,
	classes: Map<string, { class: AssetClass; category?: RwaCategory }>,
): (long: Leg, short: Leg) => boolean {
	if (
		options.kind !== undefined &&
		options.kind !== "dex" &&
		options.kind !== "cex"
	)
		throw new UsageError("--kind must be dex or cex");
	if (
		options.anchor !== undefined &&
		!Object.hasOwn(VENUE_INFO, options.anchor)
	)
		throw new UsageError(
			`--anchor must be one of ${Object.keys(VENUE_INFO).join(",")}`,
		);
	if (options.rwa && options.crypto)
		throw new UsageError("Choose --rwa or --crypto, not both");
	const wanted = category(options.category);
	const minOi =
		options.minOpenInterestUsd === undefined
			? undefined
			: numberFlag(options.minOpenInterestUsd, "min-oi", 0);
	const rwa = options.rwa === true || wanted !== undefined;
	return (long, short) => {
		const legs = [long, short];
		if (
			options.kind &&
			legs.some((leg) => venueKind(leg.venue) !== options.kind)
		)
			return false;
		if (
			options.anchor &&
			!legs.some(
				(leg) =>
					leg.venue === options.anchor ||
					venueKey(leg.venue, leg.market) === options.anchor,
			)
		)
			return false;
		// A venue that publishes no open interest cannot pass a minimum.
		if (
			minOi !== undefined &&
			legs.some((leg) => (leg.openInterestUsd ?? -1) < minOi)
		)
			return false;
		const asset = classes.get(`${long.venue}:${long.market}`);
		if (rwa && asset?.class !== "rwa") return false;
		if (options.crypto && asset?.class !== "crypto") return false;
		if (wanted && asset?.category !== wanted) return false;
		return true;
	};
}

function viewLimit(value: number, name: string): number {
	if (value > 200) throw new UsageError(`${name} is capped at 200`);
	return numberFlag(value, name, 1, true);
}

/** Class and category of every row, by venue:market, from the asset model. */
function assetClasses(
	options: ScanOptions,
	rates: Parameters<typeof groupAssets>[0],
) {
	const classes = new Map<
		string,
		{ class: AssetClass; category?: RwaCategory }
	>();
	// Grouping every listing costs a pass over the snapshot; skip it unless a
	// class filter needs it.
	if (!options.rwa && !options.crypto && options.category === undefined)
		return classes;
	for (const asset of groupAssets(rates).assets)
		for (const row of asset.rows)
			classes.set(`${row.venue}:${row.market}`, {
				class: asset.class,
				...(asset.category ? { category: asset.category } : {}),
			});
	return classes;
}

function common(
	options: ScanOptions,
	config: Awaited<ReturnType<typeof readConfig>>,
) {
	return {
		venues: selectedVenues(options.venues),
		market: base(options.market),
		top: viewLimit(options.top ?? 10, "top"),
		topExec: viewLimit(options.topExec ?? 5, "top-exec"),
		minVolume24hUsd: numberFlag(
			options.minVolume24hUsd ?? 1_000_000,
			"min-volume",
			0,
		),
		config,
	};
}

/** Attach realized spreads to every shown row, reading each leg once. */
async function withRealized<
	T extends {
		long: { venue: string; market: string };
		short: { venue: string; market: string };
	},
>(
	view: { executable: T[]; anywhere: T[] },
	enabled: boolean | undefined,
	rt: Runtime,
): Promise<{
	executable: (T & { realized?: Realized })[];
	anywhere: (T & { realized?: Realized })[];
}> {
	if (!enabled) return view;
	const realized = await realizedSpreads(
		[...view.executable, ...view.anywhere],
		rt,
	);
	const add = (rows: T[]) =>
		rows.map((row) => ({ ...row, realized: realized.get(pairKey(row)) }));
	return { executable: add(view.executable), anywhere: add(view.anywhere) };
}

/** `mob scan --by price`: same-asset pairs by mark-price gap, widest first. */
export async function priceScan(options: ScanOptions, rt: Runtime) {
	const { venues, market, top, topExec, minVolume24hUsd, config } = common(
		options,
		await readConfig(rt.home),
	);
	const input = await snapshot(venues, rt);
	const keep = legFilter(options, assetClasses(options, input.rates));
	const gaps = rankPriceGaps(input, {
		takerFeeBps: config.taker_fee_bps,
		minVolume24hUsd,
	}).filter(
		(row) =>
			keep(row.long, row.short) &&
			(!market || row.base === market) &&
			(!options.executable || row.executable),
	);
	const { view, thinHidden, crossDeploymentHidden, mismatchHidden } = priceView(
		gaps,
		{
			top,
			topExec,
			allPairs: options.allPairs === true,
			executable: options.executable === true,
			includeThin: options.includeThin === true,
			includeCrossDeployment: options.includeCrossDeployment === true,
		},
	);
	return withRateCount(
		{
			by: "price" as const,
			priceBasis: "mark" as const,
			observedAt: input.observedAt,
			source: input.source,
			annualizationMethod: input.annualizationMethod,
			counts: {
				rates: input.rates.length,
				pairs: gaps.length,
				executable: gaps.filter((row) => row.executable).length,
				thinHidden,
				crossDeploymentHidden,
				mismatchHidden,
			},
			failed: input.failed,
			view: await withRealized(view, options.realized, rt),
		},
		input.rates.length,
	);
}

export async function scan(options: ScanOptions, rt: Runtime) {
	const { venues, market, top, topExec, minVolume24hUsd, config } = common(
		options,
		await readConfig(rt.home),
	);
	const sizeUsd = numberFlag(
		options.sizeUsd ?? Number(getConfig(config, "default_size_usd")),
		"size",
		Number.MIN_VALUE,
	);
	const holdDays = numberFlag(
		options.holdDays ?? 7,
		"hold-days",
		Number.MIN_VALUE,
	);
	const minApy =
		options.minApy === undefined
			? undefined
			: numberFlag(options.minApy, "min-apy", -Number.MAX_VALUE);
	const input = await snapshot(venues, rt);
	const keep = legFilter(options, assetClasses(options, input.rates));
	const ranked = rankOpportunities(input, {
		sizeUsd,
		holdDays,
		minVolume24hUsd,
		takerFeeBps: config.taker_fee_bps,
		builderFeeTenthsBps: Number(getConfig(config, "builder_fee_tenths_bps")),
	});
	const result = {
		...ranked,
		opportunities: ranked.opportunities.filter((row) =>
			keep(row.long, row.short),
		),
	};
	const { view, thinHidden, crossDeploymentHidden, mismatchHidden } = scanView(
		result,
		{
			market,
			top,
			topExec,
			allPairs: options.allPairs === true,
			executable: options.executable === true,
			minApy,
			includeThin: options.includeThin === true,
			includeCrossDeployment: options.includeCrossDeployment === true,
		},
	);
	return withRateCount(
		{
			sizeUsd,
			holdDays: result.holdDays,
			observedAt: result.observedAt,
			source: result.source,
			annualizationMethod: result.annualizationMethod,
			counts: {
				rates: input.rates.length,
				opportunities: result.opportunities.length,
				qualifying: result.opportunities.filter((row) => row.qualifies).length,
				executable: result.opportunities.filter((row) => row.executable).length,
				thinHidden,
				crossDeploymentHidden,
				mismatchHidden,
				unmatched: result.unmatched.length,
			},
			failed: result.failed,
			unmatched: result.unmatched,
			view: await withRealized(view, options.realized, rt),
			...(options.includeFull ? { opportunities: result.opportunities } : {}),
		},
		input.rates.length,
	);
}
