import { expect, test } from "bun:test";
import {
	annualizePeriodicFundingPct,
	type ObservedFundingRate,
	type Snapshot,
} from "@mstack/funding";
import {
	canonicalTicker,
	classifyRows,
	groupAssets,
	pricesAgree,
	rankOpportunities,
	rankPriceGaps,
	venueKey,
} from "../src/index.ts";

function rate(
	venue: string,
	market: string,
	markPrice: number | undefined,
	extras: Partial<ObservedFundingRate> = {},
	ratePerInterval = 0.0001,
	intervalHours = 1,
): ObservedFundingRate {
	return {
		venue,
		market,
		ratePerInterval,
		intervalHours,
		annualizedPct: annualizePeriodicFundingPct(
			ratePerInterval,
			intervalHours,
		) as number,
		observedAt: 1_791_635_200_000,
		source: "direct",
		annualizationMethod: "simple",
		...(markPrice === undefined ? {} : { markPrice }),
		volume24hUsd: 2_000_000,
		...extras,
	};
}

function snapshot(rates: ObservedFundingRate[]): Snapshot {
	return {
		observedAt: 1_791_635_200_000,
		source: "direct",
		annualizationMethod: "simple",
		rates,
		listed: rates.map((r) => `${r.venue}:${r.market}`),
		failed: [],
	};
}

test("one ticker naming two assets splits by price; each half gets its own class", () => {
	const { assets } = groupAssets([
		rate("hl", "xyz:BB", 8.6, { volume24hUsd: 3_800_000 }),
		rate("okx", "BB-USDT-SWAP", 8.61, { venueCategory: "stock" }),
		rate("binance", "BBUSDT", 0.0082, { volume24hUsd: 2_000_000 }),
		rate("bitget", "BBUSDT", 0.0082, { venueCategory: "crypto" }),
	]);
	const bb = assets.filter((asset) => asset.ticker === "BB");
	expect(
		bb.map((asset) => [asset.variant, asset.class, asset.rows.length]),
	).toEqual([
		[1, "rwa", 2],
		[2, "crypto", 2],
	]);
	expect(bb[0].category).toBe("stock");
	expect(bb[1].category).toBeUndefined();
});

test("a venue label classifies every listing of the asset; a crypto label overrides the catalog", () => {
	const { assets } = groupAssets([
		// Caterpillar: Bitget labels it RWA, so the unlabeled Binance row follows.
		rate("binance", "CATUSDT", 709),
		rate("bitget", "CATUSDT", 709, { venueCategory: "rwa" }),
		// A catalog ticker that a venue labels crypto stays crypto.
		rate("okx", "NVDA-USDT-SWAP", 0.5, { venueCategory: "crypto" }),
		// No label: the catalog decides.
		rate("gate", "XAU_USDT", 4020),
	]);
	const find = (ticker: string) => assets.find((a) => a.ticker === ticker);
	expect(find("CAT")).toMatchObject({ class: "rwa", category: "other" });
	expect(find("NVDA")?.class).toBe("crypto");
	expect(find("XAU")).toMatchObject({
		class: "rwa",
		category: "commodity",
		name: "Gold",
	});
	// The curated category beats a venue's broader one (OKX files indices under stocks).
	expect(
		classifyRows(
			[{ venue: "okx", market: "US500-USDT-SWAP", venueCategory: "stock" }],
			"US500",
		),
	).toEqual({
		class: "rwa",
		category: "index",
	});
	// Hyperliquid's RWA deployments label their markets; core markets are crypto.
	expect(
		classifyRows([{ venue: "hl", market: "xyz:NEWCO" }], "NEWCO").class,
	).toBe("rwa");
	expect(classifyRows([{ venue: "hl", market: "NVDA" }], "NVDA").class).toBe(
		"crypto",
	);
});

test("venue aliases fold into one asset and sums stay lower bounds when a figure is missing", () => {
	const { assets } = groupAssets([
		rate("hl", "xyz:GOLD", 4021, { openInterestUsd: 100, volume24hUsd: 300 }),
		rate("binance", "XAUUSDT", 4027, { volume24hUsd: 700 }),
		rate("mexc", "SILVER_USDT", 54.3),
	]);
	expect(canonicalTicker("gold")).toBe("XAU");
	const xau = assets.find((asset) => asset.ticker === "XAU");
	expect(xau?.rows.map((row) => row.market)).toEqual(["XAUUSDT", "xyz:GOLD"]);
	expect(xau?.volume24hUsd).toBe(1_000);
	expect(xau?.openInterestUsd).toBe(100);
	expect(xau?.missingOpenInterest).toBe(1);
	expect(
		assets.find((asset) => asset.ticker === "XAG")?.openInterestUsd,
	).toBeUndefined();
});

test("prices agree within 25%; an unknown price never disagrees", () => {
	expect(pricesAgree(100, 124)).toBe(true);
	expect(pricesAgree(100, 126)).toBe(false);
	expect(pricesAgree(undefined, 5)).toBe(true);
	expect(venueKey("hl", "xyz:TSLA")).toBe("hl:xyz");
	expect(venueKey("hl", "BTC")).toBe("hl");
	expect(venueKey("lighter", "BTC")).toBe("lighter");
});

test("the funding ranker flags pairs of two different assets and never makes them executable", () => {
	const ranked = rankOpportunities(
		snapshot([
			rate("hl", "xyz:BB", 8.6, {}, 0.0005),
			rate("aster", "BB", 0.0082, {}, -0.0005),
			rate("lighter", "BB", 8.59, {}, -0.0001),
		]),
		{ sizeUsd: 1_000 },
	);
	const mixed = ranked.opportunities.find(
		(row) => row.long.venue === "aster" && row.short.venue === "hl",
	);
	expect(mixed?.flags).toContain("price-mismatch");
	expect(mixed?.executable).toBe(false);
	expect(mixed?.qualifies).toBe(false);
	expect(mixed?.mobOpen).toBeUndefined();
	const same = ranked.opportunities.find(
		(row) => row.long.venue === "lighter" && row.short.venue === "hl",
	);
	expect(same?.flags).not.toContain("price-mismatch");
	expect(same?.executable).toBe(true);
});

test("price gaps rank the widest same-asset gap first, long the cheap leg, with fees and funding", () => {
	const gaps = rankPriceGaps(
		snapshot([
			rate("hl", "ETH", 100, {}, 0.0001),
			rate("lighter", "ETH", 101, {}, 0.0003),
			rate("binance", "ETHUSDT", 102, {}, 0.0001, 8),
			// Too far away to be the same asset: flagged, never executable.
			rate("aster", "ETH", 300),
			rate("bybit", "ETHUSDT", 101.5, { volume24hUsd: 10 }),
		]),
	);
	// Mismatched pairs stay in the list, flagged; the widest real gap leads the rest.
	const same = gaps.filter((gap) => !gap.flags.includes("price-mismatch"));
	const top = same[0];
	expect([top.long.venue, top.short.venue]).toEqual(["hl", "binance"]);
	expect(top.gapPct).toBeCloseTo(2, 10);
	// Taker fees round trip: 2 × (4.5 + 5) bps.
	expect(top.roundTripFeePct).toBeCloseTo(0.19, 10);
	expect(top.gapAfterFeesPct).toBeCloseTo(1.81, 10);
	// Short binance earns 0.0001/8h, long hl pays 0.0001/h.
	expect(top.fundingSpreadAnnualizedPct).toBeCloseTo(
		(0.0001 / 8 - 0.0001) * 100 * 8760,
		8,
	);
	expect(top.executable).toBe(false);
	const apart = gaps.filter((gap) =>
		[gap.long.venue, gap.short.venue].includes("aster"),
	);
	expect(apart.length).toBeGreaterThan(0);
	for (const gap of apart) {
		expect(gap.flags).toContain("price-mismatch");
		expect(gap.executable).toBe(false);
	}
	expect(gaps.find((gap) => gap.short.venue === "bybit")?.flags).toContain(
		"thin",
	);
	const mob = gaps.find(
		(gap) => gap.long.venue === "hl" && gap.short.venue === "lighter",
	);
	expect(mob?.executable).toBe(true);
	expect(gaps.map((gap) => gap.gapPct)).toEqual(
		[...gaps.map((gap) => gap.gapPct)].sort((a, b) => b - a),
	);
});
