import type { ObservedFundingRate, Snapshot } from "@mstack/funding";
import type { MarketClassification, QuoteClass } from "./classify.ts";

export interface RankOptions {
	sizeUsd: number;
	/** Per-venue overrides of the documented fee estimates. */
	takerFeeBps?: Readonly<Record<string, number>>;
	builderFeeTenthsBps?: number;
	breakEvenHours?: number;
	/** Minimum known 24h USD volume on each leg; default $1,000,000. */
	minVolume24hUsd?: number;
	/** Fee amortization horizon; default seven days. */
	holdDays?: number;
	executableVenues?: readonly string[];
	quoteClasses?: readonly QuoteClass[];
}

export interface OpportunityLeg
	extends ObservedFundingRate,
		MarketClassification {}

export interface Opportunity {
	base: string;
	long: OpportunityLeg;
	short: OpportunityLeg;
	sizeUsd: number;
	spreadRate1hPct: number;
	spreadAnnualizedPct: number;
	netApyPct: number | null;
	/** Open and close taker fees on both legs; excludes the builder fee. */
	roundTripFeePct: number;
	builderFeePct: number;
	entryCostPct: number | null;
	entryCostBasis: "mark" | "unmeasured";
	breakEvenHours: number | null;
	qualifies: boolean;
	executable: boolean;
	flags: ("hl-oi-capped" | "coin-margined" | "cross-deployment" | "thin")[];
	mobOpen?: string;
	observedAt: number;
	source: Snapshot["source"];
	annualizationMethod: "simple";
}

export interface RankedOpportunities {
	holdDays: number;
	observedAt: number;
	source: Snapshot["source"];
	annualizationMethod: "simple";
	failed: Snapshot["failed"];
	unmatched: { venue: string; market: string }[];
	opportunities: Opportunity[];
}
