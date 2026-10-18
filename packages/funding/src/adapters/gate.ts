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

/** USDT-settled perpetuals; the BTC-settled book is a separate feed. */
const BASE = "https://api.gateio.ws/api/v4/futures/usdt";

export const gate: VenueAdapter = {
	venue: "gate",
	tier: "C",
	async fetchRates(ctx) {
		const [rawContracts, rawTickers] = await Promise.all([
			json(ctx, `${BASE}/contracts`),
			json(ctx, `${BASE}/tickers`),
		]);
		const tickers = new Map<string, Record<string, unknown>>();
		for (const value of array(rawTickers, "Gate tickers")) {
			const entry = object(value, "Gate ticker");
			const market = string(entry.contract, "contract");
			if (tickers.has(market))
				throw new Error(`Duplicate Gate ticker ${market}`);
			tickers.set(market, entry);
		}
		const rows = array(rawContracts, "Gate contracts").flatMap((value) => {
			const entry = object(value, "Gate contract");
			const market = string(entry.name, "name");
			if (typeof entry.in_delisting !== "boolean")
				throw new Error(`${market}: invalid in_delisting`);
			if (
				entry.in_delisting ||
				string(entry.status, `${market} status`) !== "trading"
			)
				return [];
			const markPrice = positive(entry.mark_price, `${market} mark_price`);
			const ticker = tickers.get(market);
			if (!ticker) throw new Error(`${market}: missing Gate ticker row`);
			return [
				rate(
					ctx,
					"gate",
					market,
					numeric(entry.funding_rate, `${market} funding_rate`),
					positive(entry.funding_interval, `${market} funding_interval`) / 3600,
					{
						nextFundingAt:
							timestamp(
								entry.funding_next_apply,
								`${market} funding_next_apply`,
							) * 1000,
						markPrice,
						// Open interest is in contracts; each contract is quanto_multiplier base units.
						openInterestUsd:
							nonnegative(ticker.total_size, `${market} total_size`) *
							positive(entry.quanto_multiplier, `${market} quanto_multiplier`) *
							markPrice,
						volume24hUsd: nonnegative(
							ticker.volume_24h_settle,
							`${market} volume_24h_settle`,
						),
						priceChange24hPct: numeric(
							ticker.change_percentage,
							`${market} change_percentage`,
						),
					},
				),
			];
		});
		unique(
			rows.map((row) => row.market),
			"Gate contracts",
		);
		return rows;
	},
};
