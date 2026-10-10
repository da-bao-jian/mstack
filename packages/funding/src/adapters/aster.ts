import type { VenueAdapter } from "../types.ts";
import { premiumIndexRates } from "./premium-index.ts";

export const aster: VenueAdapter = {
	venue: "aster",
	tier: "A",
	fetchRates: (ctx) =>
		premiumIndexRates(ctx, "aster", "https://fapi.asterdex.com/fapi/v3"),
};
