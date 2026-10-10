// Ported from mobius@33ed2ece tg-monitor/src/monitoring/scanner.ts
export type Venue = "hl" | "lighter";

export function normalizeFundingRatePerHour(
	ratePerInterval: number,
	intervalHours: number,
): number {
	if (!Number.isFinite(ratePerInterval)) {
		throw new Error("funding rate must be finite");
	}
	if (!Number.isFinite(intervalHours) || intervalHours <= 0) {
		throw new Error("funding interval hours must be positive");
	}
	return ratePerInterval / intervalHours;
}

export function fundingEntryPriceSpreadCost(
	longEntryPrice: number,
	shortEntryPrice: number,
	baseSize: number,
): { usd: number; pct: number; combinedNotionalUsd: number } {
	if (
		!Number.isFinite(longEntryPrice) ||
		longEntryPrice <= 0 ||
		!Number.isFinite(shortEntryPrice) ||
		shortEntryPrice <= 0 ||
		!Number.isFinite(baseSize) ||
		baseSize <= 0
	) {
		throw new Error("funding entry prices and base size must be positive");
	}
	const longNotionalUsd = longEntryPrice * baseSize;
	const shortNotionalUsd = shortEntryPrice * baseSize;
	const combinedNotionalUsd = longNotionalUsd + shortNotionalUsd;
	const usd = longNotionalUsd - shortNotionalUsd;
	return { usd, pct: (usd / combinedNotionalUsd) * 100, combinedNotionalUsd };
}

export function hyperliquidPerpTakerFeeScale(
	deployerFeeScale: number,
	growthMode: boolean,
): number {
	if (!Number.isFinite(deployerFeeScale) || deployerFeeScale < 0) {
		throw new Error("HL deployer fee scale must be non-negative");
	}
	const hip3Scale =
		deployerFeeScale < 1 ? deployerFeeScale + 1 : deployerFeeScale * 2;
	return hip3Scale * (growthMode ? 0.1 : 1);
}

export function hyperliquidEffectiveTakerFeeBps(
	baseTakerFeeBps: number,
	marketScale = 1,
	activeReferralDiscount = 0,
): number {
	if (
		!Number.isFinite(baseTakerFeeBps) ||
		baseTakerFeeBps < 0 ||
		!Number.isFinite(marketScale) ||
		marketScale < 0 ||
		!Number.isFinite(activeReferralDiscount) ||
		activeReferralDiscount < 0 ||
		activeReferralDiscount >= 1
	) {
		throw new Error("invalid HL taker fee inputs");
	}
	return baseTakerFeeBps * marketScale * (1 - activeReferralDiscount);
}

export function builderFeeMultiplierForPair(
	builderVenue: Venue,
	otherVenue: Venue,
): 1 | 2 {
	return builderVenue !== "lighter" && otherVenue === "lighter" ? 2 : 1;
}
