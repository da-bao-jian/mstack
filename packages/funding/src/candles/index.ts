import { json } from "../http.ts";
import type { Fetch, FetchContext } from "../types.ts";
import {
	array,
	errorMessage,
	object,
	positive,
	string,
	timestamp,
} from "../validation.ts";

// Public trade candles, one native market at a time, for spread charts.
// Each candle is its open time in Unix milliseconds and its close price in
// the venue's quote units per contract. Candles come back oldest first.

export const CANDLE_INTERVALS = ["15m", "1h", "4h", "1d"] as const;
export type CandleInterval = (typeof CANDLE_INTERVALS)[number];

export interface Candle {
	time: number;
	close: number;
}

export interface CandleSeries {
	venue: string;
	market: string;
	interval: CandleInterval;
	candles: Candle[];
	observedAt: number;
}

export interface CandleOptions {
	interval: CandleInterval;
	startTime: number;
	endTime: number;
	fetch?: Fetch;
	now?: () => number;
	timeoutMs?: number;
}

/** Venues that publish no keyless candles. */
export const CANDLELESS_VENUES: readonly string[] = ["variational", "qfex"];

const MS: Record<CandleInterval, number> = {
	"15m": 900_000,
	"1h": 3_600_000,
	"4h": 14_400_000,
	"1d": 86_400_000,
};

const LIGHTER: Readonly<Record<string, string>> = {
	lighter: "https://api.rh.lighter.xyz",
	"lighter-mainnet": "https://mainnet.zklighter.elliot.ai",
};

function candle(time: unknown, close: unknown, label: string): Candle {
	return {
		time: timestamp(time, `${label} time`),
		close: positive(close, `${label} close`),
	};
}

const fromArrays = (raw: unknown, label: string, closeAt = 4) =>
	array(raw, label).map((entry, index) => {
		const row = array(entry, `${label}[${index}]`);
		return candle(Number(row[0]), row[closeAt], `${label}[${index}]`);
	});

async function read(
	ctx: FetchContext,
	venue: string,
	market: string,
	options: CandleOptions,
): Promise<Candle[]> {
	const { interval, startTime, endTime } = options;
	const count = Math.ceil((endTime - startTime) / MS[interval]) + 1;
	switch (venue) {
		case "hl": {
			const body = await json(ctx, "https://api.hyperliquid.xyz/info", {
				type: "candleSnapshot",
				req: { coin: market, interval, startTime, endTime },
			});
			return array(body, "candles").map((entry, index) => {
				const row = object(entry, `candles[${index}]`);
				return candle(row.t, row.c, `candles[${index}]`);
			});
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
			if (!entry) throw new Error("unknown market");
			const body = object(
				await json(
					ctx,
					`${base}/api/v1/candles?market_id=${Number(entry.market_id)}&resolution=${interval}&start_timestamp=${startTime}&end_timestamp=${endTime}&count_back=${count}`,
				),
				"Lighter candles",
			);
			if (body.code !== 200) throw new Error(`Lighter error code ${body.code}`);
			return array(body.c, "candles").map((value, index) => {
				const row = object(value, `candles[${index}]`);
				return candle(row.t, row.c, `candles[${index}]`);
			});
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
			return fromArrays(
				await json(
					ctx,
					`${host}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=1500`,
				),
				"klines",
			);
		}
		case "bybit": {
			const code = { "15m": "15", "1h": "60", "4h": "240", "1d": "D" }[
				interval
			];
			const body = object(
				await json(
					ctx,
					`https://api.bybit.com/v5/market/kline?category=linear&symbol=${encodeURIComponent(market)}&interval=${code}&start=${startTime}&end=${endTime}&limit=1000`,
				),
				"Bybit kline",
			);
			if (body.retCode !== 0) throw new Error(`Bybit error ${body.retCode}`);
			return fromArrays(object(body.result, "result").list, "kline");
		}
		case "okx": {
			// OKX pages newest first, 100 at a time, before the `after` time.
			const bar = { "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D" }[
				interval
			];
			const rows: Candle[] = [];
			let after = endTime + 1;
			for (let page = 0; page < 20 && after > startTime; page++) {
				const body = object(
					await json(
						ctx,
						`https://www.okx.com/api/v5/market/history-candles?instId=${encodeURIComponent(market)}&bar=${bar}&after=${after}&limit=100`,
					),
					"OKX candles",
				);
				if (body.code !== "0") throw new Error(`OKX error code ${body.code}`);
				const batch = fromArrays(body.data, "candles");
				if (!batch.length) break;
				rows.push(...batch);
				after = Math.min(...batch.map((row) => row.time));
			}
			return rows;
		}
		case "bitget": {
			const granularity = { "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D" }[
				interval
			];
			const body = object(
				await json(
					ctx,
					`https://api.bitget.com/api/v2/mix/market/candles?symbol=${encodeURIComponent(market)}&productType=USDT-FUTURES&granularity=${granularity}&startTime=${startTime}&endTime=${endTime}&limit=1000`,
				),
				"Bitget candles",
			);
			if (body.code !== "00000")
				throw new Error(`Bitget error code ${String(body.code)}`);
			return fromArrays(body.data, "candles");
		}
		case "bingx": {
			const body = object(
				await json(
					ctx,
					`https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${encodeURIComponent(market)}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=1440`,
				),
				"BingX klines",
			);
			if (body.code !== 0)
				throw new Error(`BingX error code ${String(body.code)}`);
			return array(body.data, "klines").map((value, index) => {
				const row = object(value, `klines[${index}]`);
				return candle(row.time, row.close, `klines[${index}]`);
			});
		}
		case "gate": {
			const body = await json(
				ctx,
				`https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${encodeURIComponent(market)}&interval=${interval}&from=${Math.floor(startTime / 1000)}&to=${Math.floor(endTime / 1000)}`,
			);
			return array(body, "candlesticks").map((value, index) => {
				const row = object(value, `candlesticks[${index}]`);
				return candle(Number(row.t) * 1000, row.c, `candlesticks[${index}]`);
			});
		}
		case "mexc": {
			const code = {
				"15m": "Min15",
				"1h": "Min60",
				"4h": "Hour4",
				"1d": "Day1",
			}[interval];
			const body = object(
				await json(
					ctx,
					`https://contract.mexc.com/api/v1/contract/kline/${encodeURIComponent(market)}?interval=${code}&start=${Math.floor(startTime / 1000)}&end=${Math.floor(endTime / 1000)}`,
				),
				"MEXC kline",
			);
			if (body.success !== true)
				throw new Error(`MEXC error code ${String(body.code)}`);
			const data = object(body.data, "data");
			const times = array(data.time, "time");
			const closes = array(data.close, "close");
			if (times.length !== closes.length)
				throw new Error("MEXC kline: time and close lengths differ");
			return times.map((time, index) =>
				candle(Number(time) * 1000, closes[index], `kline[${index}]`),
			);
		}
		case "grvt": {
			const code = {
				"15m": "CI_15_M",
				"1h": "CI_1_H",
				"4h": "CI_4_H",
				"1d": "CI_1_D",
			}[interval];
			const body = object(
				await json(ctx, "https://market-data.grvt.io/full/v1/kline", {
					instrument: market,
					interval: code,
					type: "TRADE",
					start_time: `${startTime}000000`,
					end_time: `${endTime}000000`,
					limit: 1000,
				}),
				"GRVT kline",
			);
			return array(body.result, "kline").map((value, index) => {
				const row = object(value, `kline[${index}]`);
				const nanos = string(row.open_time, `kline[${index}] open_time`);
				if (!/^\d{7,}$/.test(nanos))
					throw new Error(`kline[${index}] open_time: expected nanoseconds`);
				return candle(Number(nanos.slice(0, -6)), row.close, `kline[${index}]`);
			});
		}
		case "pacifica": {
			const body = object(
				await json(
					ctx,
					`https://api.pacifica.fi/api/v1/kline?symbol=${encodeURIComponent(market)}&interval=${interval}&start_time=${startTime}&end_time=${endTime}`,
				),
				"Pacifica kline",
			);
			if (body.success !== true)
				throw new Error("Pacifica kline: not successful");
			return array(body.data, "kline").map((value, index) => {
				const row = object(value, `kline[${index}]`);
				return candle(row.t, row.c, `kline[${index}]`);
			});
		}
		case "extended": {
			const code = { "15m": "PT15M", "1h": "PT1H", "4h": "PT4H", "1d": "P1D" }[
				interval
			];
			const body = object(
				await json(
					ctx,
					`https://api.starknet.extended.exchange/api/v1/info/candles/${encodeURIComponent(market)}/trades?interval=${code}&limit=${count}&endTime=${endTime}`,
				),
				"Extended candles",
			);
			if (body.status !== "OK")
				throw new Error(`Extended status ${String(body.status)}`);
			return array(body.data, "candles").map((value, index) => {
				const row = object(value, `candles[${index}]`);
				return candle(row.T, row.c, `candles[${index}]`);
			});
		}
		case "paradex": {
			// Paradex serves at most hourly candles; longer ones fold the hours.
			const resolution = interval === "15m" ? 15 : 60;
			const body = object(
				await json(
					ctx,
					`https://api.prod.paradex.trade/v1/markets/klines?symbol=${encodeURIComponent(market)}&resolution=${resolution}&start_at=${startTime}&end_at=${endTime}`,
				),
				"Paradex klines",
			);
			const rows = fromArrays(body.results, "klines");
			if (interval === "15m" || interval === "1h") return rows;
			const folded = new Map<number, Candle>();
			for (const row of rows.sort((a, b) => a.time - b.time)) {
				const time = Math.floor(row.time / MS[interval]) * MS[interval];
				folded.set(time, { time, close: row.close });
			}
			return [...folded.values()];
		}
		case "dydx": {
			const code = {
				"15m": "15MINS",
				"1h": "1HOUR",
				"4h": "4HOURS",
				"1d": "1DAY",
			}[interval];
			const body = object(
				await json(
					ctx,
					`https://indexer.dydx.trade/v4/candles/perpetualMarkets/${encodeURIComponent(market)}?resolution=${code}&fromISO=${new Date(startTime).toISOString()}&toISO=${new Date(endTime).toISOString()}&limit=${Math.min(count, 100)}`,
				),
				"dYdX candles",
			);
			return array(body.candles, "candles").map((value, index) => {
				const row = object(value, `candles[${index}]`);
				return candle(
					Date.parse(string(row.startedAt, `candles[${index}] startedAt`)),
					row.close,
					`candles[${index}]`,
				);
			});
		}
		case "backpack": {
			const rows = await json(
				ctx,
				`https://api.backpack.exchange/api/v1/klines?symbol=${encodeURIComponent(market)}&interval=${interval}&startTime=${Math.floor(startTime / 1000)}&endTime=${Math.floor(endTime / 1000)}`,
			);
			return array(rows, "klines").map((value, index) => {
				const row = object(value, `klines[${index}]`);
				const start = string(row.start, `klines[${index}] start`);
				if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(start))
					throw new Error(`klines[${index}] start: expected UTC date and time`);
				return candle(
					Date.parse(`${start.replace(" ", "T")}Z`),
					row.close,
					`klines[${index}]`,
				);
			});
		}
		case "kucoin": {
			const granularity = { "15m": 15, "1h": 60, "4h": 240, "1d": 1440 }[
				interval
			];
			const body = object(
				await json(
					ctx,
					`https://api-futures.kucoin.com/api/v1/kline/query?symbol=${encodeURIComponent(market)}&granularity=${granularity}&from=${startTime}&to=${endTime}`,
				),
				"KuCoin kline",
			);
			if (body.code !== "200000")
				throw new Error(`KuCoin error code ${String(body.code)}`);
			return fromArrays(body.data, "kline");
		}
		default:
			throw new Error(
				CANDLELESS_VENUES.includes(venue)
					? `${venue} publishes no public candles`
					: `Unknown venue ${venue}`,
			);
	}
}

export async function fetchCandles(
	venue: string,
	market: string,
	options: CandleOptions,
): Promise<CandleSeries> {
	string(market, "market");
	if (!(CANDLE_INTERVALS as readonly string[]).includes(options.interval))
		throw new Error(`interval must be one of ${CANDLE_INTERVALS.join(", ")}`);
	timestamp(options.startTime, "startTime");
	timestamp(options.endTime, "endTime");
	if (options.startTime >= options.endTime)
		throw new Error("startTime must be before endTime");
	const controller = new AbortController();
	const timeoutMs = options.timeoutMs ?? 20_000;
	const timer = setTimeout(
		() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)),
		timeoutMs,
	);
	const now = options.now ?? Date.now;
	try {
		const rows = await read(
			{
				fetch: options.fetch ?? globalThis.fetch,
				signal: controller.signal,
				now,
				reportFailure: () => {},
			},
			venue,
			market,
			options,
		);
		// Oldest first, one candle per open time, inside the window.
		const byTime = new Map<number, Candle>();
		for (const row of rows)
			if (
				row.time >= options.startTime - MS[options.interval] &&
				row.time <= options.endTime
			)
				byTime.set(row.time, row);
		return {
			venue,
			market,
			interval: options.interval,
			candles: [...byTime.values()].sort((a, b) => a.time - b.time),
			observedAt: timestamp(now(), "observedAt"),
		};
	} catch (error) {
		throw new Error(`${venue}:${market}: ${errorMessage(error)}`);
	} finally {
		clearTimeout(timer);
		controller.abort();
	}
}
