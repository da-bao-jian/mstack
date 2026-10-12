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

export const bybit: VenueAdapter = {
	venue: "bybit",
	tier: "C",
	async fetchRates(ctx) {
		const body = object(
			await json(
				ctx,
				"https://api.bybit.com/v5/market/tickers?category=linear",
			),
			"Bybit response",
		);
		if (body.retCode !== 0) throw new Error(`Bybit error code ${body.retCode}`);
		const result = object(body.result, "Bybit result");
		if (result.category !== "linear") throw new Error("Bybit: wrong category");
		const rows = array(result.list, "Bybit list").flatMap((value) => {
			const entry = object(value, "Bybit ticker");
			const market = string(entry.symbol, "symbol");
			// Linear tickers include dated futures, which do not pay funding.
			if (timestamp(entry.deliveryTime, `${market} deliveryTime`) > 0)
				return [];
			return [
				rate(
					ctx,
					"bybit",
					market,
					numeric(entry.fundingRate, `${market} fundingRate`),
					positive(entry.fundingIntervalHour, `${market} fundingIntervalHour`),
					{
						...volume(entry.turnover24h, `${market} turnover24h`),
						nextFundingAt: timestamp(
							entry.nextFundingTime,
							`${market} nextFundingTime`,
						),
						markPrice: positive(entry.markPrice, `${market} markPrice`),
						openInterestUsd: nonnegative(
							entry.openInterestValue,
							`${market} openInterestValue`,
						),
						priceChange24hPct:
							numeric(entry.price24hPcnt, `${market} price24hPcnt`) * 100,
					},
				),
			];
		});
		unique(
			rows.map((row) => row.market),
			"Bybit tickers",
		);
		return rows;
	},
};
