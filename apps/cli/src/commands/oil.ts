import type { ObservedFundingRate } from "@mstack/funding";
import {
	type AssetRow,
	groupAssets,
	MOB_VENUES,
	normalizeFundingRatePerHour,
} from "@mstack/opportunities";
import { readConfig } from "../config.ts";
import {
	type Runtime,
	selectedVenues,
	snapshot,
	withRateCount,
} from "./runtime.ts";

// WTI against Brent: both crude benchmarks on every venue, the Brent premium
// on each venue that lists both, and the carry of the spread trade (long one
// benchmark, short the other) from funding. Prices are marks per barrel.

interface Leg {
	venue: string;
	market: string;
	price?: number;
	annualizedPct: number;
	volume24hUsd?: number;
	openInterestUsd?: number;
}

const leg = (row: AssetRow): Leg => ({
	venue: row.venue,
	market: row.market,
	...(row.price === undefined ? {} : { price: row.price }),
	annualizedPct: row.annualizedPct,
	...(row.volume24hUsd === undefined ? {} : { volume24hUsd: row.volume24hUsd }),
	...(row.openInterestUsd === undefined
		? {}
		: { openInterestUsd: row.openInterestUsd }),
});

const perYear = (row: AssetRow) =>
	normalizeFundingRatePerHour(row.ratePerInterval, row.intervalHours) *
	8760 *
	100;

/** The oil view from snapshot rows; pure, so it reads no network. */
export function oilView(rates: readonly ObservedFundingRate[]) {
	const { assets } = groupAssets(rates);
	const pick = (ticker: string) =>
		(
			assets.find((asset) => asset.ticker === ticker && asset.variant === 1)
				?.rows ?? []
		)
			.filter((row) => row.quoteClass === "usd-stable")
			.sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
	const wti = pick("CL");
	const brent = pick("BRENTOIL");
	// The busiest listing of each benchmark per venue.
	const first = (rows: AssetRow[]) => {
		const byVenue = new Map<string, AssetRow>();
		for (const row of rows)
			if (!byVenue.has(row.venue)) byVenue.set(row.venue, row);
		return byVenue;
	};
	const wtiByVenue = first(wti);
	const brentByVenue = first(brent);
	const venues = [...new Set([...wtiByVenue.keys(), ...brentByVenue.keys()])];
	const view = venues
		.map((venue) => {
			const w = wtiByVenue.get(venue);
			const b = brentByVenue.get(venue);
			return {
				venue,
				mob: MOB_VENUES.includes(venue),
				...(w ? { wti: leg(w) } : {}),
				...(b ? { brent: leg(b) } : {}),
				...(w?.price && b?.price
					? { brentPremiumPct: ((b.price - w.price) / w.price) * 100 }
					: {}),
				...(w && b
					? {
							// Long WTI and short Brent earns Brent's funding and pays WTI's.
							carryLongWtiPct: perYear(b) - perYear(w),
						}
					: {}),
			};
		})
		.sort(
			(a, b) =>
				(b.wti?.volume24hUsd ?? 0) +
				(b.brent?.volume24hUsd ?? 0) -
				((a.wti?.volume24hUsd ?? 0) + (a.brent?.volume24hUsd ?? 0)),
		);
	// The best carry across venues for each direction of the spread trade.
	let best: {
		direction: "long WTI, short Brent" | "long Brent, short WTI";
		long: string;
		short: string;
		carryPct: number;
		mob: boolean;
	} | null = null;
	for (const w of wti)
		for (const b of brent)
			for (const [direction, long, short] of [
				["long WTI, short Brent", w, b],
				["long Brent, short WTI", b, w],
			] as const) {
				// A priced, liquid listing on each leg: without a mark, nothing shows
				// the listing tracks the benchmark at all.
				if (
					long.price === undefined ||
					short.price === undefined ||
					(long.volume24hUsd ?? 0) < 1_000_000 ||
					(short.volume24hUsd ?? 0) < 1_000_000
				)
					continue;
				const carryPct = perYear(short) - perYear(long);
				if (!best || carryPct > best.carryPct)
					best = {
						direction,
						long: `${long.venue}:${long.market}`,
						short: `${short.venue}:${short.market}`,
						carryPct,
						mob:
							MOB_VENUES.includes(long.venue) &&
							MOB_VENUES.includes(short.venue),
					};
			}
	const premiums = view.flatMap((row) =>
		row.brentPremiumPct === undefined ? [] : [row.brentPremiumPct],
	);
	return {
		...(premiums.length
			? {
					premium: {
						min: Math.min(...premiums),
						max: Math.max(...premiums),
					},
				}
			: {}),
		best,
		view,
	};
}

export async function oil(rt: Runtime) {
	await readConfig(rt.home);
	const input = await snapshot(selectedVenues(), rt);
	return withRateCount(
		{
			observedAt: input.observedAt,
			source: input.source,
			annualizationMethod: input.annualizationMethod,
			failed: input.failed,
			...oilView(input.rates),
		},
		input.rates.length,
	);
}
