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

const BASE = "https://open-api.bingx.com/openApi/swap/v2/quote";

function data(value: unknown, label: string): unknown[] {
	const body = object(value, label);
	if (body.code !== 0)
		throw new Error(`${label}: error code ${String(body.code)}`);
	return array(body.data, `${label} data`);
}

export const bingx: VenueAdapter = {
	venue: "bingx",
	tier: "C",
	async fetchRates(ctx) {
		const [rawPremium, rawTicker] = await Promise.all([
			json(ctx, `${BASE}/premiumIndex`),
			json(ctx, `${BASE}/ticker`),
		]);
		const tickers = new Map<
			string,
			{ volume24hUsd: number; priceChange24hPct: number }
		>();
		for (const value of data(rawTicker, "BingX ticker")) {
			const entry = object(value, "BingX ticker row");
			const market = string(entry.symbol, "symbol");
			if (tickers.has(market))
				throw new Error(`Duplicate BingX ticker ${market}`);
			tickers.set(market, {
				volume24hUsd: nonnegative(entry.quoteVolume, `${market} quoteVolume`),
				priceChange24hPct: numeric(
					entry.priceChangePercent,
					`${market} priceChangePercent`,
				),
			});
		}
		// Open interest is only served per symbol, so it stays unknown here.
		const rows = data(rawPremium, "BingX premiumIndex").map((value) => {
			const entry = object(value, "BingX premiumIndex row");
			const market = string(entry.symbol, "symbol");
			return rate(
				ctx,
				"bingx",
				market,
				numeric(entry.lastFundingRate, `${market} lastFundingRate`),
				positive(entry.fundingIntervalHours, `${market} fundingIntervalHours`),
				{
					nextFundingAt: timestamp(
						entry.nextFundingTime,
						`${market} nextFundingTime`,
					),
					markPrice: positive(entry.markPrice, `${market} markPrice`),
					...tickers.get(market),
				},
			);
		});
		unique(
			rows.map((row) => row.market),
			"BingX premiumIndex",
		);
		return rows;
	},
};
