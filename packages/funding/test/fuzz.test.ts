import { expect, test } from "bun:test";
import { seeded } from "../../test-seed.ts";
import {
	aster,
	binance,
	bybit,
	fetchSnapshot,
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
	{ adapter: okx, file: "okx/funding.json", path: ["data", 0, "fundingRate"] },
];

test("seed 0x1703: malformed venue rows fail atomically and preserve another venue", async () => {
	const random = seeded(0x1703);
	const invalid = [
		Number.NaN,
		Infinity,
		-Infinity,
		undefined,
		null,
		true,
		{},
		[],
		"NaN",
		"1e999",
		"-",
		"",
		"0x10",
	];
	for (const { adapter, file, path } of cases) {
		const good = adapter === binance ? bybit : binance;
		for (let i = 0; i < 20; i++) {
			const { ctx } = await fixtureContext({
				[file]: await changed(file, path, invalid[random(invalid.length)]),
			});
			const result = await fetchSnapshot([adapter, good], {
				fetch: ctx.fetch,
				now: ctx.now,
				timeoutMs: 1000,
			});
			expect(result.failed).toHaveLength(1);
			expect(result.failed[0].venue).toBe(adapter.venue);
			expect(result.failed[0].error).toContain("finite number");
			expect(result.rates).toEqual(expected[good.venue]);
		}
	}
});

test("seed 0x1704: funding signs, zero and decimal strings are valid; interval and code domains remain strict", async () => {
	const random = seeded(0x1704);
	for (const { adapter, file, path } of cases) {
		for (const value of [
			0,
			-(1 + random(100)) / 1e6,
			String(random(100) / 1e6),
		]) {
			const { ctx } = await fixtureContext({
				[file]: await changed(file, path, value),
			});
			const result = await adapter.fetchRates(ctx);
			expect(result.length).toBeGreaterThan(0);
			expect(result.every((row) => Number.isFinite(row.annualizedPct))).toBe(
				true,
			);
		}
	}
	for (const adapter of [aster, binance]) {
		const file = `${adapter.venue}/fundingInfo.json`;
		for (const value of [0, -1 - random(24), "0", "-8", undefined]) {
			const { ctx } = await fixtureContext({
				[file]: await changed(file, [0, "fundingIntervalHours"], value),
			});
			await expect(adapter.fetchRates(ctx)).rejects.toThrow();
		}
	}
	for (const [adapter, file, path] of [
		[lighter, "lighter/robinhood.json", ["code"]],
		[lighterMainnet, "lighter/mainnet.json", ["code"]],
		[bybit, "bybit/tickers.json", ["retCode"]],
		[okx, "okx/funding.json", ["code"]],
	] as const) {
		for (const value of [
			Number.NaN,
			-1,
			adapter === bybit ? "0" : 0,
			adapter === okx ? "200" : "200",
			undefined,
		]) {
			const { ctx } = await fixtureContext({
				[file]: await changed(file, path, value),
			});
			await expect(adapter.fetchRates(ctx)).rejects.toThrow();
		}
	}
});
