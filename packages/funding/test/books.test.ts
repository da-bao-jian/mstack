import { expect, test } from "bun:test";
import manifest from "../fixtures/books/manifest.json";
import { fetchOrderBook } from "../src/main.ts";

type Record = { file: string; url: string; method: string; body?: string };

async function fixture(file: string): Promise<unknown> {
	return Bun.file(new URL(`../fixtures/${file}`, import.meta.url)).json();
}

/** Serves the recorded books; an override replaces one file's body. */
function fakeFetch(overrides: { [file: string]: unknown } = {}) {
	const calls: string[] = [];
	const fetch = async (url: string, init?: RequestInit) => {
		calls.push(url);
		const record = (manifest as Record[]).find(
			(item) =>
				item.url === url &&
				item.method === (init?.method ?? "GET") &&
				item.body === init?.body,
		);
		if (!record) return new Response("not recorded", { status: 404 });
		const body = Object.hasOwn(overrides, record.file)
			? overrides[record.file]
			: await fixture(record.file);
		return Response.json(body);
	};
	return { fetch, calls };
}

const now = () => 1_791_635_200_000;

test.each([
	["hl", "BTC"],
	["lighter-mainnet", "BTC"],
	["aster", "BTC"],
	["binance", "BTCUSDT"],
	["bybit", "BTCUSDT"],
	["okx", "BTC-USDT-SWAP"],
	["bitget", "BTCUSDT"],
	["bingx", "BTC-USDT"],
	["gate", "BTC_USDT"],
	["mexc", "BTC_USDT"],
	["grvt", "BTC_USDT_Perp"],
	["pacifica", "BTC"],
	["extended", "BTC-USD"],
	["paradex", "BTC-USD-PERP"],
	["dydx", "BTC-USD"],
	["backpack", "BTC_USDC_PERP"],
	["kucoin", "XBTUSDTM"],
])(
	"%s publishes a sorted, uncrossed book in base units",
	async (venue, market) => {
		const { fetch } = fakeFetch();
		const book = await fetchOrderBook(venue, market, { fetch, now });
		expect(book).toMatchObject({
			venue,
			market,
			observedAt: now(),
			truncated: false,
		});
		expect(book.bids.length).toBeGreaterThan(0);
		expect(book.asks.length).toBeGreaterThan(0);
		expect(book.bids[0][0]).toBeLessThan(book.asks[0][0]);
		for (let i = 1; i < book.bids.length; i++)
			expect(book.bids[i][0]).toBeLessThan(book.bids[i - 1][0]);
		for (let i = 1; i < book.asks.length; i++)
			expect(book.asks[i][0]).toBeGreaterThan(book.asks[i - 1][0]);
		// Every venue quotes BTC near the same price, so the units agree.
		expect(book.asks[0][0]).toBeGreaterThan(10_000);
		for (const [, size] of [...book.bids, ...book.asks])
			expect(size).toBeLessThan(1_000);
	},
);

test("contract books convert with the size the venue publishes", async () => {
	const { fetch } = fakeFetch();
	const okx = (await fixture("books/okx-btc.json")) as {
		data: { asks: string[][] }[];
	};
	const book = await fetchOrderBook("okx", "BTC-USDT-SWAP", { fetch, now });
	// The top OKX level is in contracts of 0.01 BTC.
	expect(book.asks[0][1]).toBeCloseTo(
		Number(okx.data[0].asks[0][1]) * 0.01,
		10,
	);
	const gate = (await fixture("books/gate-btc.json")) as {
		asks: { s: number }[];
	};
	const gateBook = await fetchOrderBook("gate", "BTC_USDT", { fetch, now });
	expect(gateBook.asks[0][1]).toBeCloseTo(gate.asks[0].s * 0.0001, 10);
	const mexc = (await fixture("books/mexc-btc.json")) as {
		data: { asks: number[][] };
	};
	const mexcBook = await fetchOrderBook("mexc", "BTC_USDT", { fetch, now });
	expect(mexcBook.asks[0][1]).toBeCloseTo(mexc.data.asks[0][1] * 0.0001, 10);
	const kucoin = (await fixture("books/kucoin-btc.json")) as {
		data: { asks: number[][] };
	};
	const kucoinBook = await fetchOrderBook("kucoin", "XBTUSDTM", { fetch, now });
	expect(kucoinBook.asks[0][1]).toBeCloseTo(kucoin.data.asks[0][1] * 0.001, 10);
});

test("Lighter finds the market id first, then reads its orders", async () => {
	const { fetch, calls } = fakeFetch();
	await fetchOrderBook("lighter-mainnet", "BTC", { fetch, now });
	expect(calls[0]).toBe(
		"https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails",
	);
	expect(calls[1]).toMatch(/orderBookOrders\?market_id=\d+&limit=250$/);
	await expect(
		fetchOrderBook("lighter-mainnet", "NOPE", { fetch, now }),
	).rejects.toThrow("lighter-mainnet:NOPE: unknown market");
});

test("bad books fail loudly with the venue and market named", async () => {
	const binance = (await fixture("books/binance-btc.json")) as {
		bids: string[][];
		asks: string[][];
	};
	const crossed = {
		...binance,
		bids: [[String(Number(binance.asks[0][0]) + 1), "1"]],
	};
	await expect(
		fetchOrderBook("binance", "BTCUSDT", {
			fetch: fakeFetch({ "books/binance-btc.json": crossed }).fetch,
			now,
		}),
	).rejects.toThrow("binance:BTCUSDT: crossed order book");
	const malformed = { ...binance, asks: [["oops", "1"]] };
	await expect(
		fetchOrderBook("binance", "BTCUSDT", {
			fetch: fakeFetch({ "books/binance-btc.json": malformed }).fetch,
			now,
		}),
	).rejects.toThrow("expected finite number");
	await expect(
		fetchOrderBook("binance", "BTCUSDT", {
			fetch: fakeFetch({ "books/binance-btc.json": { bids: [], asks: [] } })
				.fetch,
			now,
		}),
	).rejects.toThrow("empty order book");
	await expect(
		fetchOrderBook("variational", "BTC-PERP", { now }),
	).rejects.toThrow("publishes no public order book");
	await expect(fetchOrderBook("kraken", "BTC", { now })).rejects.toThrow(
		"Unknown venue kraken",
	);
});
