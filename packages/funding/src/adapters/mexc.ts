import { json } from "../http.ts";
import type { VenueAdapter } from "../types.ts";
import {
	array,
	nonnegative,
	numeric,
	object,
	positive,
	rate,
	string,
	timestamp,
	unique,
} from "../validation.ts";

const BASE = "https://contract.mexc.com/api/v1/contract";
/** Linear perpetuals only; coin-margined contracts quote OI in contract units. */
const SETTLE = new Set(["USDT", "USDC", "USD1"]);

function data(value: unknown, label: string): unknown[] {
	const body = object(value, label);
	if (body.success !== true || body.code !== 0)
		throw new Error(`${label}: error code ${String(body.code)}`);
	return array(body.data, `${label} data`);
}

export const mexc: VenueAdapter = {
	venue: "mexc",
	tier: "C",
	async fetchRates(ctx) {
		const [rawDetail, rawFunding, rawTicker] = await Promise.all([
			json(ctx, `${BASE}/detail`),
			json(ctx, `${BASE}/funding_rate`),
			json(ctx, `${BASE}/ticker`),
		]);
		const details = new Map<string, { contractSize: number }>();
		for (const value of data(rawDetail, "MEXC detail")) {
			const entry = object(value, "MEXC contract");
			const market = string(entry.symbol, "symbol");
			if (details.has(market))
				throw new Error(`Duplicate MEXC contract ${market}`);
			const settle = string(entry.settleCoin, `${market} settleCoin`);
			// state 0 is a trading contract; delivery, paused, and offline states
			// are listed with other codes.
			if (!SETTLE.has(settle) || numeric(entry.state, `${market} state`) !== 0)
				continue;
			details.set(market, {
				contractSize: positive(entry.contractSize, `${market} contractSize`),
			});
		}
		const tickers = new Map<
			string,
			{ holdVol: number; amount24: number; priceChange24hPct: number }
		>();
		for (const value of data(rawTicker, "MEXC ticker")) {
			const entry = object(value, "MEXC ticker row");
			const market = string(entry.symbol, "symbol");
			if (tickers.has(market))
				throw new Error(`Duplicate MEXC ticker ${market}`);
			tickers.set(market, {
				holdVol: nonnegative(entry.holdVol, `${market} holdVol`),
				amount24: nonnegative(entry.amount24, `${market} amount24`),
				priceChange24hPct:
					numeric(entry.riseFallRate, `${market} riseFallRate`) * 100,
			});
		}
		const rows = data(rawFunding, "MEXC funding").flatMap((value) => {
			const entry = object(value, "MEXC funding row");
			const market = string(entry.symbol, "symbol");
			const detail = details.get(market);
			if (!detail) return [];
			const ticker = tickers.get(market);
			if (!ticker) throw new Error(`${market}: missing MEXC ticker row`);
			const markPrice = positive(entry.fairPrice, `${market} fairPrice`);
			return [
				rate(
					ctx,
					"mexc",
					market,
					numeric(entry.fundingRate, `${market} fundingRate`),
					positive(entry.collectCycle, `${market} collectCycle`),
					{
						nextFundingAt: timestamp(
							entry.nextSettleTime,
							`${market} nextSettleTime`,
						),
						markPrice,
						openInterestUsd: ticker.holdVol * detail.contractSize * markPrice,
						volume24hUsd: ticker.amount24,
						priceChange24hPct: ticker.priceChange24hPct,
					},
				),
			];
		});
		unique(
			rows.map((row) => row.market),
			"MEXC funding",
		);
		return rows;
	},
};
