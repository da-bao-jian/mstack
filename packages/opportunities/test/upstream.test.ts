// Ported from mobius@33ed2ece tg-monitor/src/monitoring/scanner.test.ts
// Selected pure cases; the growth-mode case retains only its pure assertions.
import { describe, expect, test } from "bun:test";
import {
	builderFeeMultiplierForPair,
	fundingEntryPriceSpreadCost,
	hyperliquidEffectiveTakerFeeBps,
	hyperliquidPerpTakerFeeScale,
	normalizeFundingRatePerHour,
} from "../src/upstream.ts";

describe("upstream scanner pure math", () => {
	test("compares HL 1h and Lighter 8h rates on the same hourly basis", () => {
		expect(normalizeFundingRatePerHour(0.0002, 1)).toBe(0.0002);
		expect(normalizeFundingRatePerHour(0.0016, 8)).toBe(0.0002);
	});

	test("rejects invalid rates and intervals", () => {
		expect(() => normalizeFundingRatePerHour(Number.NaN, 1)).toThrow();
		expect(() => normalizeFundingRatePerHour(0.001, 0)).toThrow();
	});

	test("uses combined leg notional and allows a negative price spread cost", () => {
		expect(fundingEntryPriceSpreadCost(100.1, 99.9, 10)).toEqual({
			usd: 2,
			pct: 0.1,
			combinedNotionalUsd: 2_000,
		});
		expect(fundingEntryPriceSpreadCost(99.9, 100.1, 10)).toEqual({
			usd: -2,
			pct: -0.1,
			combinedNotionalUsd: 2_000,
		});
	});

	test("moves the unsupported Lighter leg's builder fee onto HL", () => {
		expect(builderFeeMultiplierForPair("hl", "lighter")).toBe(2);
		expect(builderFeeMultiplierForPair("hl", "hl")).toBe(1);
		expect(builderFeeMultiplierForPair("lighter", "hl")).toBe(1);
	});

	test("applies HIP-3 growth mode and referral discounts to venue fees", () => {
		const scale = hyperliquidPerpTakerFeeScale(1, true);
		expect(scale).toBeCloseTo(0.2);
		expect(hyperliquidEffectiveTakerFeeBps(4.5, scale, 0.04)).toBeCloseTo(
			0.864,
		);
	});
});
