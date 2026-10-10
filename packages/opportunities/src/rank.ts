import {
	HOURS_PER_YEAR,
	type ObservedFundingRate,
	type Snapshot,
} from "@mobstack/funding";
import { classifyMarket } from "./classify.ts";
import type {
	Opportunity,
	OpportunityLeg,
	RankedOpportunities,
	RankOptions,
} from "./types.ts";
import {
	builderFeeMultiplierForPair,
	fundingEntryPriceSpreadCost,
	normalizeFundingRatePerHour,
} from "./upstream.ts";

export const DEFAULT_TAKER_FEE_BPS: Readonly<Record<string, number>> =
	Object.freeze({
		hl: 4.5,
		lighter: 0,
		"lighter-mainnet": 0,
		aster: 3.5,
		binance: 5,
		bybit: 5.5,
		okx: 5,
	});

function finite(value: number, label: string): number {
	if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
	return value;
}

function nonnegative(value: number, label: string): number {
	finite(value, label);
	if (value < 0) throw new Error(`${label} must be nonnegative`);
	return value;
}

/** W2's explicit null semantics for unknown cost or nonpositive carry. */
export function calculateBreakEvenHours(
	totalCostPct: number | null,
	spreadRate1hPct: number,
): number | null {
	finite(spreadRate1hPct, "spreadRate1hPct");
	if (totalCostPct !== null) finite(totalCostPct, "totalCostPct");
	if (spreadRate1hPct <= 0 || totalCostPct === null) return null;
	if (totalCostPct <= 0) return 0;
	return finite(totalCostPct / spreadRate1hPct, "breakEvenHours");
}

function validateRow(row: ObservedFundingRate): void {
	normalizeFundingRatePerHour(row.ratePerInterval, row.intervalHours);
	finite(row.annualizedPct, "annualizedPct");
	nonnegative(row.observedAt, "row observedAt");
	if (row.source !== "direct" && row.source !== "hosted")
		throw new Error("Invalid row source");
	if (row.annualizationMethod !== "simple")
		throw new Error("Expected simple annualization");
	if (
		row.markPrice !== undefined &&
		nonnegative(row.markPrice, "markPrice") === 0
	)
		throw new Error("markPrice must be positive");
	if (row.oiCapped !== undefined && typeof row.oiCapped !== "boolean")
		throw new Error("oiCapped must be boolean");
}

function entryCost(
	long: OpportunityLeg,
	short: OpportunityLeg,
	sizeUsd: number,
): number | null {
	if (long.markPrice === undefined || short.markPrice === undefined)
		return null;
	const longPrice = long.markPrice / long.contractMultiplier;
	const shortPrice = short.markPrice / short.contractMultiplier;
	// Equal base exposure after normalizing each contract's unit multiplier.
	const baseSize = sizeUsd / ((longPrice + shortPrice) / 2);
	return finite(
		fundingEntryPriceSpreadCost(longPrice, shortPrice, baseSize).pct,
		"entryCostPct",
	);
}

export function rankOpportunities(
	snapshot: Snapshot,
	options: RankOptions,
): RankedOpportunities {
	if (nonnegative(options.sizeUsd, "sizeUsd") === 0)
		throw new Error("sizeUsd must be positive");
	const fees = { ...DEFAULT_TAKER_FEE_BPS, ...options.takerFeeBps };
	for (const [venue, fee] of Object.entries(fees))
		nonnegative(fee, `${venue} takerFeeBps`);
	const builderFee = nonnegative(
		options.builderFeeTenthsBps ?? 15,
		"builderFeeTenthsBps",
	);
	if (!Number.isInteger(builderFee))
		throw new Error("builderFeeTenthsBps must be an integer");
	const maximumHours = nonnegative(
		options.breakEvenHours ?? 24,
		"breakEvenHours",
	);
	const executableVenues = new Set(
		options.executableVenues ?? ["hl", "lighter", "lighter-mainnet", "aster"],
	);
	const quoteClasses = new Set(options.quoteClasses ?? ["usd-stable"]);
	for (const quote of quoteClasses)
		if (quote !== "usd-stable" && quote !== "coin")
			throw new Error(`Unknown quote class ${quote}`);
	nonnegative(snapshot.observedAt, "observedAt");
	if (snapshot.source !== "direct" && snapshot.source !== "hosted")
		throw new Error("Invalid snapshot source");
	if (snapshot.annualizationMethod !== "simple")
		throw new Error("Expected simple annualization");
	const groups = new Map<string, OpportunityLeg[]>();
	const unmatched: RankedOpportunities["unmatched"] = [];
	const seen = new Set<string>();
	for (const row of snapshot.rates) {
		validateRow(row);
		const classification = classifyMarket(row.venue, row.market);
		if (!classification) {
			unmatched.push({ venue: row.venue, market: row.market });
			continue;
		}
		const key = `${row.venue}:${row.market}`;
		if (seen.has(key)) throw new Error(`Duplicate funding row ${key}`);
		seen.add(key);
		if (!quoteClasses.has(classification.quoteClass)) continue;
		if (!Object.hasOwn(fees, row.venue))
			throw new Error(`Missing takerFeeBps for ${row.venue}`);
		const group = groups.get(classification.base) ?? [];
		group.push({ ...row, ...classification });
		groups.set(classification.base, group);
	}
	const opportunities: Opportunity[] = [];
	for (const group of groups.values()) {
		for (const long of group) {
			for (const short of group) {
				if (long.venue === short.venue) continue;
				const spreadRate1hPct = finite(
					(normalizeFundingRatePerHour(
						short.ratePerInterval,
						short.intervalHours,
					) -
						normalizeFundingRatePerHour(
							long.ratePerInterval,
							long.intervalHours,
						)) *
						100,
					"spreadRate1hPct",
				);
				if (spreadRate1hPct <= 0) continue;
				const spreadAnnualizedPct = finite(
					spreadRate1hPct * HOURS_PER_YEAR,
					"spreadAnnualizedPct",
				);
				const roundTripFeePct = finite(
					(2 * (fees[long.venue] + fees[short.venue])) / 100,
					"roundTripFeePct",
				);
				const hlLeg =
					long.venue === "hl" ? long : short.venue === "hl" ? short : undefined;
				const otherVenue = hlLeg === long ? short.venue : long.venue;
				// Keep upstream's two-venue function verbatim. Both deployments map
				// to Lighter; every other counterpart uses its non-Lighter branch.
				const multiplier = builderFeeMultiplierForPair(
					"hl",
					otherVenue === "lighter" || otherVenue === "lighter-mainnet"
						? "lighter"
						: "hl",
				);
				const builderFeePct = hlLeg
					? finite((2 * (builderFee / 10) * multiplier) / 100, "builderFeePct")
					: 0;
				const entryCostPct = entryCost(long, short, options.sizeUsd);
				const breakEvenHours = calculateBreakEvenHours(
					entryCostPct === null
						? null
						: roundTripFeePct + builderFeePct + entryCostPct,
					spreadRate1hPct,
				);
				const flags: Opportunity["flags"] = [];
				if (
					[long.venue, short.venue].every(
						(venue) => venue === "lighter" || venue === "lighter-mainnet",
					)
				)
					flags.push("cross-deployment");
				if (hlLeg?.oiCapped) flags.push("hl-oi-capped");
				if (long.quoteClass === "coin" || short.quoteClass === "coin")
					flags.push("coin-margined");
				const executable =
					executableVenues.has(long.venue) &&
					executableVenues.has(short.venue) &&
					!hlLeg?.oiCapped;
				opportunities.push({
					base: long.base,
					long,
					short,
					sizeUsd: options.sizeUsd,
					spreadRate1hPct,
					spreadAnnualizedPct,
					roundTripFeePct,
					builderFeePct,
					entryCostPct,
					entryCostBasis: entryCostPct === null ? "unmeasured" : "mark",
					breakEvenHours,
					qualifies: breakEvenHours !== null && breakEvenHours <= maximumHours,
					executable,
					flags,
					...(executable
						? {
								mobOpen: `mob open ${long.base} --long ${long.venue}:${long.market} --short ${short.venue}:${short.market} --size ${options.sizeUsd}`,
							}
						: {}),
					observedAt: snapshot.observedAt,
					source: snapshot.source,
					annualizationMethod: "simple",
				});
			}
		}
	}
	opportunities.sort((a, b) => b.spreadAnnualizedPct - a.spreadAnnualizedPct);
	return {
		observedAt: snapshot.observedAt,
		source: snapshot.source,
		annualizationMethod: "simple",
		failed: snapshot.failed.map((failure) => ({ ...failure })),
		unmatched,
		opportunities,
	};
}
