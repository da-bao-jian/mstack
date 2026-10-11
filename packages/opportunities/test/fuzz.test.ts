import { expect, test } from "bun:test";
import type { ObservedFundingRate, Snapshot } from "@mstack/funding";
import { seeded } from "../../test-seed.ts";
import { rankOpportunities } from "../src/index.ts";

test("seed 0x1706: net APY is monotonic and execution obeys liquidity and deployment gates", () => {
	const random = seeded(0x1706);
	for (let i = 0; i < 256; i++) {
		const spread = (1 + random(1000)) / 1e7,
			fee = random(100),
			days = 1 + random(100);
		const row = (venue: string, rate: number): ObservedFundingRate => ({
			venue,
			market: "BTC",
			ratePerInterval: rate,
			intervalHours: 1,
			annualizedPct: rate * 24 * 365 * 100,
			observedAt: 1,
			source: "direct",
			annualizationMethod: "simple",
			markPrice: 100,
			volume24hUsd: 1_000_000,
		});
		const rates = [row("hl", 0), row("lighter", spread)];
		const snapshot: Snapshot = {
			rates,
			observedAt: 1,
			source: "direct",
			annualizationMethod: "simple",
			listed: [],
			failed: [],
		};
		const rank = (cost = fee, holdDays = days) =>
			rankOpportunities(snapshot, {
				sizeUsd: 50 + random(10000),
				takerFeeBps: { hl: cost },
				holdDays,
			}).opportunities[0];
		const baseline = rank();
		expect(baseline.executable).toBe(true);
		expect(rank(fee + 1).netApyPct as number).toBeLessThan(
			baseline.netApyPct as number,
		);
		expect(rank(fee, days + 1).netApyPct as number).toBeGreaterThan(
			baseline.netApyPct as number,
		);
		rates[1].ratePerInterval += 1e-7;
		expect(rank().netApyPct as number).toBeGreaterThan(
			baseline.netApyPct as number,
		);
		rates[0].volume24hUsd = random(1_000_000);
		expect(rank().executable).toBe(false);
		expect(rank().mobOpen).toBeUndefined();
		rates[0].volume24hUsd = 1_000_000;
		rates[0].venue = "lighter-mainnet";
		expect(rank().flags).toContain("cross-deployment");
		expect(rank().executable).toBe(false);
		expect(rank().mobOpen).toBeUndefined();
	}
});
