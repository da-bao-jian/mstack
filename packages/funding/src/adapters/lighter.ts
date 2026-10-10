import { json } from "../http.ts";
import type { VenueAdapter } from "../types.ts";
import { array, numeric, object, rate, string, unique } from "../validation.ts";

function deployment(
	venue: "lighter" | "lighter-mainnet",
	baseUrl: string,
): VenueAdapter {
	return {
		venue,
		tier: "A",
		async fetchRates(ctx) {
			const body = object(
				await json(ctx, `${baseUrl}/api/v1/funding-rates`),
				"Lighter response",
			);
			if (body.code !== 200) throw new Error(`Lighter error code ${body.code}`);
			const rows = array(body.funding_rates, "funding_rates").map((value) => {
				const entry = object(value, "Lighter row");
				const exchange = string(entry.exchange, "exchange");
				if (
					!["lighter", "binance", "bybit", "hyperliquid"].includes(exchange)
				) {
					throw new Error(`Unknown Lighter exchange ${exchange}`);
				}
				const target =
					exchange === "lighter"
						? venue
						: exchange === "hyperliquid"
							? "hl"
							: exchange;
				const market = string(entry.symbol, "symbol");
				// This endpoint normalizes all exchanges to an eight-hour rate.
				return rate(
					ctx,
					target,
					market,
					numeric(entry.rate, `${market} rate`),
					8,
					exchange === "lighter"
						? {}
						: { source: "lighter-mirror", sourceVenue: venue },
				);
			});
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
