const fields: Record<string, string> = {
	glossary:
		"Field meanings, venue names and calculation rules for this output.",
	source: "direct means venue reads; hosted means the MoB API.",
	observedAt: "Observation time in Unix milliseconds.",
	annualizationMethod: "simple: hourly rate × 24 × 365; never compounded.",
	venue: "Venue identifier; see glossary.venues for deployment names.",
	market: "Venue-native market string, preserved for execution.",
	base: "Normalized base ticker used only for cross-venue matching.",
	ratePerInterval:
		"Fractional funding rate over intervalHours; positive means longs pay shorts.",
	intervalHours: "Length of the funding interval in hours.",
	ratePerHour:
		"Fractional hourly rate: ratePerInterval divided by intervalHours.",
	annualizedPct: "Hourly fractional funding rate × 8760 × 100, in percent.",
	nextFundingAt: "Next funding settlement time in Unix milliseconds.",
	markPrice: "Current venue mark price in quote units per contract.",
	openInterestUsd: "Venue open interest in USD; absent means unavailable.",
	volume24hUsd: "Trailing 24-hour volume in USD; absent means unavailable.",
	oiCapped:
		"True when Hyperliquid refuses new opens at the market's open-interest cap.",
	quoteClass:
		"usd-stable for dollar stablecoin quotes; coin for coin-margined contracts.",
	contractMultiplier: "Base units represented by one venue contract.",
	rates: "Funding rows, or their count inside counts.",
	listed: "Unique venue:native-market listing keys.",
	failed: "Failed venue reads with explicit errors; no stale replacement data.",
	error: "Reported failure detail.",
	unmatched:
		"Listings whose native market cannot be classified, or their count inside counts.",
	view: "Filtered and bounded rows for display.",
	anywhere:
		"Best pairs across all venues after filters, including read-only venues.",
	opportunities:
		"All positive-spread cross-venue pairs, or their count inside counts.",
	counts:
		"Counts before top limits; hidden counts reflect active view filters.",
	qualifying: "Number of pairs satisfying qualifies before display filters.",
	thinHidden:
		"Pairs hidden because either leg has low or unknown 24-hour volume.",
	crossDeploymentHidden:
		"Non-thin executable pairs hidden because both legs are different Lighter deployments.",
	long: "Long leg's native venue and market, with funding and liquidity data.",
	short:
		"Short leg's native venue and market, with funding and liquidity data.",
	sizeUsd: "Reference notional in USD per leg.",
	holdDays:
		"Holding horizon used to amortize costs in netApyPct; default seven days.",
	spreadRate1hPct:
		"Short minus long hourly funding rate, in percentage points.",
	spreadAnnualizedPct:
		"Gross hourly funding spread × 8760, in percent per year.",
	netApyPct:
		"Gross annual spread minus (venue fees + builder fees + max(entry cost, 0)) × 365 / holdDays; null if marks are unavailable.",
	roundTripFeePct:
		"Estimated opening and closing taker fees on both legs, excluding builder fees, in percent.",
	builderFeePct:
		"Estimated opening and closing MoB builder fees on the HL leg, in percent.",
	entryCostPct:
		"Signed entry price-spread estimate from marks, in percent; null without both marks.",
	entryCostBasis:
		"mark means an estimate from marks, not executable book VWAP; unmeasured means unavailable.",
	breakEvenHours:
		"(Venue fees + builder fees + signed entry cost) / hourly spread; floor zero, null if costs are unknown or carry is nonpositive.",
	qualifies:
		"Requires both legs' known 24-hour volume at or above the configured threshold (default $1M), known costs and break-even within 24 hours; not an execution approval.",
	executable:
		"Requires both venues in hl/lighter/lighter-mainnet/aster and no HL open-interest cap; does not verify binding, funds, depth, policy or preflight (also names the executable view/count).",
	flags:
		"thin: low/unknown volume; cross-deployment: Lighter versus Lighter mainnet; hl-oi-capped: new HL opens blocked; coin-margined: coin quote; price-mismatch: prices too far apart to be one asset, never executable.",
	venueCategory:
		"The venue's own label for the underlying: crypto, stock, commodity, fx, index, pre-ipo, or rwa without a category.",
	totals: "Sums over every listing in scope; see the missing counts.",
	missingVolume:
		"Listings without a 24-hour volume figure; above zero, the volume sum is a lower bound.",
	missingOpenInterest:
		"Listings without an open-interest figure; above zero, the open-interest sum is a lower bound.",
	name: "Display name of the venue, or of the asset from the curated list; absent when unknown.",
	kind: "dex or cex.",
	mob: "True when MoB can open and close a pair on this venue.",
	markets: "Number of listings (venue:market rows).",
	takerFeeBps:
		"Taker fee per fill in basis points: the documented estimate, or the user's taker_fee_bps setting.",
	scope: "all, rwa or crypto: the assets that counts and totals cover.",
	matching:
		"Assets that pass the search and minimum volume, before the top limit.",
	crypto: "Number of crypto assets in the snapshot.",
	rwa: "Number of real-world assets in the snapshot.",
	assets:
		"Assets, or their number inside counts; one ticker can hold two assets, split by price.",
	categories:
		"RWA totals by category: assets, 24-hour volume and open interest.",
	category: "RWA category: stock, index, commodity, fx, pre-ipo, or other.",
	farm: "The best liquid real-world funding pair after fees; a pointer into mob scan, not advice.",
	ticker: "Canonical ticker; venue aliases such as GOLD for XAU fold into one.",
	variant:
		"1 for the main asset on a ticker; 2 and up for a different asset priced more than 25% away.",
	class:
		"crypto or rwa (real-world asset): venue labels first, the curated list second.",
	venues:
		"Distinct venues listing the asset; Hyperliquid builder deployments count separately.",
	price:
		"Mark price per base unit, in quote units; for an asset, volume-weighted across listings.",
	bestFunding:
		"The listing with the largest absolute annualized funding; negative pays longs.",
	widest:
		"Lowest- and highest-funding listings of the asset and their annualized difference, before fees, price gaps and depth.",
	priceRangePct:
		"Highest minus lowest listing price, over the lowest, in percent.",
	volumeSharePct:
		"This listing's share of the asset's known 24-hour volume, in percent.",
	nextFundingSource:
		"venue when the feed reports the time; hourly schedule for Hyperliquid, which settles on the hour.",
	by: "funding or price: what the scan ranks.",
	priceBasis: "mark: gaps come from mark prices, not order-book fills.",
	pairs: "Same-asset pairs priced apart, before view limits.",
	gapPct:
		"(rich price − cheap price) / cheap price, in percent, from mark prices per base unit.",
	gapAfterFeesPct: "gapPct minus round-trip taker fees on both legs.",
	fundingSpreadAnnualizedPct:
		"Short minus long funding, simple annualized percent; negative means the pair pays funding while open.",
	mismatchHidden:
		"Pairs hidden because their prices are too far apart to be one asset.",
	addedAt: "When the pair was saved, in Unix milliseconds.",
	alert:
		"Thresholds checked by mob watch --check: spreadAbove and spreadBelow in annualized percent, gapAbove in percent.",
	spreadAbove:
		"Alert when the funding spread rises above this annualized percent.",
	spreadBelow:
		"Alert when the funding spread falls below this annualized percent.",
	gapAbove: "Alert when the price gap rises above this percent.",
	triggered: "Alert thresholds this pair crosses now, in words.",
	alerts: "Number of saved pairs whose alerts fire now.",
	updated: "True when saving a saved pair changed its alert.",
	side: "long buys from the asks; short sells into the bids.",
	realized:
		"Settled funding of the short leg minus the long leg, simple annualized percent, over the last 1, 7 and 30 days; null when a leg has no settlement in the window.",
	d1: "Realized spread over the last day, simple annualized percent.",
	d7: "Realized spread over the last 7 days, simple annualized percent.",
	d30: "Realized spread over the last 30 days, simple annualized percent.",
	a: "The first market: the base of the spread, or its price per base unit.",
	b: "The second market, or its price per base unit.",
	interval: "Candle length: 15m, 1h, 4h, or 1d.",
	wti: "The venue's busiest WTI crude listing.",
	brent: "The venue's busiest Brent crude listing.",
	brentPremiumPct: "(Brent − WTI) / WTI on this venue, in percent, from marks.",
	carryLongWtiPct:
		"Funding per year for long WTI and short Brent on this venue: Brent's funding minus WTI's; negative pays.",
	premium: "Lowest and highest Brent premium across venues that list both.",
	best: "The pair with the best funding carry across venues for either direction, both legs above $1M daily volume.",
	direction: "Which benchmark is long and which is short.",
	carryPct: "Short leg funding minus long leg funding, per year, in percent.",
	candles: "Candles read from each market.",
	stats: "Summary of the spread over the window; null when no candles line up.",
	points: "Spread points at shared candle open times, oldest first.",
	spreadPct: "(b − a) / a × 100, from candle closes per base unit.",
	last: "The latest spread, in percent.",
	mean: "Average spread over the window, in percent.",
	min: "Lowest spread in the window, in percent.",
	max: "Highest spread in the window, in percent.",
	lastPercentile: "Share of points at or below the latest spread, in percent.",
	sizes: "USD sizes the cost is measured at.",
	costs: "One fill per size: walk the published book from the best price.",
	mid: "Midpoint of the best bid and best ask.",
	spreadBps: "Best ask minus best bid, over mid, in basis points.",
	truncated:
		"True when the venue returned its maximum number of levels, so deeper orders may exist.",
	filledUsd: "USD notional the published levels can fill, at most sizeUsd.",
	complete: "True when the published book fills the whole size.",
	averagePrice: "Average fill price across the levels used.",
	slippageBps: "Average fill against mid, in basis points; positive is a cost.",
	costBps:
		"slippageBps plus takerFeeBps; absent when the book cannot fill the size.",
	costUsd: "costBps applied to the size, in USD.",
	bookless: "Listings on venues that publish no public order book.",
	notListed: "Selected venues with no listing of this asset.",
	rows: "Listings of the asset, one per venue market, largest volume first.",
	priceChange24hPct: "Venue-reported 24-hour price change, in percent.",
	found: "False when either market is missing from this snapshot.",
	priceGapPct:
		"(short price − long price) / long price, in percent, from mark prices.",
	priceMismatch:
		"True when the two markets are priced too far apart to be one asset.",
	longVolume24hUsd: "Long leg trailing 24-hour volume in USD.",
	shortVolume24hUsd: "Short leg trailing 24-hour volume in USD.",
	longOpenInterestUsd: "Long leg open interest in USD.",
	shortOpenInterestUsd: "Short leg open interest in USD.",
	mobOpen:
		"Exact staging command; creates a Proposal and stops before signing.",
	startTime: "Requested history window start in Unix milliseconds.",
	endTime: "Requested history window end in Unix milliseconds.",
	history: "Historical funding series per supported native venue market.",
	bestPair:
		"Pair with the highest positive historical average spread; gross and coverage can differ.",
	unsupported: "Venues without keyless funding history.",
	missing: "Selected venues without a matching dollar-stable listing.",
	reason: "Explanation for an unavailable result.",
	samples: "Recorded funding observations in the requested window.",
	timestamp: "Observation time in Unix milliseconds.",
	time: "Funding sample timestamp in Unix milliseconds.",
	sampleCount: "Number of recorded funding samples.",
	hoursCovered:
		"Sum of sample interval hours; not necessarily the full requested window.",
	averageRatePerHour:
		"Total fractional funding divided by covered hours; null with no samples.",
	minRatePerHour: "Minimum observed fractional hourly funding rate.",
	maxRatePerHour: "Maximum observed fractional hourly funding rate.",
	tasks: "Public MoB position records; submitted is not confirmed execution.",
	trims: "Liquidation-protection trim attempts reported by the server.",
	resizes: "Resize attempts reported by the server.",
	task_id: "MoB position/task identifier.",
	owner: "Public wallet address owning the position.",
	status: "Current worker state reported by MoB.",
	size_usd: "Requested position notional in USD per leg.",
	min_funding_apy:
		"Minimum simple annual funding spread in percent for automatic closing.",
	max_spread_bps: "Maximum entry spread permitted, in basis points.",
	liq_protection_pct: "Liquidation-distance protection threshold in percent.",
	size_mismatch_pct: "Leg-size mismatch threshold in percent.",
	liq_trim_count: "Number of recorded liquidation-protection trims.",
	resize_count: "Number of recorded resizes.",
	resize_target_long: "Requested absolute long target size in base units.",
	resize_target_short: "Requested absolute short target size in base units.",
	funding_usd:
		"Estimated cumulative funding in USD; not a reconciled realized balance.",
	created_at: "Server record creation timestamp.",
	updated_at: "Last server record update timestamp.",
	funding_updated_at: "Last update of the funding estimate.",
	auto_close: "Whether the funding-based automatic close is enabled.",
	size_mismatch_suppressed:
		"Whether size mismatch closing is temporarily suppressed.",
	liq_protection_suspended:
		"Whether liquidation protection is temporarily suspended.",
	liq_trim_notice: "Latest liquidation-protection trim detail.",
	resize_notice: "Latest resize detail.",
	close_reason: "Server explanation for closing.",
	error_context:
		"Structured public server context for a failure; fields are preserved verbatim.",
	readiness: "Per-venue binding readiness checks.",
	issue:
		"Why the venue is not ready, computed locally from the server's binding state: not_bound, key_invalid, builder_fee_missing, integrator_approval_missing, or unavailable.",
	check: "The last readiness check that ran for this venue, named locally.",
	ready: "Whether the current credential passes readiness checks.",
	rebindAllowed: "Whether the server currently permits a new binding.",
	rebindError: "Reason the server refused the rebind check.",
};
for (const leg of ["long", "short"]) {
	for (const [name, meaning] of Object.entries({
		venue: "venue identifier",
		market: "native market string",
		price: "staged reference price in quote units",
		leverage: "stored leverage metadata, not verified venue leverage",
		margin_mode: "stored margin mode metadata",
		order_id: "venue order identifier",
		entry: "recorded entry price in quote units",
		size: "recorded position size in base units",
	}))
		fields[`${leg}_${name}`] =
			`${leg === "long" ? "Long" : "Short"} leg ${meaning}.`;
}
const venues = {
	hl: "Hyperliquid",
	lighter: "Lighter on Robinhood Chain",
	"lighter-mainnet": "Lighter mainnet",
	aster: "Aster",
	binance: "Binance USD-M",
	bybit: "Bybit",
	okx: "OKX",
	mexc: "MEXC futures",
	bingx: "BingX perpetual swaps",
	bitget: "Bitget USDT-M futures",
	gate: "Gate USDT perpetuals",
	grvt: "GRVT",
	variational: "Variational Omni",
	qfex: "QFEX",
	pacifica: "Pacifica",
	extended: "Extended (Starknet)",
	paradex: "Paradex",
	dydx: "dYdX v4",
	backpack: "Backpack USDC perpetuals",
	kucoin: "KuCoin USDT and USDC perpetuals",
};
const costModel =
	"Estimates, not quotes: default taker fees (bps per fill) hl 4.5, lighter 0, lighter-mainnet 0, aster 3.5, binance 5, bybit 5.5, okx 5, mexc 2, bingx 5, bitget 6, gate 7.5, grvt 4.5, variational 0, qfex 10; two fills per leg. HL builder fee defaults to 1.5 bps per fill, doubled against either Lighter deployment, on open and close. Config overrides apply. Entry uses marks, not book depth or slippage. Net APY amortizes nonnegative entry cost over holdDays; break-even uses signed entry cost. Annualization is simple, never compounded.";

/** Add documentation without changing any existing value or unbounded server data. */
/**
 * Attaches field meanings. `compact` keeps only the fields present in the
 * data and drops the cost model, for views an agent reads per row.
 */
export function withGlossary(
	data: unknown,
	options: { compact?: boolean } = {},
) {
	const meanings: Record<string, string> = options.compact
		? Object.create(null)
		: Object.assign(Object.create(null), fields);
	const seen = new Set<string>();
	function visit(value: unknown) {
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
		} else if (value && typeof value === "object")
			for (const [key, item] of Object.entries(value)) {
				// JSON drops undefined fields; a compact glossary must not list them.
				if (options.compact && item === undefined) continue;
				if (key === "venue" && typeof item === "string" && item in venues)
					seen.add(item);
				meanings[key] =
					fields[key] ??
					`Server-reported ${key
						.replaceAll("_", " ")
						.replace(/([a-z])([A-Z])/g, "$1 $2")
						.toLowerCase()}; retained as supplied by the API.`;
				visit(item);
			}
	}
	visit(data);
	return {
		...(data as object),
		glossary: {
			fields: meanings,
			// Compact rows name only the venues they mention and skip scan-only notes.
			...(options.compact
				? {
						venues: Object.fromEntries(
							Object.entries(venues).filter(([venue]) => seen.has(venue)),
						),
					}
				: {
						venues,
						costModel,
						executable: fields.executable,
						qualifies: fields.qualifies,
						annualization: fields.annualizationMethod,
					}),
		},
	};
}
