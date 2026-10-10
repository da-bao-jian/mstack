// Ported from mobius@33ed2ece packages/funding-rates/src/index.ts
/**
 * Venue-neutral funding-rate snapshot types and math.
 *
 * Every caller supplies the rate for one settlement interval.  Keeping the
 * interval alongside that rate avoids silently treating Aster's variable
 * settlement cadence as an eight-hour market.
 */
/**
 * A venue a funding rate can come from.
 *
 * The two Lighter deployments are separate exchanges with separate order books
 * and separate funding, so they are separate venues — which is the whole point:
 * a delta-neutral pair across them earns the difference. `lighter` stays the
 * Robinhood deployment, because stored tasks and rate keys are spelled that
 * way and repurposing the token would reinterpret history.
 */
export const FUNDING_VENUES = [
	"aster",
	"hl",
	"lighter",
	"lighter-mainnet",
] as const;

export type FundingVenue = (typeof FUNDING_VENUES)[number];

export function isFundingVenue(value: unknown): value is FundingVenue {
	return (
		typeof value === "string" && (FUNDING_VENUES as readonly string[]).includes(value)
	);
}

export interface FundingRate {
	venue: FundingVenue;
	/** Canonical base asset, e.g. BTC (never BTCUSDT or BTC-PERP). */
	market: string;
	/** Decimal funding rate for exactly one venue settlement interval. */
	ratePerInterval: number;
	intervalHours: number;
	/** Annualized percentage, derived from ratePerInterval and intervalHours. */
	annualizedPct: number;
}

export interface FundingRateSnapshot {
	/** Unix timestamp (milliseconds) at which the three venue requests finished. */
	observedAt: number;
	rates: FundingRate[];
	/** Markets present in a successful venue response, keyed as venue:market. */
	listed: string[];
	/** A venue whose required bulk feed was incomplete; successful rows may remain. */
	failed: FundingVenue[];
}

export interface NetFundingRate {
	long: FundingRate;
	short: FundingRate;
	longPerHour: number;
	shortPerHour: number;
	netPerHour: number;
	netApy: number;
}

export const HOURS_PER_YEAR = 24 * 365;

export function fundingRateKey(venue: FundingVenue, market: string): string {
	return `${venue}:${market.toUpperCase()}`;
}

export function annualizePeriodicFundingPct(
	ratePerInterval: number,
	intervalHours: number,
): number | null {
	if (
		!Number.isFinite(ratePerInterval) ||
		!Number.isFinite(intervalHours) ||
		intervalHours <= 0
	) {
		return null;
	}
	return (ratePerInterval / intervalHours) * HOURS_PER_YEAR * 100;
}

export function normalizeFundingRatePerHour(
	ratePerInterval: number,
	intervalHours: number,
): number | null {
	if (
		!Number.isFinite(ratePerInterval) ||
		!Number.isFinite(intervalHours) ||
		intervalHours <= 0
	) {
		return null;
	}
	return ratePerInterval / intervalHours;
}

export function createFundingRate(params: {
	venue: FundingVenue;
	market: string;
	ratePerInterval: number;
	intervalHours: number;
}): FundingRate | null {
	const annualizedPct = annualizePeriodicFundingPct(
		params.ratePerInterval,
		params.intervalHours,
	);
	if (annualizedPct === null) return null;
	return {
		venue: params.venue,
		market: params.market.toUpperCase(),
		ratePerInterval: params.ratePerInterval,
		intervalHours: params.intervalHours,
		annualizedPct,
	};
}

export function findFundingRate(
	snapshot: FundingRateSnapshot,
	venue: FundingVenue,
	market: string,
): FundingRate | null {
	const normalizedMarket = market.toUpperCase().replace(/-PERP$/, "");
	const exact = snapshot.rates.find(
		(rate) => rate.venue === venue && rate.market === normalizedMarket,
	);
	if (exact) return exact;
	// Legacy HL task markets are bare base tickers ("SNDK") while HIP-3
	// snapshot rows are dex-qualified ("XYZ:SNDK", "IO:SNDK"). Resolve them
	// the way resolveHlMarket resolves a bare symbol: first base match in
	// snapshot order (core dex first, then builder dexes in registry order).
	if (venue === "hl" && !normalizedMarket.includes(":")) {
		return (
			snapshot.rates.find(
				(rate) =>
					rate.venue === venue &&
					rate.market.slice(rate.market.indexOf(":") + 1) === normalizedMarket,
			) ?? null
		);
	}
	return null;
}

/**
 * Positive net funding means the short leg receives more funding than the
 * long leg pays.  The calculation is safe across different settlement
 * intervals because both rates are normalised to one hour first.
 */
export function calculateNetFundingRate(
	long: FundingRate,
	short: FundingRate,
): NetFundingRate | null {
	const longPerHour = normalizeFundingRatePerHour(
		long.ratePerInterval,
		long.intervalHours,
	);
	const shortPerHour = normalizeFundingRatePerHour(
		short.ratePerInterval,
		short.intervalHours,
	);
	if (longPerHour === null || shortPerHour === null) return null;
	const netPerHour = shortPerHour - longPerHour;
	return {
		long,
		short,
		longPerHour,
		shortPerHour,
		netPerHour,
		netApy: netPerHour * HOURS_PER_YEAR * 100,
	};
}

/** A non-finite threshold is never executable. */
export function meetsFundingThreshold(
	netApy: number,
	minimumApy: number,
): boolean {
	return (
		Number.isFinite(netApy) &&
		Number.isFinite(minimumApy) &&
		netApy >= minimumApy
	);
}
