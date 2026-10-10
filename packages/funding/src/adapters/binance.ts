import type { VenueAdapter } from "../types.ts";
import { premiumIndexRates } from "./premium-index.ts";

export const binance: VenueAdapter = {
	venue: "binance",
	tier: "C",
	fetchRates: (ctx) =>
		premiumIndexRates(ctx, "binance", "https://fapi.binance.com/fapi/v1"),
};
