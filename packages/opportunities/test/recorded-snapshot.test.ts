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
	// Sixteen BTC listings yield 120 pairs, less the three same-venue pairs
	// (Aster USD1, MEXC USD1, BingX USDC): 117. Nine ETH listings yield 36
	// pairs, less two whose rates tie: 34. ERA has three listings (3 pairs)
	// and XTZ two (1 pair); the DEXE pair ties.
	expect(ranked.opportunities).toHaveLength(155);
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
