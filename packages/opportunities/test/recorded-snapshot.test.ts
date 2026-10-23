import { expect, test } from "bun:test";
import type { Snapshot } from "@mstack/funding";
import recordedRows from "../../funding/test/expected.json";
import { rankOpportunities } from "../src/index.ts";

test("ranks the complete recorded funding fixture snapshot without network access", () => {
	const rates = Object.values(recordedRows).flat() as Snapshot["rates"];
	const snapshot: Snapshot = {
		observedAt: 1_791_635_200_000,
		rates,
		listed: rates.map((row) => `${row.venue}:${row.market}`),
		failed: [],
		source: "direct",
		annualizationMethod: "simple",
	};
	const ranked = rankOpportunities(snapshot, { sizeUsd: 1000 });
	// Twenty-two BTC listings yield 231 pairs, less three same-venue pairs
	// (Aster USD1, MEXC USD1, BingX USDC) and six whose hourly rates tie: 222.
	// Fifteen ETH listings yield 105 pairs, less three ties: 102. ERA has three
	// listings (3 pairs), XTZ and XAU two each (1 pair each); the DEXE pair ties.
	expect(ranked.opportunities).toHaveLength(329);
	expect(ranked.unmatched).toEqual([]);
	expect(ranked.failed).toEqual([]);
	for (let index = 1; index < ranked.opportunities.length; index++) {
		expect(
			ranked.opportunities[index - 1].netApyPct ?? Number.NEGATIVE_INFINITY,
		).toBeGreaterThanOrEqual(
			ranked.opportunities[index].netApyPct ?? Number.NEGATIVE_INFINITY,
		);
	}
	expect(
		ranked.opportunities.some(
			(row) =>
				row.long.market === "BTC-USD-SWAP" ||
				row.short.market === "BTC-USD-SWAP",
		),
	).toBe(false);
});
