import type { FundingRate } from "./index.ts";

/** The upstream row, with an open venue identifier and observation metadata. */
export interface ObservedFundingRate extends Omit<FundingRate, "venue"> {
	venue: string;
	observedAt: number;
	nextFundingAt?: number;
	markPrice?: number;
	openInterestUsd?: number;
	volume24hUsd?: number;
	priceChange24hPct?: number;
	oiCapped?: boolean;
	/** The venue's own label for the underlying, when its feed publishes one. */
	venueCategory?: VenueCategory;
	source: "direct" | "hosted";
	annualizationMethod: "simple";
}

/** "rwa" is a real-world asset the venue labels without a category. */
export const VENUE_CATEGORIES = [
	"crypto",
	"stock",
	"commodity",
	"fx",
	"index",
	"pre-ipo",
	"rwa",
] as const;
export type VenueCategory = (typeof VENUE_CATEGORIES)[number];

export interface VenueFailure {
	venue: string;
	error: string;
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface FetchContext {
	fetch: Fetch;
	signal: AbortSignal;
	now: () => number;
	/** Monotonic performance.now() deadline, when called through fetchSnapshot. */
	deadline?: number;
	/** Reports an isolated builder-dex failure without discarding other dexes. */
	reportFailure: (failure: VenueFailure) => void;
}

export interface VenueAdapter {
	venue: string;
	tier: "A" | "B" | "C";
	fetchRates(ctx: FetchContext): Promise<ObservedFundingRate[]>;
}

export interface Snapshot {
	observedAt: number;
	rates: ObservedFundingRate[];
	/** Unique venue:native-market keys. */
	listed: string[];
	failed: VenueFailure[];
	source: "direct" | "hosted";
	annualizationMethod: "simple";
}
