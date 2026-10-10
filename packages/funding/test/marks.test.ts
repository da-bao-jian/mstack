import { expect, test } from "bun:test";
import { binance, lighter, lighterMainnet, okx } from "../src/main.ts";
import { changed, fixtureContext } from "./fixtures.ts";

test.each([lighter, lighterMainnet])(
	"$venue joins marks and open interest by symbol",
	async (adapter) => {
		const { ctx, calls } = await fixtureContext();
		const rows = await adapter.fetchRates(ctx);
		expect(calls).toHaveLength(2);
		expect(
			rows.every(
				(r) => (r.markPrice ?? 0) > 0 && (r.openInterestUsd ?? -1) >= 0,
			),
		).toBe(true);
	},
);

test.each(["MKR", "MAGS"])(
	"Lighter retains inactive %s, omitting only a zero mark",
	async (symbol) => {
		// Derived join scenario: these real inactive details currently have no funding row.
		const file = "lighter/mainnet.json";
		const body = await Bun.file(
			new URL(`../fixtures/${file}`, import.meta.url),
		).json();
		body.funding_rates = [
			{
				...body.funding_rates.find(
					(r: { exchange: string }) => r.exchange === "lighter",
				),
				symbol,
			},
		];
		const { ctx } = await fixtureContext({ [file]: body });
		const [row] = await lighterMainnet.fetchRates(ctx);
		expect(row.market).toBe(symbol);
		if (symbol === "MKR") {
			expect(row.markPrice).toBeUndefined();
			expect(row.openInterestUsd).toBeUndefined();
		} else {
			expect(row.markPrice).toBe(65.085);
			expect(row.openInterestUsd).toBe(0);
		}
	},
);

test.each([-1, "NaN", "", null])(
	"Lighter rejects bad marks %j",
	async (value) => {
		const file = "lighter/mainnet-details.json";
		const { ctx } = await fixtureContext({
			[file]: await changed(
				file,
				["order_book_details", 0, "mark_price"],
				value,
			),
		});
		await expect(lighterMainnet.fetchRates(ctx)).rejects.toThrow();
	},
);

test.each([
	{
		adapter: lighterMainnet,
		file: "lighter/mainnet-details.json",
		body: { code: 200, order_book_details: [] },
		message: "missing Lighter",
	},
	{
		adapter: okx,
		file: "okx/marks.json",
		body: { code: "0", data: [] },
		message: "missing live mark",
	},
])(
	"$adapter.venue rejects missing marks",
	async ({ adapter, file, body, message }) => {
		const { ctx } = await fixtureContext({ [file]: body });
		await expect(adapter.fetchRates(ctx)).rejects.toThrow(message);
	},
);

test.each([0, -1, "NaN", null])("OKX rejects bad marks %j", async (value) => {
	const file = "okx/marks.json";
	const { ctx } = await fixtureContext({
		[file]: await changed(file, ["data", 0, "markPx"], value),
	});
	await expect(okx.fetchRates(ctx)).rejects.toThrow();
});

test("Binance excludes recorded dated delivery contracts", async () => {
	const file = "binance/premiumIndex.json";
	const original = await Bun.file(
		new URL(`../fixtures/${file}`, import.meta.url),
	).json();
	const delivery = await Bun.file(
		new URL("../fixtures/binance/delivery.json", import.meta.url),
	).json();
	expect(delivery).toHaveLength(2);
	const { ctx } = await fixtureContext({ [file]: [...original, ...delivery] });
	expect((await binance.fetchRates(ctx)).map((r) => r.market)).toEqual(
		original.map((r: { symbol: string }) => r.symbol),
	);
});
