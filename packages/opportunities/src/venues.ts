// Who runs each venue, for the venue directory and the DEX/CEX filters.
// Hyperliquid's builder deployments trade as separate exchanges, so they get
// their own entry: a market keyed hl with an xyz: prefix is trade.xyz.

export type VenueKind = "dex" | "cex";

export interface VenueInfo {
	name: string;
	kind: VenueKind;
}

export const VENUE_INFO: Readonly<Record<string, VenueInfo>> = {
	hl: { name: "Hyperliquid", kind: "dex" },
	"hl:xyz": { name: "trade.xyz on Hyperliquid", kind: "dex" },
	"hl:io": { name: "Entropy on Hyperliquid", kind: "dex" },
	lighter: { name: "Lighter on Robinhood Chain", kind: "dex" },
	"lighter-mainnet": { name: "Lighter", kind: "dex" },
	aster: { name: "Aster", kind: "dex" },
	grvt: { name: "GRVT", kind: "dex" },
	variational: { name: "Variational", kind: "dex" },
	qfex: { name: "QFEX", kind: "dex" },
	pacifica: { name: "Pacifica", kind: "dex" },
	extended: { name: "Extended", kind: "dex" },
	paradex: { name: "Paradex", kind: "dex" },
	dydx: { name: "dYdX", kind: "dex" },
	backpack: { name: "Backpack", kind: "cex" },
	kucoin: { name: "KuCoin", kind: "cex" },
	binance: { name: "Binance", kind: "cex" },
	bybit: { name: "Bybit", kind: "cex" },
	okx: { name: "OKX", kind: "cex" },
	mexc: { name: "MEXC", kind: "cex" },
	bingx: { name: "BingX", kind: "cex" },
	bitget: { name: "Bitget", kind: "cex" },
	gate: { name: "Gate", kind: "cex" },
};

/** Venues MoB can open and close a pair on. */
export const MOB_VENUES: readonly string[] = [
	"hl",
	"lighter",
	"lighter-mainnet",
	"aster",
];

/** The directory key of a row: its venue, or hl:<dex> for a builder market. */
export function venueKey(venue: string, market: string): string {
	if (venue !== "hl") return venue;
	const colon = market.indexOf(":");
	return colon > 0 ? `hl:${market.slice(0, colon)}` : "hl";
}

export function venueKind(venue: string): VenueKind | undefined {
	return VENUE_INFO[venue]?.kind;
}
