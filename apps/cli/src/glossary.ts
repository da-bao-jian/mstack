const fields: Record<string, string> = {
	glossary:
		"Field meanings, venue names and calculation rules for this output.",
	source: "direct means venue reads; hosted means the Mobius API.",
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
		"Estimated opening and closing Mobius builder fees on the HL leg, in percent.",
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
		"thin: low/unknown volume; cross-deployment: Lighter versus Lighter mainnet; hl-oi-capped: new HL opens blocked; coin-margined: coin quote.",
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
	tasks:
		"Public Mobius position records; submitted is not confirmed execution.",
	trims: "Liquidation-protection trim attempts reported by the server.",
	resizes: "Resize attempts reported by the server.",
	task_id: "Mobius position/task identifier.",
	owner: "Public wallet address owning the position.",
	status: "Current worker state reported by Mobius.",
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
};
const costModel =
	"Estimates, not quotes: default taker fees (bps per fill) hl 4.5, lighter 0, lighter-mainnet 0, aster 3.5, binance 5, bybit 5.5, okx 5, mexc 2, bingx 5, bitget 6, gate 7.5, grvt 4.5, variational 0, qfex 10; two fills per leg. HL builder fee defaults to 1.5 bps per fill, doubled against either Lighter deployment, on open and close. Config overrides apply. Entry uses marks, not book depth or slippage. Net APY amortizes nonnegative entry cost over holdDays; break-even uses signed entry cost. Annualization is simple, never compounded.";

/** Add documentation without changing any existing value or unbounded server data. */
export function withGlossary(data: unknown) {
	const meanings: Record<string, string> = Object.assign(
		Object.create(null),
		fields,
	);
	function visit(value: unknown) {
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
		} else if (value && typeof value === "object")
			for (const [key, item] of Object.entries(value)) {
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
			venues,
			costModel,
			executable: fields.executable,
			qualifies: fields.qualifies,
			annualization: fields.annualizationMethod,
		},
	};
}
