import { expect, test } from "bun:test";
import { fetchMarketMetadata } from "../src/metadata/index.ts";
import { changed } from "./fixtures.ts";
import { metadataContext } from "./metadata-fixtures.ts";

test.each([
	["hl", "BTC", 5, 0.00001, 0.00001, 10, 40],
	["lighter", "BTC", 5, 0.00001, 0.0002, 10, 50],
	["lighter-mainnet", "BTC", 5, 0.00001, 0.00007, 10, 50],
	["aster", "BTC", 3, 0.001, 0.001, 5, undefined],
	["aster", "USD1:BTC", 3, 0.001, 0.001, 5, undefined],
] as const)(
	"%s:%s metadata uses strict native fields",
	async (venue, market, precision, lot, min, notional, max) => {
		const row = await fetchMarketMetadata(
			venue,
			market,
			await metadataContext(),
		);
		expect(row).toMatchObject({
			venue,
			market,
			sizeDecimals: precision,
			lotSize: lot,
			minBase: min,
			minNotionalUsd: notional,
		});
		expect(row.maxLeverage).toBe(max);
	},
);
test("HIP-3 reads dex-qualified metadata", async () => {
	const ctx = await metadataContext();
	const calls: string[] = [];
	const row = await fetchMarketMetadata("hl", "xyz:NVDA", {
		...ctx,
		fetch: async (url, init) => {
			calls.push(String(init?.body));
			return ctx.fetch(url, init);
		},
	});
	expect(row.market).toBe("xyz:NVDA");
	expect(calls).toEqual(['{"type":"meta","dex":"xyz"}']);
});
test.each([
	["hl", "hyperliquid/core-meta.json", [0, "universe", 0, "szDecimals"], 1.2],
	["hl", "hyperliquid/core-meta.json", [0, "universe", 0, "maxLeverage"], 0],
	[
		"lighter-mainnet",
		"lighter/mainnet-details.json",
		["order_book_details", 2, "min_base_amount"],
		"bad",
	],
	[
		"lighter-mainnet",
		"lighter/mainnet-details.json",
		["order_book_details", 2, "size_decimals"],
		-1,
	],
	[
		"lighter-mainnet",
		"lighter/mainnet-details.json",
		["order_book_details", 2, "price_decimals"],
		null,
	],
	[
		"lighter-mainnet",
		"lighter/mainnet-details.json",
		["order_book_details", 2, "min_initial_margin_fraction"],
		0,
	],
	[
		"aster",
		"aster/exchangeInfo.json",
		["symbols", 0, "filters", 0, "stepSize"],
		0,
	],
	[
		"aster",
		"aster/exchangeInfo.json",
		["symbols", 0, "filters", 0, "minQty"],
		null,
	],
	[
		"aster",
		"aster/exchangeInfo.json",
		["symbols", 0, "filters", 1, "notional"],
		"NaN",
	],
] as const)(
	"%s metadata rejects malformed %s %j",
	async (venue, file, path, value) => {
		const raw = await changed(file, path, value);
		await expect(
			fetchMarketMetadata(venue, "BTC", await metadataContext({ [file]: raw })),
		).rejects.toThrow();
	},
);
test("metadata rejects missing markets, duplicates and HTTP failures", async () => {
	const ctx = await metadataContext();
	await expect(fetchMarketMetadata("hl", "absent", ctx)).rejects.toThrow(
		"missing",
	);
	await expect(fetchMarketMetadata("binance", "BTC", ctx)).rejects.toThrow(
		"No execution metadata",
	);
	await expect(
		fetchMarketMetadata("hl", "BTC", {
			...ctx,
			fetch: async () => new Response("no", { status: 503 }),
		}),
	).rejects.toThrow("HTTP 503");
	const duplicate = {
		universe: [
			{ name: "BTC", szDecimals: 5, maxLeverage: 40 },
			{ name: "BTC", szDecimals: 5, maxLeverage: 40 },
		],
	};
	await expect(
		fetchMarketMetadata("hl", "BTC", {
			...ctx,
			fetch: async () => Response.json(duplicate),
		}),
	).rejects.toThrow("duplicate");
});

test("tiny Aster lots retain their real decimal precision", async () => {
	const raw = await changed(
		"aster/exchangeInfo.json",
		["symbols", 0, "filters", 0, "stepSize"],
		"0.0000000001",
	);
	const row = await fetchMarketMetadata(
		"aster",
		"BTC",
		await metadataContext({ "aster/exchangeInfo.json": raw }),
	);
	expect(row.sizeDecimals).toBe(10);
	expect(row.lotSize).toBe(1e-10);
});
test("inactive Lighter markets have no executable metadata", async () => {
	await expect(
		fetchMarketMetadata("lighter-mainnet", "MKR", await metadataContext()),
	).rejects.toThrow("metadata missing");
});
