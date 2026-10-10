import { describe, expect, test } from "bun:test";
import {
	aster,
	binance,
	bybit,
	hyperliquid,
	lighter,
	lighterMainnet,
	okx,
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
