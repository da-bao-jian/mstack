import type { Snapshot } from "@mstack/funding";
import { pricesAgree, unitPrice } from "./assets.ts";
import { classifyMarket } from "./classify.ts";
import { DEFAULT_TAKER_FEE_BPS } from "./rank.ts";
import type { OpportunityLeg } from "./types.ts";
import { normalizeFundingRatePerHour } from "./upstream.ts";
import { MOB_VENUES } from "./venues.ts";

/** Buy where the asset is cheap, sell where it is rich, and wait for the gap to close. */
export interface PriceGap {
	base: string;
	/** The cheaper leg: bought. */
	long: OpportunityLeg;
	/** The richer leg: sold. */
	short: OpportunityLeg;
	/** (short - long) / long, from mark prices per base unit. */
	gapPct: number;
	/** Open and close taker fees on both legs. */
	roundTripFeePct: number;
	gapAfterFeesPct: number;
	/** Funding the pair earns (positive) or pays (negative) while it is open. */
	fundingSpreadAnnualizedPct: number;
	flags: ("thin" | "cross-deployment" | "coin-margined" | "price-mismatch")[];
	executable: boolean;
	priceBasis: "mark";
}

export interface PriceGapOptions {
	takerFeeBps?: Readonly<Record<string, number>>;
	minVolume24hUsd?: number;
	includeCoinMargined?: boolean;
}

/**
 * Every same-asset pair priced apart, widest gap first. Mark prices are an
 * estimate: the fill depends on each order book. A pair whose prices are too
 * far apart to be one asset (BB the stock and BB the token) is flagged
 * `price-mismatch` and never executable, so a view can hide and count it.
 */
export function rankPriceGaps(
	snapshot: Snapshot,
	options: PriceGapOptions = {},
): PriceGap[] {
	const fees = { ...DEFAULT_TAKER_FEE_BPS, ...options.takerFeeBps };
	const minVolume = options.minVolume24hUsd ?? 1_000_000;
	const groups = new Map<string, (OpportunityLeg & { price: number })[]>();
	for (const row of snapshot.rates) {
		const classification = classifyMarket(row.venue, row.market);
		if (!classification || row.markPrice === undefined) continue;
		if (classification.quoteClass === "coin" && !options.includeCoinMargined)
			continue;
		const price = unitPrice(row, classification);
		if (price === undefined || price <= 0) continue;
		const group = groups.get(classification.base) ?? [];
		group.push({ ...row, ...classification, price });
		groups.set(classification.base, group);
	}
	const gaps: PriceGap[] = [];
	for (const group of groups.values())
		for (const long of group)
			for (const short of group) {
				if (long.venue === short.venue || short.price <= long.price) continue;
				const mismatch = !pricesAgree(long.price, short.price);
				const gapPct = ((short.price - long.price) / long.price) * 100;
				const roundTripFeePct =
					(2 * ((fees[long.venue] ?? 0) + (fees[short.venue] ?? 0))) / 100;
				const flags: PriceGap["flags"] = [];
				const thin = [long, short].some(
					(leg) =>
						leg.volume24hUsd === undefined || leg.volume24hUsd < minVolume,
				);
				if (thin) flags.push("thin");
				const lighter = (venue: string) => venue.startsWith("lighter");
				if (lighter(long.venue) && lighter(short.venue))
					flags.push("cross-deployment");
				if (long.quoteClass === "coin" || short.quoteClass === "coin")
					flags.push("coin-margined");
				if (mismatch) flags.push("price-mismatch");
				const { price: _long, ...longLeg } = long;
				const { price: _short, ...shortLeg } = short;
				gaps.push({
					base: long.base,
					long: longLeg,
					short: shortLeg,
					gapPct,
					roundTripFeePct,
					gapAfterFeesPct: gapPct - roundTripFeePct,
					fundingSpreadAnnualizedPct:
						(normalizeFundingRatePerHour(
							short.ratePerInterval,
							short.intervalHours,
						) -
							normalizeFundingRatePerHour(
								long.ratePerInterval,
								long.intervalHours,
							)) *
						100 *
						24 *
						365,
					flags,
					executable:
						!thin &&
						!mismatch &&
						!flags.includes("cross-deployment") &&
						MOB_VENUES.includes(long.venue) &&
						MOB_VENUES.includes(short.venue),
					priceBasis: "mark",
				});
			}
	return gaps.sort((a, b) => b.gapPct - a.gapPct);
}
