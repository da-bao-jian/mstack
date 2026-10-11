import { expect, test } from "bun:test";
import {
	annualizePeriodicFundingPct,
	type ObservedFundingRate,
	type Snapshot,
} from "@mstack/funding";
import {
	calculateBreakEvenHours,
	type RankOptions,
	rankOpportunities,
} from "../src/index.ts";

// Hand-computed cases, including the upstream scanner.test.ts fee/entry examples.
function rate(
	venue: string,
	market: string,
	ratePerInterval: number,
	intervalHours = 1,
	extras: Partial<ObservedFundingRate> = {},
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
		markPrice: 100,
		volume24hUsd: 1_000_000,
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

function rank(
	rates: ObservedFundingRate[],
	overrides: Partial<RankOptions> = {},
) {
	return rankOpportunities(snapshot(rates), { sizeUsd: 1000, ...overrides });
}

test("cross-deployment Lighter pairs are informational and carry a display flag", () => {
	const [row] = rank([
		rate("lighter", "1000PEPE", 0.0001),
		rate("lighter-mainnet", "1000PEPE", 0.0002),
	]).opportunities;
	expect(row.flags).toEqual(["cross-deployment"]);
	expect(row.executable).toBe(false);
	expect(row.mobOpen).toBeUndefined();
});

test.each(["lighter", "lighter-mainnet"])(
	"HL/%s doubles the builder fee in either direction",
	(venue) => {
		const result = rank([
			rate("hl", "BTC", 0.0002),
			rate(venue, "BTC", 0.0008, 8),
		]);
		const row = result.opportunities[0];
		expect(result.opportunities).toHaveLength(1);
		expect(row.long.venue).toBe(venue);
		expect(row.short.venue).toBe("hl");
		expect(row.spreadRate1hPct).toBe(0.01);
		expect(row.spreadAnnualizedPct).toBeCloseTo(87.6, 12);
		// Taker: 2 * (4.5 + 0) / 100 = 0.09%; builder: 2 * 1.5 * 2 / 100 = 0.06%.
		expect(row.roundTripFeePct).toBe(0.09);
		expect(row.builderFeePct).toBe(0.06);
		expect(row.entryCostPct).toBe(0);
		expect(row.entryCostBasis).toBe("mark");
		expect(row.breakEvenHours).toBe(15);
		expect(row.qualifies).toBe(true);
		expect(row.executable).toBe(true);
		expect(row.mobOpen).toBe(
			`mob open BTC --long ${venue}:BTC --short hl:BTC --size 1000`,
		);
		const reverse = rank([rate("hl", "BTC", 0), rate(venue, "BTC", 0.0008, 8)])
			.opportunities[0];
		expect(reverse.long.venue).toBe("hl");
		expect(reverse.builderFeePct).toBe(0.06);
	},
);

test("HL/Aster charges the builder once per HL order and keeps USD1 native names", () => {
	const row = rank([
		rate("hl", "BTC", 0.0001),
		rate("aster", "USD1:BTC", 0.0024, 8),
	]).opportunities[0];
	expect(row.roundTripFeePct).toBe(0.16);
	expect(row.builderFeePct).toBe(0.03);
	expect(row.spreadRate1hPct).toBeCloseTo(0.02, 12);
	expect(row.spreadAnnualizedPct).toBeCloseTo(175.2, 12);
	expect(row.breakEvenHours).toBeCloseTo(9.5, 12);
	expect(row.mobOpen).toBe(
		"mob open BTC --long hl:BTC --short aster:USD1:BTC --size 1000",
	);
});

test("Binance/Bybit charges no builder and is not executable by default", () => {
	const row = rank([
		rate("binance", "BTCUSDT", 0.0004, 4),
		rate("bybit", "BTCPERP", 0.0032, 8),
	]).opportunities[0];
	expect(row.roundTripFeePct).toBe(0.21);
	expect(row.builderFeePct).toBe(0);
	expect(row.spreadRate1hPct).toBeCloseTo(0.03, 12);
	expect(row.spreadAnnualizedPct).toBeCloseTo(262.8, 12);
	expect(row.breakEvenHours).toBeCloseTo(7, 12);
	expect(row.executable).toBe(false);
	expect(row).not.toHaveProperty("mobOpen");
});

test("coin-margined OKX is excluded by default and flagged when included", () => {
	const rates = [rate("hl", "BTC", 0), rate("okx", "BTC-USD-SWAP", 0.0001)];
	expect(rank(rates).opportunities).toEqual([]);
	expect(rank(rates).unmatched).toEqual([]);
	const row = rank(rates, { quoteClasses: ["usd-stable", "coin"] })
		.opportunities[0];
	expect(row.flags).toEqual(["coin-margined"]);
	expect(row.short.quoteClass).toBe("coin");
	expect(row.executable).toBe(false);
});

test("an OI-capped HL leg is flagged and has no executable command", () => {
	const row = rank([
		rate("hl", "BTC", 0.0002, 1, { oiCapped: true }),
		rate("aster", "BTC", 0),
	]).opportunities[0];
	expect(row.flags).toEqual(["hl-oi-capped"]);
	expect(row.executable).toBe(false);
	expect(row).not.toHaveProperty("mobOpen");
	expect(row.qualifies).toBe(true);
});

test("every unclassified row is visible while recognized pairs keep ranking", () => {
	const result = rank([
		rate("hl", "BTC", 0),
		rate("aster", "BTC", 0.0002),
		rate("binance", "ODDUSD", 0.0003),
		rate("okx", "BTC-USD-261225", 0.0004),
		rate("other", "BTC", 0),
	]);
	expect(result.opportunities).toHaveLength(1);
	expect(result.unmatched).toEqual([
		{ venue: "binance", market: "ODDUSD" },
		{ venue: "okx", market: "BTC-USD-261225" },
		{ venue: "other", market: "BTC" },
	]);
});

test("missing marks keep entry cost and break-even unknown", () => {
	const row = rank([
		rate("hl", "BTC", 0.0001),
		rate("lighter", "BTC", 0, 8, { markPrice: undefined }),
	]).opportunities[0];
	expect(row.entryCostPct).toBeNull();
	expect(row.entryCostBasis).toBe("unmeasured");
	expect(row.breakEvenHours).toBeNull();
	expect(row.qualifies).toBe(false);
	expect(row.executable).toBe(true);
});

test("signed mark spread uses the upstream combined-notional basis", () => {
	const rates = [
		rate("hl", "BTC", 0, 1, { markPrice: 100.1 }),
		rate("aster", "BTC", 0.0001, 1, { markPrice: 99.9 }),
	];
	const row = rank(rates).opportunities[0];
	expect(row.entryCostPct).toBe(0.1);
	expect(row.breakEvenHours).toBeCloseTo(29, 12);
	expect(row.qualifies).toBe(false);
	expect(rank(rates, { breakEvenHours: 30 }).opportunities[0].qualifies).toBe(
		true,
	);
});

test("upstream favorable-entry case reaches immediate break-even", () => {
	const row = rank(
		[
			rate("hl", "BTC", 0, 1, { markPrice: 99.9 }),
			rate("lighter", "BTC", 0.0008, 8, { markPrice: 100.1 }),
		],
		{ takerFeeBps: { hl: 0, lighter: 0 }, builderFeeTenthsBps: 0 },
	).opportunities[0];
	expect(row.entryCostPct).toBe(-0.1);
	expect(row.breakEvenHours).toBe(0);
	expect(row.qualifies).toBe(true);
});

test("contract multipliers normalize marks without changing funding or native strings", () => {
	const row = rank([
		rate("hl", "kPEPE", 0.0002, 1, { markPrice: 0.004 }),
		rate("lighter", "PEPE", 0.0008, 8, { markPrice: 0.000004 }),
	]).opportunities[0];
	expect(row.base).toBe("PEPE");
	expect(row.entryCostPct).toBe(0);
	expect(row.short.contractMultiplier).toBe(1000);
	expect(row.spreadRate1hPct).toBe(0.01);
	expect(row.mobOpen).toBe(
		"mob open PEPE --long lighter:PEPE --short hl:kPEPE --size 1000",
	);
	const cex = rank([
		rate("binance", "1000PEPEUSDT", 0, 1, { markPrice: 0.004 }),
		rate("bybit", "1000PEPEUSDT", 0.0001, 1, { markPrice: 0.004 }),
	]).opportunities[0];
	expect(cex.base).toBe("PEPE");
	expect(cex.entryCostPct).toBe(0);
});

test("distinct HIP-3 listings remain distinct and same-venue pairs are excluded", () => {
	const result = rank([
		rate("hl", "xyz:NVDA", 0.0002),
		rate("hl", "io:NVDA", 0.0003),
		rate("lighter", "NVDA", 0.0008, 8),
	]);
	expect(result.opportunities).toHaveLength(2);
	expect(result.opportunities.map((row) => row.short.market)).toEqual([
		"io:NVDA",
		"xyz:NVDA",
	]);
	expect(result.opportunities[0].mobOpen).toBe(
		"mob open NVDA --long lighter:NVDA --short hl:io:NVDA --size 1000",
	);
});

test("ties emit no opportunity; negative rates still compare by hourly funding", () => {
	expect(
		rank([rate("hl", "BTC", 0.0001), rate("aster", "BTC", 0.0008, 8)])
			.opportunities,
	).toEqual([]);
	const row = rank([rate("hl", "BTC", -0.0002), rate("aster", "BTC", -0.0001)])
		.opportunities[0];
	expect(row.long.venue).toBe("hl");
	expect(row.spreadRate1hPct).toBe(0.01);
});

test("options override fee estimates, executable venues, size, and qualification window", () => {
	const row = rank(
		[rate("binance", "BTCUSDT", 0), rate("bybit", "BTCUSDT", 0.0001)],
		{
			sizeUsd: 2500,
			takerFeeBps: { binance: 2, bybit: 3 },
			executableVenues: ["binance", "bybit"],
			breakEvenHours: 10,
		},
	).opportunities[0];
	expect(row.roundTripFeePct).toBe(0.1);
	expect(row.breakEvenHours).toBe(10);
	expect(row.qualifies).toBe(true);
	expect(row.mobOpen).toBe(
		"mob open BTC --long binance:BTCUSDT --short bybit:BTCUSDT --size 2500",
	);
});

test("output preserves observation, source and failure metadata without mutating input", () => {
	const input = snapshot([rate("hl", "BTC", 0), rate("aster", "BTC", 0.0001)]);
	input.source = "hosted";
	input.failed = [{ venue: "bybit", error: "HTTP 503" }];
	const before = structuredClone(input);
	const result = rankOpportunities(input, { sizeUsd: 1000 });
	expect(input).toEqual(before);
	expect(result.observedAt).toBe(input.observedAt);
	expect(result.source).toBe("hosted");
	expect(result.failed).toEqual(input.failed);
	expect(result.annualizationMethod).toBe("simple");
	expect(result.opportunities[0].source).toBe("hosted");
});

test.each([
	{ cost: 0.15, spread: 0.01, expected: 15 },
	{ cost: 0, spread: 0.01, expected: 0 },
	{ cost: -0.1, spread: 0.01, expected: 0 },
	{ cost: 0.15, spread: 0, expected: null },
	{ cost: 0.15, spread: -0.01, expected: null },
	{ cost: -0.1, spread: 0, expected: null },
	{ cost: null, spread: 0.01, expected: null },
])("break-even edge case %j", ({ cost, spread, expected }) => {
	expect(calculateBreakEvenHours(cost, spread)).toBe(expected);
});

test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
	"rejects invalid size %s",
	(sizeUsd) => {
		expect(() => rank([], { sizeUsd })).toThrow();
	},
);

test.each([
	{ takerFeeBps: { hl: -1 } },
	{ takerFeeBps: { hl: Number.NaN } },
	{ builderFeeTenthsBps: -1 },
	{ builderFeeTenthsBps: 1.5 },
	{ breakEvenHours: -1 },
	{ breakEvenHours: Number.POSITIVE_INFINITY },
	{ minVolume24hUsd: -1 },
	{ minVolume24hUsd: Number.NaN },
	{ holdDays: 0 },
	{ holdDays: -1 },
	{ holdDays: Number.POSITIVE_INFINITY },
])("rejects invalid options %j", (options) => {
	expect(() => rank([], options)).toThrow();
});

test.each([
	{ ratePerInterval: Number.NaN },
	{ intervalHours: 0 },
	{ markPrice: 0 },
	{ markPrice: Number.NaN },
	{ volume24hUsd: -1 },
	{ volume24hUsd: Number.NaN },
])("rejects malformed financial inputs %j", (extras) => {
	expect(() =>
		rank([rate("hl", "BTC", 0, 1, extras), rate("aster", "BTC", 0.0001)]),
	).toThrow();
});

test("duplicate venue:market keys fail instead of duplicating ranked pairs", () => {
	expect(() => rank([rate("hl", "BTC", 0), rate("hl", "BTC", 0.0001)])).toThrow(
		"Duplicate funding row",
	);
});

test("every unclassified occurrence is reported, including repeated odd listings", () => {
	const result = rank([
		rate("binance", "ODDUSD", 0),
		rate("binance", "ODDUSD", 0.0001),
	]);
	expect(result.unmatched).toEqual([
		{ venue: "binance", market: "ODDUSD" },
		{ venue: "binance", market: "ODDUSD" },
	]);
});

test("empty input returns an empty ranking with metadata", () => {
	expect(rank([])).toEqual({
		holdDays: 7,
		observedAt: 1_791_635_200_000,
		source: "direct",
		annualizationMethod: "simple",
		opportunities: [],
		failed: [],
		unmatched: [],
	});
});

test("net APY amortizes fees over the hold and never counts favorable marks as income", () => {
	const equal = rank([rate("hl", "BTC", 0), rate("lighter", "BTC", 0.0008, 8)])
		.opportunities[0];
	expect(equal.netApyPct).toBeCloseTo(87.6 - (0.15 * 365) / 7, 12);
	const favorable = [
		rate("hl", "BTC", 0, 1, { markPrice: 99.9 }),
		rate("lighter", "BTC", 0.0008, 8, { markPrice: 100.1 }),
	];
	const row = rank(favorable).opportunities[0];
	expect(row.entryCostPct).toBe(-0.1);
	expect(row.netApyPct).toBe(equal.netApyPct);
	expect(row.breakEvenHours).toBeCloseTo(5, 12);
	expect(
		rank(favorable, { holdDays: 30 }).opportunities[0].netApyPct,
	).toBeCloseTo(87.6 - (0.15 * 365) / 30, 12);
	const adverse = rank([
		rate("hl", "BTC", 0, 1, { markPrice: 100.1 }),
		rate("lighter", "BTC", 0.0008, 8, { markPrice: 99.9 }),
	]).opportunities[0];
	expect(adverse.netApyPct).toBeCloseTo(87.6 - (0.25 * 365) / 7, 12);
	const unknown = rank([
		rate("hl", "BTC", 0),
		rate("lighter", "BTC", 0.0008, 8, { markPrice: undefined }),
		rate("aster", "BTC", 0.00001),
	]).opportunities;
	expect(unknown[0].netApyPct).not.toBeNull();
	expect(unknown.slice(1).every((r) => r.netApyPct === null)).toBe(true);
});

test.each([undefined, 0, 999_999, 1_000_000])(
	"per-leg liquidity gate at %s also gates execution",
	(volume24hUsd) => {
		for (const index of [0, 1]) {
			const rows = [rate("hl", "BTC", 0), rate("lighter", "BTC", 0.0008, 8)];
			rows[index].volume24hUsd = volume24hUsd;
			const row = rank(rows).opportunities[0];
			expect(row.flags.includes("thin")).toBe(volume24hUsd !== 1_000_000);
			expect(row.qualifies).toBe(volume24hUsd === 1_000_000);
			expect(row.executable).toBe(volume24hUsd === 1_000_000);
			expect(
				rank(rows, { minVolume24hUsd: 0 }).opportunities[0].qualifies,
			).toBe(volume24hUsd !== undefined);
		}
	},
);
