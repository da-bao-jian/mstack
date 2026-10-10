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
					return [rate(ctx, venue, market, funding, 8)];
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
