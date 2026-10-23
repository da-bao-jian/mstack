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
	unique,
	volume,
} from "../validation.ts";

/**
 * Pacifica settles funding every hour. `next_funding` is the estimated rate
 * for the coming settlement, as a fraction per hour; open interest is in base
 * units and 24-hour volume in USD. The instrument list says which symbols are
 * perpetuals; spot pairs such as SOL-USDC share the price feed and are skipped.
 */
export const pacifica: VenueAdapter = {
	venue: "pacifica",
	tier: "C",
	async fetchRates(ctx) {
		const [rawPrices, rawInfo] = await Promise.all([
			json(ctx, "https://api.pacifica.fi/api/v1/info/prices"),
			json(ctx, "https://api.pacifica.fi/api/v1/info"),
		]);
		const data = (raw: unknown, label: string) => {
			const body = object(raw, label);
			if (body.success !== true) throw new Error(`${label}: not successful`);
			return array(body.data, `${label} data`).map((value) =>
				object(value, label),
			);
		};
		const kinds = new Map(
			data(rawInfo, "Pacifica info").map((entry) => [
				string(entry.symbol, "symbol"),
				string(entry.instrument_type, "instrument_type"),
			]),
		);
		const rows = data(rawPrices, "Pacifica prices").flatMap((entry) => {
			const market = string(entry.symbol, "symbol");
			const kind = kinds.get(market);
			if (kind === undefined) throw new Error(`${market}: missing instrument`);
			if (kind !== "perpetual") return [];
			const markPrice = positive(entry.mark, `${market} mark`);
			const yesterday = numeric(
				entry.yesterday_price,
				`${market} yesterday_price`,
			);
			return [
				rate(
					ctx,
					"pacifica",
					market,
					numeric(entry.next_funding, `${market} next_funding`),
					1,
					{
						markPrice,
						openInterestUsd:
							nonnegative(entry.open_interest, `${market} open_interest`) *
							markPrice,
						...volume(entry.volume_24h, `${market} volume_24h`),
						...(yesterday > 0
							? {
									priceChange24hPct:
										((markPrice - yesterday) / yesterday) * 100,
								}
							: {}),
					},
				),
			];
		});
		unique(
			rows.map((row) => row.market),
			"Pacifica prices",
		);
		return rows;
	},
};
