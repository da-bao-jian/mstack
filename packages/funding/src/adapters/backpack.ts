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
	volume,
} from "../validation.ts";

const BASE = "https://api.backpack.exchange/api/v1";

/**
 * Backpack perpetuals: markets give each perpetual's funding interval, mark
 * prices the current rate and next settlement, tickers the 24-hour USD volume,
 * and open interest comes in base units. Only open order books emit rows.
 * A `.US` base is a US stock.
 */
export const backpack: VenueAdapter = {
	venue: "backpack",
	tier: "C",
	async fetchRates(ctx) {
		const [rawMarkets, rawMarks, rawTickers, rawInterest] = await Promise.all([
			json(ctx, `${BASE}/markets`),
			json(ctx, `${BASE}/markPrices`),
			json(ctx, `${BASE}/tickers`),
			json(ctx, `${BASE}/openInterest`),
		]);
		const bySymbol = (raw: unknown, label: string) => {
			const map = new Map<string, Record<string, unknown>>();
			for (const value of array(raw, label)) {
				const entry = object(value, label);
				const symbol = string(entry.symbol, `${label} symbol`);
				if (map.has(symbol)) throw new Error(`${label}: duplicate ${symbol}`);
				map.set(symbol, entry);
			}
			return map;
		};
		const marks = bySymbol(rawMarks, "Backpack markPrices");
		const tickers = bySymbol(rawTickers, "Backpack tickers");
		const interest = bySymbol(rawInterest, "Backpack openInterest");
		const rows = array(rawMarkets, "Backpack markets").flatMap((value) => {
			const entry = object(value, "Backpack market");
			const market = string(entry.symbol, "symbol");
			if (entry.marketType !== "PERP" || entry.orderBookState !== "Open")
				return [];
			const mark = marks.get(market);
			if (!mark) throw new Error(`${market}: missing mark price row`);
			const markPrice = positive(mark.markPrice, `${market} markPrice`);
			const ticker = tickers.get(market);
			const open = interest.get(market);
			return [
				rate(
					ctx,
					"backpack",
					market,
					numeric(mark.fundingRate, `${market} fundingRate`),
					positive(entry.fundingInterval, `${market} fundingInterval`) /
						3_600_000,
					{
						markPrice,
						nextFundingAt: timestamp(
							mark.nextFundingTimestamp,
							`${market} nextFundingTimestamp`,
						),
						...(ticker
							? volume(ticker.quoteVolume, `${market} quoteVolume`)
							: {}),
						...(ticker?.priceChangePercent === undefined
							? {}
							: {
									priceChange24hPct:
										numeric(
											ticker.priceChangePercent,
											`${market} priceChangePercent`,
										) * 100,
								}),
						...(open
							? {
									openInterestUsd:
										nonnegative(open.openInterest, `${market} openInterest`) *
										markPrice,
								}
							: {}),
						...(market.includes(".US_")
							? { venueCategory: "stock" as const }
							: {}),
					},
				),
			];
		});
		unique(
			rows.map((row) => row.market),
			"Backpack markets",
		);
		return rows;
	},
};
