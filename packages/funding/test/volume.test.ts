import { expect, test } from "bun:test";
import {
	aster,
	binance,
	bybit,
	hyperliquid,
	lighter,
	lighterMainnet,
	okx,
} from "../src/main.ts";
import { changed, fixtureContext } from "./fixtures.ts";

const cases = [
	{
		adapter: hyperliquid,
		file: "hyperliquid/core-meta.json",
		path: [1, 0, "dayNtlVlm"],
		market: "BTC",
	},
	{
		adapter: lighter,
		file: "lighter/robinhood-details.json",
		path: ["order_book_details", 0, "daily_quote_token_volume"],
		market: "BTC",
	},
	{
		adapter: lighterMainnet,
		file: "lighter/mainnet-details.json",
		path: ["order_book_details", 2, "daily_quote_token_volume"],
		market: "BTC",
	},
	{
		adapter: bybit,
		file: "bybit/tickers.json",
		path: ["result", "list", 0, "turnover24h"],
	},
	{ adapter: aster, file: "aster/volume.json", path: [0, "quoteVolume"] },
	{ adapter: binance, file: "binance/volume.json", path: [0, "quoteVolume"] },
	{ adapter: okx, file: "okx/volume.json", path: ["data", 0, "volCcy24h"] },
];

test.each(cases)(
	"$adapter.venue rejects malformed volume instead of inventing zero",
	async ({ adapter, file, path }) => {
		for (const value of [-1, null, "", "NaN"]) {
			const { ctx } = await fixtureContext({
				[file]: await changed(file, path, value),
			});
			await expect(adapter.fetchRates(ctx)).rejects.toThrow();
		}
	},
);

test.each(cases)(
	"$adapter.venue preserves missing volume as unknown",
	async ({ adapter, file, path }) => {
		const before = await fixtureContext();
		const expected = await adapter.fetchRates(before.ctx);
		const { ctx } = await fixtureContext({
			[file]: await changed(file, path, undefined),
		});
		const rows = await adapter.fetchRates(ctx);
		const removed = rows.filter(
			(r, i) =>
				expected[i].volume24hUsd !== undefined && r.volume24hUsd === undefined,
		);
		expect(removed).toHaveLength(1);
		expect(removed[0]).not.toHaveProperty("volume24hUsd");
	},
);

test("OKX converts base volume with the mark, never contract volume", async () => {
	const file = "okx/volume.json";
	const recorded = await Bun.file(
		new URL(`../fixtures/${file}`, import.meta.url),
	).json();
	const ticker = recorded.data[0];
	const { ctx } = await fixtureContext();
	const row = (await okx.fetchRates(ctx)).find(
		(r) => r.market === ticker.instId,
	);
	expect(row?.volume24hUsd).toBe(
		Number(ticker.volCcy24h) * (row?.markPrice as number),
	);
	expect(row?.volume24hUsd).not.toBe(
		Number(ticker.vol24h) * (row?.markPrice as number),
	);
});

test.each([aster, binance, okx])(
	"$venue omits volume when the bulk ticker has no matching row",
	async (adapter) => {
		const file = `${adapter.venue}/volume.json`;
		const { ctx } = await fixtureContext({
			[file]: adapter === okx ? { code: "0", data: [] } : [],
		});
		expect(
			(await adapter.fetchRates(ctx)).every(
				(r) => r.volume24hUsd === undefined,
			),
		).toBe(true);
	},
);
