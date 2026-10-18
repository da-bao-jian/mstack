import { describe, expect, test } from "bun:test";
import {
	aster,
	binance,
	bingx,
	bitget,
	bybit,
	gate,
	grvt,
	hyperliquid,
	lighter,
	lighterMainnet,
	mexc,
	okx,
	qfex,
	variational,
} from "../src/main.ts";
import { changed, expected, fixtureContext } from "./fixtures.ts";

const cases = [
	{
		adapter: hyperliquid,
		file: "hyperliquid/core-meta.json",
		path: [1, 0, "funding"],
	},
	{
		adapter: lighter,
		file: "lighter/robinhood.json",
		path: ["funding_rates", 0, "rate"],
	},
	{
		adapter: lighterMainnet,
		file: "lighter/mainnet.json",
		path: ["funding_rates", 0, "rate"],
	},
	{
		adapter: aster,
		file: "aster/premiumIndex.json",
		path: [0, "lastFundingRate"],
	},
	{
		adapter: binance,
		file: "binance/premiumIndex.json",
		path: [0, "lastFundingRate"],
	},
	{
		adapter: bybit,
		file: "bybit/tickers.json",
		path: ["result", "list", 0, "fundingRate"],
	},
	{
		adapter: okx,
		file: "okx/funding.json",
		path: ["data", 0, "fundingRate"],
	},
	{
		adapter: mexc,
		file: "mexc/funding.json",
		path: ["data", 0, "fundingRate"],
	},
	{
		adapter: bingx,
		file: "bingx/premiumIndex.json",
		path: ["data", 0, "lastFundingRate"],
	},
	{
		adapter: bitget,
		file: "bitget/tickers.json",
		path: ["data", 0, "fundingRate"],
	},
	{ adapter: gate, file: "gate/contracts.json", path: [0, "funding_rate"] },
	{
		adapter: grvt,
		file: "grvt/ticker-btc.json",
		path: ["result", "funding_rate_8h_curr"],
	},
	{
		adapter: variational,
		file: "variational/stats.json",
		path: ["listings", 0, "funding", "next", "interval_rate"],
	},
	{
		adapter: qfex,
		file: "qfex/contracts.json",
		path: ["data", 0, "next_funding_rate"],
	},
];

for (const { adapter, file, path } of cases) {
	describe(adapter.venue, () => {
		test("recorded responses produce every expected row and exact number", async () => {
			const { ctx, failures, calls } = await fixtureContext();
			expect(await adapter.fetchRates(ctx)).toEqual(
				expected[adapter.venue as keyof typeof expected],
			);
			expect(failures).toEqual([]);
			expect(calls.length).toBeGreaterThan(0);
			for (const call of calls) {
				expect(call.init?.signal).toBe(ctx.signal);
				expect(call.init?.redirect).toBe("error");
			}
		});

		test.each(
			[null, "", " ", "NaN", "Infinity", true, {}, [], "1e999"].map(
				(value) => ({ value }),
			),
		)("rejects malformed funding %j", async ({ value }) => {
			const { ctx } = await fixtureContext({
				[file]: await changed(file, path, value),
			});
			await expect(adapter.fetchRates(ctx)).rejects.toThrow("finite number");
		});

		test("rejects malformed envelope", async () => {
			const { ctx } = await fixtureContext({ [file]: null });
			await expect(adapter.fetchRates(ctx)).rejects.toThrow();
		});

		test("rejects HTTP failure without retry", async () => {
			const { ctx, calls } = await fixtureContext({
				[file]: new Response("unavailable", { status: 503 }),
			});
			await expect(adapter.fetchRates(ctx)).rejects.toThrow("HTTP 503");
			const urls = calls.map((call) => `${call.url}:${call.init?.body ?? ""}`);
			expect(new Set(urls).size).toBe(urls.length);
		});
	});
}

describe("Hyperliquid dex isolation", () => {
	// Fixture scenarios from mobius@33ed2ece tg-monitor/src/monitoring/scanner.test.ts:
	// "keeps core markets when an optional builder dex fails" and
	// "fails the refresh when the core HL universe fails".
	test("keeps core and io rows when xyz fails, and names the failed dex", async () => {
		const { ctx, failures } = await fixtureContext({
			"hyperliquid/xyz-meta.json": new Response("unavailable", { status: 500 }),
		});
		const rows = await hyperliquid.fetchRates(ctx);
		expect(rows.map((row) => row.market)).toEqual([
			"BTC",
			"kPEPE",
			"io:OAI",
			"io:ANTH",
		]);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toEqual({
			venue: "hl",
			error: "dex xyz: https://api.hyperliquid.xyz/info: HTTP 500",
		});
	});

	test("malformed builder data fails that dex with no partial builder rows", async () => {
		const file = "hyperliquid/xyz-meta.json";
		const { ctx, failures } = await fixtureContext({
			[file]: await changed(file, [1, 1, "funding"], ""),
		});
		expect(
			(await hyperliquid.fetchRates(ctx)).some((row) =>
				row.market.startsWith("xyz:"),
			),
		).toBe(false);
		expect(failures[0]?.error).toContain("dex xyz:");
	});

	test("core cap failure fails the adapter before fetching builders", async () => {
		const { ctx, calls } = await fixtureContext({
			"hyperliquid/core-caps.json": new Response("unavailable", {
				status: 503,
			}),
		});
		await expect(hyperliquid.fetchRates(ctx)).rejects.toThrow("HTTP 503");
		expect(calls).toHaveLength(2);
	});

	test("missing contexts throw instead of creating a zero rate", async () => {
		const file = "hyperliquid/core-meta.json";
		const { ctx } = await fixtureContext({
			[file]: await changed(file, [1], []),
		});
		await expect(hyperliquid.fetchRates(ctx)).rejects.toThrow(
			"length mismatch",
		);
	});

	test("caps use native names; delisted markets are not emitted", async () => {
		// Derived edge case: add a currently active fixture market to the cap response.
		const { ctx } = await fixtureContext({
			"hyperliquid/core-caps.json": ["BTC", "CANTO"],
			"hyperliquid/xyz-caps.json": ["xyz:NVDA"],
		});
		const rows = await hyperliquid.fetchRates(ctx);
		expect(rows.filter((row) => row.oiCapped).map((row) => row.market)).toEqual(
			["BTC", "xyz:NVDA"],
		);
		expect(rows.some((row) => row.market === "CANTO")).toBe(false);
	});
});

test.each([aster, binance])(
	"$venue rejects invalid published intervals",
	async (adapter) => {
		const file = `${adapter.venue}/fundingInfo.json`;
		const { ctx } = await fixtureContext({
			[file]: await changed(file, [0, "fundingIntervalHours"], 0),
		});
		await expect(adapter.fetchRates(ctx)).rejects.toThrow("positive");
	},
);

test("Aster missing interval fails; Binance's documented 8h default is explicit", async () => {
	const { ctx } = await fixtureContext({ "aster/fundingInfo.json": [] });
	await expect(aster.fetchRates(ctx)).rejects.toThrow("no funding interval");
	const clean = await fixtureContext();
	const rows = await binance.fetchRates(clean.ctx);
	expect(rows.find((row) => row.market === "RAYUSDT")?.intervalHours).toBe(8);
	expect(
		rows.find((row) => row.market === "LOKAUSDT")?.nextFundingAt,
	).toBeUndefined();
});

test("Aster follows the upstream USDT/USD1 scope and still validates excluded rows", async () => {
	const { ctx } = await fixtureContext();
	const rows = await aster.fetchRates(ctx);
	expect(rows.map((row) => row.market)).toEqual([
		"DEXE",
		"ARGUS",
		"USD1:BTC",
		"BTC",
	]);
	const file = "aster/premiumIndex.json";
	const malformed = await fixtureContext({
		[file]: await changed(file, [4, "lastFundingRate"], null),
	});
	await expect(aster.fetchRates(malformed.ctx)).rejects.toThrow(
		"finite number",
	);
});

test("Bybit does not treat blank perpetual intervals as dated futures", async () => {
	const file = "bybit/tickers.json";
	const { ctx } = await fixtureContext({
		[file]: await changed(
			file,
			["result", "list", 0, "fundingIntervalHour"],
			"",
		),
	});
	await expect(bybit.fetchRates(ctx)).rejects.toThrow("finite number");
});

test("Lighter rejects an unknown exchange instead of silently dropping it", async () => {
	const file = "lighter/robinhood.json";
	const { ctx } = await fixtureContext({
		[file]: await changed(file, ["funding_rates", 0, "exchange"], "unknown"),
	});
	await expect(lighter.fetchRates(ctx)).rejects.toThrow(
		"Unknown Lighter exchange",
	);
});

test.each([
	{
		adapter: lighter,
		file: "lighter/robinhood.json",
		path: ["code"],
		value: 500,
	},
	{
		adapter: bybit,
		file: "bybit/tickers.json",
		path: ["retCode"],
		value: 10006,
	},
	{
		adapter: okx,
		file: "okx/instruments.json",
		path: ["code"],
		value: "50011",
	},
])(
	"$adapter.venue rejects API errors inside HTTP 200",
	async ({ adapter, file, path, value }) => {
		const { ctx } = await fixtureContext({
			[file]: await changed(file, path, value),
		});
		await expect(adapter.fetchRates(ctx)).rejects.toThrow("error code");
	},
);

describe("OKX", () => {
	test("uses four bulk requests and excludes funding outside the live SWAP list", async () => {
		const { ctx, calls } = await fixtureContext();
		expect(await okx.fetchRates(ctx)).toEqual(expected.okx);
		expect(calls.map((call) => call.url)).toEqual([
			"https://www.okx.com/api/v5/public/instruments?instType=SWAP",
			"https://www.okx.com/api/v5/public/funding-rate?instId=ANY",
			"https://www.okx.com/api/v5/public/mark-price?instType=SWAP",
			"https://www.okx.com/api/v5/market/tickers?instType=SWAP",
		]);
	});

	test("excludes a suspended instrument even when bulk funding includes it", async () => {
		const suspended = await Bun.file(
			new URL(
				"../fixtures/okx/instruments-suspended.derived.json",
				import.meta.url,
			),
		).json();
		const { ctx } = await fixtureContext({ "okx/instruments.json": suspended });
		expect(await okx.fetchRates(ctx)).toEqual(
			expected.okx.filter((row) => row.market !== "ETH-USDT-SWAP"),
		);
	});

	test("uses the recorded four-hour interval", async () => {
		const { ctx } = await fixtureContext();
		const row = (await okx.fetchRates(ctx)).find(
			(row) => row.market === "CHIP-USDT-SWAP",
		);
		expect(row?.intervalHours).toBe(4);
		expect(row?.annualizedPct).toBe(10.95);
	});

	test.each(["instId", "nextFundingTime"])(
		"rejects mismatched or malformed %s",
		async (field) => {
			const file = "okx/funding.json";
			const { ctx } = await fixtureContext({
				[file]: await changed(file, ["data", 0, field], "wrong"),
			});
			await expect(okx.fetchRates(ctx)).rejects.toThrow();
		},
	);

	test("fails when a live instrument has no funding row", async () => {
		const { ctx } = await fixtureContext({
			"okx/funding.json": { code: "0", data: [] },
		});
		await expect(okx.fetchRates(ctx)).rejects.toThrow(
			"missing live funding row",
		);
	});
});

describe("venue scope rules", () => {
	test("MEXC keeps linear USDT, USDC, and USD1 contracts and needs a ticker for each", async () => {
		const { ctx } = await fixtureContext();
		const markets = (await mexc.fetchRates(ctx)).map((row) => row.market);
		expect(markets).toContain("BTC_USD1");
		expect(markets).toContain("XAU_USDT");
		expect(markets).not.toContain("BTC_USD");
		const paused = await fixtureContext({
			"mexc/detail.json": await changed(
				"mexc/detail.json",
				["data", 0, "state"],
				4,
			),
		});
		expect(
			(await mexc.fetchRates(paused.ctx)).map((row) => row.market),
		).not.toContain("BTC_USDT");
		const missing = await fixtureContext({
			"mexc/ticker.json": await changed("mexc/ticker.json", ["data"], []),
		});
		await expect(mexc.fetchRates(missing.ctx)).rejects.toThrow(
			"missing MEXC ticker row",
		);
	});

	test("BingX leaves open interest unknown and keeps volume optional", async () => {
		const { ctx } = await fixtureContext();
		const rows = await bingx.fetchRates(ctx);
		expect(rows.every((row) => row.openInterestUsd === undefined)).toBe(true);
		expect(rows.find((row) => row.market === "BTC-USDT")?.volume24hUsd).toBe(
			336088467.36,
		);
		const bare = await fixtureContext({
			"bingx/ticker.json": await changed("bingx/ticker.json", ["data"], []),
		});
		const unknown = await bingx.fetchRates(bare.ctx);
		expect(unknown).toHaveLength(rows.length);
		expect(unknown.every((row) => row.volume24hUsd === undefined)).toBe(true);
	});

	test("Bitget skips contracts that are not normal perpetuals", async () => {
		const file = "bitget/contracts.json";
		const { ctx } = await fixtureContext({
			[file]: await changed(file, ["data", 0, "symbolStatus"], "maintain"),
		});
		expect((await bitget.fetchRates(ctx)).map((row) => row.market)).toEqual([
			"ETHUSDT",
			"XTZUSDT",
			"ERAUSDT",
		]);
	});

	test("Gate skips delisting contracts and rejects a non-boolean flag", async () => {
		const file = "gate/contracts.json";
		const delisting = await fixtureContext({
			[file]: await changed(file, [1, "in_delisting"], true),
		});
		expect(
			(await gate.fetchRates(delisting.ctx)).map((row) => row.market),
		).not.toContain("BTC_USDT");
		const invalid = await fixtureContext({
			[file]: await changed(file, [1, "in_delisting"], "no"),
		});
		await expect(gate.fetchRates(invalid.ctx)).rejects.toThrow("in_delisting");
	});

	test("GRVT scales the eight-hour rate to the instrument interval and checks the ticker name", async () => {
		const { ctx, calls } = await fixtureContext();
		const rows = await grvt.fetchRates(ctx);
		expect(calls).toHaveLength(4);
		const aster = rows.find((row) => row.market === "ASTER_USDT_Perp");
		const btc = rows.find((row) => row.market === "BTC_USDT_Perp");
		expect(aster?.intervalHours).toBe(4);
		// 0.005 percent per eight hours becomes 0.000025 per four-hour settlement.
		expect(aster?.ratePerInterval).toBeCloseTo(0.000025, 12);
		expect(btc?.nextFundingAt).toBe(1792310400000);
		const renamed = await fixtureContext({
			"grvt/ticker-btc.json": await changed(
				"grvt/ticker-btc.json",
				["result", "instrument"],
				"ETH_USDT_Perp",
			),
		});
		await expect(grvt.fetchRates(renamed.ctx)).rejects.toThrow("ticker names");
		const badTime = await fixtureContext({
			"grvt/ticker-btc.json": await changed(
				"grvt/ticker-btc.json",
				["result", "next_funding_time"],
				1792310400000,
			),
		});
		await expect(grvt.fetchRates(badTime.ctx)).rejects.toThrow("timestamp");
	});

	test("Variational keeps perpetuals with funding data and skips swaps", async () => {
		const { ctx } = await fixtureContext();
		const markets = (await variational.fetchRates(ctx)).map(
			(row) => row.market,
		);
		expect(markets).toEqual(["A-PERP", "ERA-PERP", "BTC-PERP", "ETH-PERP"]);
		const file = "variational/stats.json";
		const quiet = await fixtureContext({
			[file]: await changed(file, ["listings", 0, "funding"], null),
		});
		expect(
			(await variational.fetchRates(quiet.ctx)).map((row) => row.market),
		).toEqual(["ERA-PERP", "BTC-PERP", "ETH-PERP"]);
		const btc = (await variational.fetchRates(ctx)).find(
			(row) => row.market === "BTC-PERP",
		);
		// The venue publishes 0.1095 annualized for this row; simple annualization agrees.
		expect(btc?.annualizedPct).toBeCloseTo(10.95, 9);
	});

	test("QFEX keeps USD-quoted perpetuals, reads percent per hour, and has no mark", async () => {
		const { ctx } = await fixtureContext();
		const rows = await qfex.fetchRates(ctx);
		expect(rows.map((row) => row.market)).toEqual([
			"AAPL-USD",
			"ANTHROPIC-USD",
			"OPENAI-USD",
		]);
		const openai = rows.find((row) => row.market === "OPENAI-USD");
		expect(openai?.intervalHours).toBe(1);
		expect(openai?.ratePerInterval).toBeCloseTo(-0.00000073 / 100, 15);
		expect(rows.every((row) => row.markPrice === undefined)).toBe(true);
		const file = "qfex/contracts.json";
		const dated = await fixtureContext({
			[file]: await changed(file, ["data", 0, "product_type"], "Future"),
		});
		await expect(qfex.fetchRates(dated.ctx)).rejects.toThrow(
			"expected Perpetual",
		);
	});
});
