import { json } from "../http.ts";
import type { VenueAdapter } from "../types.ts";
import {
	array,
	nonnegative,
	numeric,
	object,
	rate,
	string,
	unique,
	volume,
} from "../validation.ts";

function deployment(
	venue: "lighter" | "lighter-mainnet",
	baseUrl: string,
): VenueAdapter {
	return {
		venue,
		tier: "A",
		async fetchRates(ctx) {
			const [funding, details] = await Promise.all([
				json(ctx, `${baseUrl}/api/v1/funding-rates`),
				json(ctx, `${baseUrl}/api/v1/orderBookDetails`),
			]);
			const body = object(funding, "Lighter response");
			if (body.code !== 200) throw new Error(`Lighter error code ${body.code}`);
			const books = object(details, "Lighter orderBookDetails");
			if (books.code !== 200)
				throw new Error(`Lighter error code ${books.code}`);
			const marks = new Map<
				string,
				{ markPrice?: number; openInterestUsd?: number; volume24hUsd?: number }
			>();
			for (const value of array(
				books.order_book_details,
				"order_book_details",
			)) {
				const entry = object(value, "Lighter market details");
				const symbol = string(entry.symbol, "symbol");
				if (marks.has(symbol))
					throw new Error(`Duplicate Lighter details ${symbol}`);
				const markPrice = nonnegative(entry.mark_price, `${symbol} mark_price`);
				const openInterest = nonnegative(
					entry.open_interest,
					`${symbol} open_interest`,
				);
				// Inactive markets still quote. Only an explicit zero mark is unmeasured.
				marks.set(symbol, {
					...volume(
						entry.daily_quote_token_volume,
						`${symbol} daily_quote_token_volume`,
					),
					...(markPrice === 0
						? {}
						: {
								markPrice,
								openInterestUsd: nonnegative(
									openInterest * markPrice,
									`${symbol} openInterestUsd`,
								),
							}),
				});
			}
			const rows = array(body.funding_rates, "funding_rates").flatMap(
				(value) => {
					const entry = object(value, "Lighter row");
					const exchange = string(entry.exchange, "exchange");
					if (
						!["lighter", "binance", "bybit", "hyperliquid"].includes(exchange)
					) {
						throw new Error(`Unknown Lighter exchange ${exchange}`);
					}
					const market = string(entry.symbol, "symbol");
					const funding = numeric(entry.rate, `${market} rate`);
					// Validate every feed row, but only emit this deployment's own rates.
					if (exchange !== "lighter") return [];
					const mark = marks.get(market);
					if (!mark)
						throw new Error(`${market}: missing Lighter orderBookDetails row`);
					return [rate(ctx, venue, market, funding, 8, mark)];
				},
			);
			unique(
				rows.map((row) => `${row.venue}:${row.market}`),
				"Lighter rates",
			);
			return rows;
		},
	};
}

export const lighter = deployment("lighter", "https://api.rh.lighter.xyz");
export const lighterMainnet = deployment(
	"lighter-mainnet",
	"https://mainnet.zklighter.elliot.ai",
);
