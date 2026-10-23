import type { ObservedFundingRate, Snapshot } from "@mstack/funding";
import {
	type Asset,
	type AssetRow,
	canonicalTicker,
	groupAssets,
	MOB_VENUES,
	RWA_CATEGORIES,
	type RwaCategory,
	rankOpportunities,
	VENUE_INFO,
	type VenueKind,
	venueKey,
} from "@mstack/opportunities";
import { getConfig, numberFlag, readConfig, UsageError } from "../config.ts";
import {
	snapshot as fetchInput,
	type Runtime,
	selectedVenues,
	withRateCount,
} from "./runtime.ts";

const HOUR = 3_600_000;

/** Sum a field over rows; undefined when no row reports it. */
function total(
	rows: readonly ObservedFundingRate[],
	field: "volume24hUsd" | "openInterestUsd",
): { value?: number; missing: number } {
	const known = rows.filter((row) => row[field] !== undefined);
	return {
		...(known.length
			? { value: known.reduce((sum, row) => sum + (row[field] ?? 0), 0) }
			: {}),
		missing: rows.length - known.length,
	};
}

function header(input: Snapshot) {
	return {
		observedAt: input.observedAt,
		source: input.source,
		annualizationMethod: input.annualizationMethod,
		failed: input.failed,
	};
}

interface VenueRow {
	venue: string;
	name: string;
	kind: VenueKind;
	mob: boolean;
	markets: number;
	volume24hUsd?: number;
	/** Markets that report no 24h volume, so the sum is a lower bound. */
	missingVolume: number;
	openInterestUsd?: number;
	missingOpenInterest: number;
	/** The documented estimate, or the user's taker_fee_bps override. */
	takerFeeBps: number;
}

export async function venues(options: { kind?: string }, rt: Runtime) {
	const config = await readConfig(rt.home);
	if (
		options.kind !== undefined &&
		options.kind !== "dex" &&
		options.kind !== "cex"
	)
		throw new UsageError("--kind must be dex or cex");
	const input = await fetchInput(selectedVenues(), rt);
	const byKey = new Map<string, ObservedFundingRate[]>();
	for (const row of input.rates) {
		const key = venueKey(row.venue, row.market);
		byKey.set(key, [...(byKey.get(key) ?? []), row]);
	}
	const view: VenueRow[] = [...byKey]
		.flatMap(([key, rows]) => {
			const info = VENUE_INFO[key];
			if (!info || (options.kind && info.kind !== options.kind)) return [];
			const venue = rows[0].venue;
			const volume = total(rows, "volume24hUsd");
			const oi = total(rows, "openInterestUsd");
			return [
				{
					venue: key,
					name: info.name,
					kind: info.kind,
					mob: MOB_VENUES.includes(venue),
					markets: rows.length,
					...(volume.value === undefined ? {} : { volume24hUsd: volume.value }),
					missingVolume: volume.missing,
					...(oi.value === undefined ? {} : { openInterestUsd: oi.value }),
					missingOpenInterest: oi.missing,
					takerFeeBps: Number(getConfig(config, `taker_fee_bps.${venue}`)),
				},
			];
		})
		.sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
	const volume = total(input.rates, "volume24hUsd");
	const oi = total(input.rates, "openInterestUsd");
	return withRateCount(
		{
			...header(input),
			totals: {
				...(volume.value === undefined ? {} : { volume24hUsd: volume.value }),
				missingVolume: volume.missing,
				...(oi.value === undefined ? {} : { openInterestUsd: oi.value }),
				missingOpenInterest: oi.missing,
			},
			view,
		},
		input.rates.length,
	);
}

export interface AssetView {
	ticker: string;
	variant: number;
	name?: string;
	class: Asset["class"];
	category?: RwaCategory;
	venues: number;
	markets: number;
	price?: number;
	volume24hUsd?: number;
	missingVolume: number;
	openInterestUsd?: number;
	missingOpenInterest: number;
	bestFunding: { venue: string; market: string; annualizedPct: number };
}

function assetView(asset: Asset): AssetView {
	return {
		ticker: asset.ticker,
		variant: asset.variant,
		...(asset.name ? { name: asset.name } : {}),
		class: asset.class,
		...(asset.category ? { category: asset.category } : {}),
		venues: new Set(asset.rows.map((row) => venueKey(row.venue, row.market)))
			.size,
		markets: asset.rows.length,
		...(asset.price === undefined ? {} : { price: asset.price }),
		...(asset.volume24hUsd === undefined
			? {}
			: { volume24hUsd: asset.volume24hUsd }),
		missingVolume: asset.missingVolume,
		...(asset.openInterestUsd === undefined
			? {}
			: { openInterestUsd: asset.openInterestUsd }),
		missingOpenInterest: asset.missingOpenInterest,
		bestFunding: {
			venue: asset.best.venue,
			market: asset.best.market,
			annualizedPct: asset.best.annualizedPct,
		},
	};
}

const SORTS = {
	volume: (a: AssetView, b: AssetView) =>
		(b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0),
	oi: (a: AssetView, b: AssetView) =>
		(b.openInterestUsd ?? 0) - (a.openInterestUsd ?? 0),
	apr: (a: AssetView, b: AssetView) =>
		Math.abs(b.bestFunding.annualizedPct) -
		Math.abs(a.bestFunding.annualizedPct),
	venues: (a: AssetView, b: AssetView) => b.venues - a.venues,
} as const;

export interface MarketsOptions {
	rwa?: boolean;
	crypto?: boolean;
	category?: string;
	search?: string;
	top?: number;
	sort?: string;
	minVolume24hUsd?: number;
}

export function category(value: string | undefined): RwaCategory | undefined {
	if (value === undefined) return undefined;
	const name =
		value.toLowerCase() === "preipo" ? "pre-ipo" : value.toLowerCase();
	if (!(RWA_CATEGORIES as readonly string[]).includes(name))
		throw new UsageError(
			`--category must be one of ${RWA_CATEGORIES.join(", ")}`,
		);
	return name as RwaCategory;
}

export async function markets(options: MarketsOptions, rt: Runtime) {
	const config = await readConfig(rt.home);
	if (options.rwa && options.crypto)
		throw new UsageError("Choose --rwa or --crypto, not both");
	const wanted = category(options.category);
	const rwa = options.rwa === true || wanted !== undefined;
	const sort = options.sort ?? "volume";
	if (!Object.hasOwn(SORTS, sort))
		throw new UsageError(
			`--sort must be one of ${Object.keys(SORTS).join(", ")}`,
		);
	const top = numberFlag(options.top ?? 25, "top", 1, true);
	if (top > 500) throw new UsageError("top is capped at 500");
	const minVolume = numberFlag(options.minVolume24hUsd ?? 0, "min-volume", 0);
	const search = options.search?.trim().toUpperCase();
	const input = await fetchInput(selectedVenues(), rt);
	const { assets, unmatched } = groupAssets(input.rates);
	const all = assets.map(assetView);
	const scoped = all.filter(
		(asset) =>
			(!rwa || asset.class === "rwa") &&
			(!options.crypto || asset.class === "crypto") &&
			(!wanted || asset.category === wanted),
	);
	const matching = scoped
		.filter(
			(asset) =>
				(asset.volume24hUsd ?? 0) >= minVolume &&
				(!search ||
					asset.ticker.startsWith(search) ||
					asset.name?.toUpperCase().includes(search)),
		)
		.sort(SORTS[sort as keyof typeof SORTS]);
	const sum = (field: "volume24hUsd" | "openInterestUsd") =>
		scoped.reduce((value, asset) => value + (asset[field] ?? 0), 0);
	const categories = rwa
		? RWA_CATEGORIES.map((name) => {
				const members = scoped.filter((asset) => asset.category === name);
				return {
					category: name,
					assets: members.length,
					volume24hUsd: members.reduce((v, a) => v + (a.volume24hUsd ?? 0), 0),
					openInterestUsd: members.reduce(
						(v, a) => v + (a.openInterestUsd ?? 0),
						0,
					),
				};
			}).filter((row) => row.assets > 0)
		: undefined;
	let farm: ReturnType<typeof farmPair> | undefined;
	if (rwa) {
		const keys = new Set(
			assets
				.filter((asset) => asset.class === "rwa")
				.flatMap((asset) =>
					asset.rows.map((row) => `${row.venue}:${row.market}`),
				),
		);
		farm = farmPair(
			input,
			keys,
			Number(getConfig(config, "default_size_usd")),
			config,
		);
	}
	return withRateCount(
		{
			...header(input),
			scope: rwa
				? ("rwa" as const)
				: options.crypto
					? ("crypto" as const)
					: ("all" as const),
			counts: {
				assets: scoped.length,
				matching: matching.length,
				rwa: all.filter((asset) => asset.class === "rwa").length,
				crypto: all.filter((asset) => asset.class === "crypto").length,
			},
			totals: {
				volume24hUsd: sum("volume24hUsd"),
				openInterestUsd: sum("openInterestUsd"),
				missingOpenInterest: scoped.reduce(
					(n, a) => n + a.missingOpenInterest,
					0,
				),
			},
			...(categories ? { categories } : {}),
			...(farm ? { farm } : {}),
			unmatched,
			view: matching.slice(0, top),
		},
		input.rates.length,
	);
}

/** The best liquid RWA funding pair, as a pointer into the scanner. */
function farmPair(
	input: Snapshot,
	keys: Set<string>,
	sizeUsd: number,
	config: Awaited<ReturnType<typeof readConfig>>,
) {
	const ranked = rankOpportunities(
		{
			...input,
			rates: input.rates.filter((row) =>
				keys.has(`${row.venue}:${row.market}`),
			),
		},
		{
			sizeUsd,
			takerFeeBps: config.taker_fee_bps,
			builderFeeTenthsBps: Number(getConfig(config, "builder_fee_tenths_bps")),
		},
	);
	const best = ranked.opportunities.find(
		(row) =>
			!row.flags.includes("thin") && !row.flags.includes("price-mismatch"),
	);
	return best
		? {
				base: best.base,
				long: `${best.long.venue}:${best.long.market}`,
				short: `${best.short.venue}:${best.short.market}`,
				spreadAnnualizedPct: best.spreadAnnualizedPct,
				netApyPct: best.netApyPct,
				executable: best.executable,
			}
		: undefined;
}

export interface MarketRow {
	venue: string;
	market: string;
	price?: number;
	volume24hUsd?: number;
	openInterestUsd?: number;
	ratePerInterval: number;
	intervalHours: number;
	annualizedPct: number;
	nextFundingAt?: number;
	/** "venue" when the feed reports it; "hourly schedule" for Hyperliquid. */
	nextFundingSource?: "venue" | "hourly schedule";
	/** Share of the asset's known 24h volume. */
	volumeSharePct?: number;
	mob: boolean;
}

function marketRow(
	row: AssetRow,
	volume: number | undefined,
	now: number,
): MarketRow {
	// Hyperliquid settles every hour on the hour; its feed omits the time.
	const scheduled =
		row.nextFundingAt === undefined &&
		row.venue === "hl" &&
		row.intervalHours === 1
			? Math.ceil(now / HOUR) * HOUR
			: undefined;
	const next = row.nextFundingAt ?? scheduled;
	return {
		venue: row.venue,
		market: row.market,
		...(row.price === undefined ? {} : { price: row.price }),
		...(row.volume24hUsd === undefined
			? {}
			: { volume24hUsd: row.volume24hUsd }),
		...(row.openInterestUsd === undefined
			? {}
			: { openInterestUsd: row.openInterestUsd }),
		ratePerInterval: row.ratePerInterval,
		intervalHours: row.intervalHours,
		annualizedPct: row.annualizedPct,
		...(next === undefined
			? {}
			: {
					nextFundingAt: next,
					nextFundingSource:
						scheduled === undefined ? "venue" : "hourly schedule",
				}),
		...(row.volume24hUsd !== undefined && volume
			? { volumeSharePct: (row.volume24hUsd / volume) * 100 }
			: {}),
		mob: MOB_VENUES.includes(row.venue),
	};
}

export async function market(options: { base?: string }, rt: Runtime) {
	await readConfig(rt.home);
	const raw = options.base?.trim();
	if (!raw || !/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(raw))
		throw new UsageError("Usage: mob market <BASE>");
	const ticker = canonicalTicker(raw);
	const input = await fetchInput(selectedVenues(), rt);
	const { assets } = groupAssets(input.rates);
	const now = rt.now();
	const view = assets
		.filter((asset) => asset.ticker === ticker)
		.sort((a, b) => a.variant - b.variant)
		.map((asset) => {
			const rows = [...asset.rows]
				.sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
				.map((row) => marketRow(row, asset.volume24hUsd, now));
			const priced = rows.filter((row) => row.price !== undefined);
			const lowest = rows.reduce((a, b) =>
				b.annualizedPct < a.annualizedPct ? b : a,
			);
			const highest = rows.reduce((a, b) =>
				b.annualizedPct > a.annualizedPct ? b : a,
			);
			return {
				...assetView(asset),
				...(priced.length > 1
					? {
							priceRangePct:
								((Math.max(...priced.map((row) => row.price as number)) -
									Math.min(...priced.map((row) => row.price as number))) /
									Math.min(...priced.map((row) => row.price as number))) *
								100,
						}
					: {}),
				widest:
					lowest.venue === highest.venue
						? undefined
						: {
								long: `${lowest.venue}:${lowest.market}`,
								short: `${highest.venue}:${highest.market}`,
								spreadAnnualizedPct:
									highest.annualizedPct - lowest.annualizedPct,
							},
				rows,
			};
		});
	return withRateCount(
		{ ...header(input), ticker, assets: view },
		input.rates.length,
	);
}
