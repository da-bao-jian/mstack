import { json } from "../http.ts";
import type { Fetch, FetchContext } from "../types.ts";
import {
	array,
	errorMessage,
	nonnegative,
	object,
	positive,
	string,
	timestamp,
} from "../validation.ts";

// Public order books, one native market at a time, for execution cost.
// Every level is [price, size in base units]: venues that quote contracts
// (OKX, Gate, MEXC, KuCoin) are converted with the contract size they publish.
// Bids sort best first (highest), asks best first (lowest).

export type Level = [price: number, size: number];

export interface OrderBook {
	venue: string;
	market: string;
	bids: Level[];
	asks: Level[];
	observedAt: number;
	/** The venue returned its maximum number of levels, so deeper orders may exist. */
	truncated: boolean;
}

export interface BookOptions {
	fetch?: Fetch;
	now?: () => number;
	timeoutMs?: number;
}

/** Venues that publish no keyless order book. */
export const BOOKLESS_VENUES: readonly string[] = ["variational", "qfex"];

const LIGHTER: Readonly<Record<string, string>> = {
	lighter: "https://api.rh.lighter.xyz",
	"lighter-mainnet": "https://mainnet.zklighter.elliot.ai",
};

function levels(
	raw: unknown,
	label: string,
	read: (entry: unknown, label: string) => [unknown, unknown],
	multiplier = 1,
): Level[] {
	return array(raw, label).flatMap((entry, index) => {
		const [price, size] = read(entry, `${label}[${index}]`);
		const base = nonnegative(size, `${label}[${index}] size`) * multiplier;
		return base > 0
			? [[positive(price, `${label}[${index}] price`), base] as Level]
			: [];
	});
}

const pair = (entry: unknown, label: string): [unknown, unknown] => {
	const row = array(entry, label);
	return [row[0], row[1]];
};

const keyed =
	(price: string, size: string) =>
	(entry: unknown, label: string): [unknown, unknown] => {
		const row = object(entry, label);
		return [row[price], row[size]];
	};

/** Sum equal prices, sort best first, and refuse a crossed book. */
function book(
	venue: string,
	market: string,
	bids: Level[],
	asks: Level[],
	observedAt: number,
	truncated: boolean,
): OrderBook {
	const merge = (rows: Level[], descending: boolean) => {
		const sizes = new Map<number, number>();
		for (const [price, size] of rows)
			sizes.set(price, (sizes.get(price) ?? 0) + size);
		return [...sizes].sort((a, b) => (descending ? b[0] - a[0] : a[0] - b[0]));
	};
	const sortedBids = merge(bids, true);
	const sortedAsks = merge(asks, false);
	if (!sortedBids.length || !sortedAsks.length)
		throw new Error(`${venue}:${market}: empty order book`);
	if (sortedBids[0][0] >= sortedAsks[0][0])
		throw new Error(`${venue}:${market}: crossed order book`);
	return {
		venue,
		market,
		bids: sortedBids,
		asks: sortedAsks,
		observedAt,
		truncated,
	};
}

async function read(
	ctx: FetchContext,
	venue: string,
	market: string,
): Promise<OrderBook> {
	const now = ctx.now();
	const at = (n: number, max: number) => n >= max;
	switch (venue) {
		case "hl": {
			// Hyperliquid serves at most 20 levels a side without aggregation.
			const body = object(
				await json(ctx, "https://api.hyperliquid.xyz/info", {
					type: "l2Book",
					coin: market,
				}),
				"Hyperliquid l2Book",
			);
			const [bids, asks] = array(body.levels, "levels");
			const parse = keyed("px", "sz");
			const b = levels(bids, "bids", parse);
			const a = levels(asks, "asks", parse);
			return book(
				venue,
				market,
				b,
				a,
				now,
				at(b.length, 20) || at(a.length, 20),
			);
		}
		case "lighter":
		case "lighter-mainnet": {
			const base = LIGHTER[venue];
			const details = object(
				await json(ctx, `${base}/api/v1/orderBookDetails`),
				"Lighter orderBookDetails",
			);
			const entry = array(details.order_book_details, "order_book_details")
				.map((value) => object(value, "Lighter market details"))
				.find((value) => value.symbol === market);
			if (!entry) throw new Error(`${venue}:${market}: unknown market`);
			const id = nonnegative(entry.market_id, `${market} market_id`);
			const body = object(
				await json(
					ctx,
					`${base}/api/v1/orderBookOrders?market_id=${id}&limit=250`,
				),
				"Lighter orderBookOrders",
			);
			if (body.code !== 200) throw new Error(`Lighter error code ${body.code}`);
			const parse = keyed("price", "remaining_base_amount");
			const b = levels(body.bids, "bids", parse);
			const a = levels(body.asks, "asks", parse);
			// 250 orders, not levels: a full page may hide deeper orders.
			return book(
				venue,
				market,
				b,
				a,
				now,
				at(array(body.bids, "bids").length, 250) ||
					at(array(body.asks, "asks").length, 250),
			);
		}
		case "aster":
		case "binance": {
			const symbol =
				venue === "aster"
					? market.startsWith("USD1:")
						? `${market.slice(5)}USD1`
						: `${market}USDT`
					: market;
			const host =
				venue === "aster"
					? "https://fapi.asterdex.com"
					: "https://fapi.binance.com";
			const body = object(
				await json(
					ctx,
					`${host}/fapi/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=1000`,
				),
				`${venue} depth`,
			);
			const b = levels(body.bids, "bids", pair);
			const a = levels(body.asks, "asks", pair);
			return book(
				venue,
				market,
				b,
				a,
				now,
				at(b.length, 1000) || at(a.length, 1000),
			);
		}
		case "bybit": {
			const body = object(
				await json(
					ctx,
					`https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${encodeURIComponent(market)}&limit=500`,
				),
				"Bybit orderbook",
			);
			if (body.retCode !== 0) throw new Error(`Bybit error ${body.retCode}`);
			const result = object(body.result, "result");
			const b = levels(result.b, "bids", pair);
			const a = levels(result.a, "asks", pair);
			return book(
				venue,
				market,
				b,
				a,
				now,
				at(b.length, 500) || at(a.length, 500),
			);
		}
		case "okx": {
			const [rawBook, rawInstrument] = await Promise.all([
				json(
					ctx,
					`https://www.okx.com/api/v5/market/books?instId=${encodeURIComponent(market)}&sz=400`,
				),
				json(
					ctx,
					`https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${encodeURIComponent(market)}`,
				),
			]);
			const data = (value: unknown, label: string) => {
				const body = object(value, label);
				if (body.code !== "0") throw new Error(`OKX error code ${body.code}`);
				return object(array(body.data, `${label} data`)[0], label);
			};
			const instrument = data(rawInstrument, "OKX instrument");
			if (instrument.ctType !== "linear")
				throw new Error(
					`${market}: only linear OKX swaps have base-unit books`,
				);
			const contract = positive(instrument.ctVal, `${market} ctVal`);
			const body = data(rawBook, "OKX books");
			const b = levels(body.bids, "bids", pair, contract);
			const a = levels(body.asks, "asks", pair, contract);
			return book(
				venue,
				market,
				b,
				a,
				now,
				at(b.length, 400) || at(a.length, 400),
			);
		}
		case "bitget": {
			const body = object(
				await json(
					ctx,
					`https://api.bitget.com/api/v2/mix/market/merge-depth?symbol=${encodeURIComponent(market)}&productType=USDT-FUTURES&limit=max`,
				),
				"Bitget depth",
			);
			if (body.code !== "00000")
				throw new Error(`Bitget error code ${String(body.code)}`);
			const data = object(body.data, "data");
			const b = levels(data.bids, "bids", pair);
			const a = levels(data.asks, "asks", pair);
			return book(
				venue,
				market,
				b,
				a,
				now,
				at(b.length, 100) || at(a.length, 100),
			);
		}
		case "bingx": {
			const body = object(
				await json(
					ctx,
					`https://open-api.bingx.com/openApi/swap/v2/quote/depth?symbol=${encodeURIComponent(market)}&limit=1000`,
				),
				"BingX depth",
			);
			if (body.code !== 0)
				throw new Error(`BingX error code ${String(body.code)}`);
			const data = object(body.data, "data");
			const b = levels(data.bidsCoin, "bids", pair);
			const a = levels(data.asksCoin, "asks", pair);
			return book(
				venue,
				market,
				b,
				a,
				now,
				at(b.length, 1000) || at(a.length, 1000),
			);
		}
		case "gate": {
			const [rawBook, rawContract] = await Promise.all([
				json(
					ctx,
					`https://api.gateio.ws/api/v4/futures/usdt/order_book?contract=${encodeURIComponent(market)}&limit=300`,
				),
				json(
					ctx,
					`https://api.gateio.ws/api/v4/futures/usdt/contracts/${encodeURIComponent(market)}`,
				),
			]);
			const contract = positive(
				object(rawContract, "Gate contract").quanto_multiplier,
				`${market} quanto_multiplier`,
			);
			const body = object(rawBook, "Gate order book");
			const parse = keyed("p", "s");
			const b = levels(body.bids, "bids", parse, contract);
			const a = levels(body.asks, "asks", parse, contract);
			return book(
				venue,
				market,
				b,
				a,
				now,
				at(b.length, 300) || at(a.length, 300),
			);
		}
		case "mexc": {
			const [rawBook, rawDetail] = await Promise.all([
				json(
					ctx,
					`https://contract.mexc.com/api/v1/contract/depth/${encodeURIComponent(market)}?limit=1000`,
				),
				json(
					ctx,
					`https://contract.mexc.com/api/v1/contract/detail?symbol=${encodeURIComponent(market)}`,
				),
			]);
			const unwrap = (value: unknown, label: string) => {
				const body = object(value, label);
				if (body.success !== true)
					throw new Error(`MEXC error code ${String(body.code)}`);
				return object(body.data, `${label} data`);
			};
			const contract = positive(
				unwrap(rawDetail, "MEXC detail").contractSize,
				`${market} contractSize`,
			);
			const data = unwrap(rawBook, "MEXC depth");
			const b = levels(data.bids, "bids", pair, contract);
			const a = levels(data.asks, "asks", pair, contract);
			return book(
				venue,
				market,
				b,
				a,
				now,
				at(b.length, 1000) || at(a.length, 1000),
			);
		}
		case "grvt": {
			const body = object(
				await json(ctx, "https://market-data.grvt.io/full/v1/book", {
					instrument: market,
					depth: 500,
				}),
				"GRVT book",
			);
			const result = object(body.result, "result");
			const parse = keyed("price", "size");
			const b = levels(result.bids, "bids", parse);
			const a = levels(result.asks, "asks", parse);
			return book(
				venue,
				market,
				b,
				a,
				now,
				at(b.length, 500) || at(a.length, 500),
			);
		}
		case "pacifica": {
			const body = object(
				await json(
					ctx,
					`https://api.pacifica.fi/api/v1/book?symbol=${encodeURIComponent(market)}`,
				),
				"Pacifica book",
			);
			if (body.success !== true)
				throw new Error("Pacifica book: not successful");
			const [bids, asks] = array(object(body.data, "data").l, "levels");
			const parse = keyed("p", "a");
			const b = levels(bids, "bids", parse);
			const a = levels(asks, "asks", parse);
			// Pacifica serves ten levels a side.
			return book(
				venue,
				market,
				b,
				a,
				now,
				at(b.length, 10) || at(a.length, 10),
			);
		}
		case "extended": {
			const body = object(
				await json(
					ctx,
					`https://api.starknet.extended.exchange/api/v1/info/markets/${encodeURIComponent(market)}/orderbook`,
				),
				"Extended orderbook",
			);
			if (body.status !== "OK")
				throw new Error(`Extended status ${String(body.status)}`);
			const data = object(body.data, "data");
			const parse = keyed("price", "qty");
			const b = levels(data.bid, "bids", parse);
			const a = levels(data.ask, "asks", parse);
			return book(venue, market, b, a, now, false);
		}
		case "paradex": {
			const body = object(
				await json(
					ctx,
					`https://api.prod.paradex.trade/v1/orderbook/${encodeURIComponent(market)}?depth=100`,
				),
				"Paradex orderbook",
			);
			const b = levels(body.bids, "bids", pair);
			const a = levels(body.asks, "asks", pair);
			return book(
				venue,
				market,
				b,
				a,
				now,
				at(b.length, 100) || at(a.length, 100),
			);
		}
		case "dydx": {
			const body = object(
				await json(
					ctx,
					`https://indexer.dydx.trade/v4/orderbooks/perpetualMarket/${encodeURIComponent(market)}`,
				),
				"dYdX orderbook",
			);
			const parse = keyed("price", "size");
			const b = levels(body.bids, "bids", parse);
			const a = levels(body.asks, "asks", parse);
			// The indexer serves at most 100 levels a side.
			return book(
				venue,
				market,
				b,
				a,
				now,
				at(b.length, 100) || at(a.length, 100),
			);
		}
		case "backpack": {
			const body = object(
				await json(
					ctx,
					`https://api.backpack.exchange/api/v1/depth?symbol=${encodeURIComponent(market)}`,
				),
				"Backpack depth",
			);
			const b = levels(body.bids, "bids", pair);
			const a = levels(body.asks, "asks", pair);
			return book(venue, market, b, a, now, false);
		}
		case "kucoin": {
			const [rawBook, rawContract] = await Promise.all([
				json(
					ctx,
					`https://api-futures.kucoin.com/api/v1/level2/depth100?symbol=${encodeURIComponent(market)}`,
				),
				json(
					ctx,
					`https://api-futures.kucoin.com/api/v1/contracts/${encodeURIComponent(market)}`,
				),
			]);
			const unwrap = (value: unknown, label: string) => {
				const body = object(value, label);
				if (body.code !== "200000")
					throw new Error(`KuCoin error code ${String(body.code)}`);
				return object(body.data, `${label} data`);
			};
			const contract = positive(
				unwrap(rawContract, "KuCoin contract").multiplier,
				`${market} multiplier`,
			);
			const data = unwrap(rawBook, "KuCoin depth");
			const b = levels(data.bids, "bids", pair, contract);
			const a = levels(data.asks, "asks", pair, contract);
			return book(
				venue,
				market,
				b,
				a,
				now,
				at(b.length, 100) || at(a.length, 100),
			);
		}
		default:
			throw new Error(
				BOOKLESS_VENUES.includes(venue)
					? `${venue} publishes no public order book`
					: `Unknown venue ${venue}`,
			);
	}
}

export async function fetchOrderBook(
	venue: string,
	market: string,
	options: BookOptions = {},
): Promise<OrderBook> {
	string(market, "market");
	const controller = new AbortController();
	const timeoutMs = options.timeoutMs ?? 15_000;
	const timer = setTimeout(
		() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)),
		timeoutMs,
	);
	try {
		const now = options.now ?? Date.now;
		const result = await read(
			{
				fetch: options.fetch ?? globalThis.fetch,
				signal: controller.signal,
				now,
				reportFailure: () => {},
			},
			venue,
			market,
		);
		timestamp(result.observedAt, "observedAt");
		return result;
	} catch (error) {
		throw new Error(
			`${venue}:${market}: ${errorMessage(error).replace(`${venue}:${market}: `, "")}`,
		);
	} finally {
		clearTimeout(timer);
		controller.abort();
	}
}
