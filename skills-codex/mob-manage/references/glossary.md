# Output glossary

Use this reference and the JSON glossary to explain output; do not inspect the source tree.
API reachability is advisory. A slow or unreachable Mobius API never changes a direct venue scan.

## Venues

- hl: Hyperliquid.
- lighter: Lighter on Robinhood Chain.
- lighter-mainnet: Lighter mainnet.
- aster: Aster.
- binance: Binance USD-M.
- bybit: Bybit.
- okx: OKX.

## Calculation rules

Estimates, not quotes: default taker fees (bps per fill) hl 4.5, lighter 0, lighter-mainnet 0, aster 3.5, binance 5, bybit 5.5, okx 5; two fills per leg. HL builder fee defaults to 1.5 bps per fill, doubled against either Lighter deployment, on open and close. Config overrides apply. Entry uses marks, not book depth or slippage. Net APY amortizes nonnegative entry cost over holdDays; break-even uses signed entry cost. Annualization is simple, never compounded.

Requires both venues in hl/lighter/lighter-mainnet/aster and no HL open-interest cap; does not verify binding, funds, depth, policy or preflight (also names the executable view/count).

Requires both legs' known 24-hour volume at or above the configured threshold (default $1M), known costs and break-even within 24 hours; not an execution approval.

Cross-deployment pairs stay out of the executable view unless --include-cross-deployment is set; Best anywhere can still show them. Thin pairs require --include-thin. Neither flag changes the ranking math or qualifies.

## Fields

| Field | Meaning |
|---|---|
| annualizationMethod | simple: hourly rate × 24 × 365; never compounded. |
| annualizedPct | Hourly fractional funding rate × 8760 × 100, in percent. |
| anywhere | Best pairs across all venues after filters, including read-only venues. |
| auto_close | Whether the funding-based automatic close is enabled. |
| averageRatePerHour | Total fractional funding divided by covered hours; null with no samples. |
| base | Normalized base ticker used only for cross-venue matching. |
| bestPair | Pair with the highest positive historical average spread; gross and coverage can differ. |
| breakEvenHours | (Venue fees + builder fees + signed entry cost) / hourly spread; floor zero, null if costs are unknown or carry is nonpositive. |
| builderFeePct | Estimated opening and closing Mobius builder fees on the HL leg, in percent. |
| close_reason | Server explanation for closing. |
| contractMultiplier | Base units represented by one venue contract. |
| counts | Counts before top limits; hidden counts reflect active view filters. |
| created_at | Server record creation timestamp. |
| crossDeploymentHidden | Non-thin executable pairs hidden because both legs are different Lighter deployments. |
| endTime | Requested history window end in Unix milliseconds. |
| entryCostBasis | mark means an estimate from marks, not executable book VWAP; unmeasured means unavailable. |
| entryCostPct | Signed entry price-spread estimate from marks, in percent; null without both marks. |
| error | Reported failure detail. |
| error_context | Structured public server context for a failure; fields are preserved verbatim. |
| executable | Requires both venues in hl/lighter/lighter-mainnet/aster and no HL open-interest cap; does not verify binding, funds, depth, policy or preflight (also names the executable view/count). |
| failed | Failed venue reads with explicit errors; no stale replacement data. |
| flags | thin: low/unknown volume; cross-deployment: Lighter versus Lighter mainnet; hl-oi-capped: new HL opens blocked; coin-margined: coin quote. |
| funding_updated_at | Last update of the funding estimate. |
| funding_usd | Estimated cumulative funding in USD; not a reconciled realized balance. |
| glossary | Field meanings, venue names and calculation rules for this output. |
| history | Historical funding series per supported native venue market. |
| holdDays | Holding horizon used to amortize costs in netApyPct; default seven days. |
| hoursCovered | Sum of sample interval hours; not necessarily the full requested window. |
| intervalHours | Length of the funding interval in hours. |
| liq_protection_pct | Liquidation-distance protection threshold in percent. |
| liq_protection_suspended | Whether liquidation protection is temporarily suspended. |
| liq_trim_count | Number of recorded liquidation-protection trims. |
| liq_trim_notice | Latest liquidation-protection trim detail. |
| listed | Unique venue:native-market listing keys. |
| long | Long leg's native venue and market, with funding and liquidity data. |
| long_entry | Long leg recorded entry price in quote units. |
| long_leverage | Long leg stored leverage metadata, not verified venue leverage. |
| long_margin_mode | Long leg stored margin mode metadata. |
| long_market | Long leg native market string. |
| long_order_id | Long leg venue order identifier. |
| long_price | Long leg staged reference price in quote units. |
| long_size | Long leg recorded position size in base units. |
| long_venue | Long leg venue identifier. |
| market | Venue-native market string, preserved for execution. |
| markPrice | Current venue mark price in quote units per contract. |
| max_spread_bps | Maximum entry spread permitted, in basis points. |
| maxRatePerHour | Maximum observed fractional hourly funding rate. |
| min_funding_apy | Minimum simple annual funding spread in percent for automatic closing. |
| minRatePerHour | Minimum observed fractional hourly funding rate. |
| missing | Selected venues without a matching dollar-stable listing. |
| mobOpen | Exact staging command; creates a Proposal and stops before signing. |
| netApyPct | Gross annual spread minus (venue fees + builder fees + max(entry cost, 0)) × 365 / holdDays; null if marks are unavailable. |
| nextFundingAt | Next funding settlement time in Unix milliseconds. |
| observedAt | Observation time in Unix milliseconds. |
| oiCapped | True when Hyperliquid refuses new opens at the market's open-interest cap. |
| openInterestUsd | Venue open interest in USD; absent means unavailable. |
| opportunities | All positive-spread cross-venue pairs, or their count inside counts. |
| owner | Public wallet address owning the position. |
| qualifies | Requires both legs' known 24-hour volume at or above the configured threshold (default $1M), known costs and break-even within 24 hours; not an execution approval. |
| qualifying | Number of pairs satisfying qualifies before display filters. |
| quoteClass | usd-stable for dollar stablecoin quotes; coin for coin-margined contracts. |
| ratePerHour | Fractional hourly rate: ratePerInterval divided by intervalHours. |
| ratePerInterval | Fractional funding rate over intervalHours; positive means longs pay shorts. |
| rates | Funding rows, or their count inside counts. |
| readiness | Per-venue binding readiness checks. |
| ready | Whether the current credential passes readiness checks. |
| reason | Explanation for an unavailable result. |
| rebindAllowed | Whether the server currently permits a new binding. |
| rebindError | Reason the server refused the rebind check. |
| resize_count | Number of recorded resizes. |
| resize_notice | Latest resize detail. |
| resize_target_long | Requested absolute long target size in base units. |
| resize_target_short | Requested absolute short target size in base units. |
| resizes | Resize attempts reported by the server. |
| roundTripFeePct | Estimated opening and closing taker fees on both legs, excluding builder fees, in percent. |
| sampleCount | Number of recorded funding samples. |
| samples | Recorded funding observations in the requested window. |
| short | Short leg's native venue and market, with funding and liquidity data. |
| short_entry | Short leg recorded entry price in quote units. |
| short_leverage | Short leg stored leverage metadata, not verified venue leverage. |
| short_margin_mode | Short leg stored margin mode metadata. |
| short_market | Short leg native market string. |
| short_order_id | Short leg venue order identifier. |
| short_price | Short leg staged reference price in quote units. |
| short_size | Short leg recorded position size in base units. |
| short_venue | Short leg venue identifier. |
| size_mismatch_pct | Leg-size mismatch threshold in percent. |
| size_mismatch_suppressed | Whether size mismatch closing is temporarily suppressed. |
| size_usd | Requested position notional in USD per leg. |
| sizeUsd | Reference notional in USD per leg. |
| source | direct means venue reads; hosted means the Mobius API. |
| spreadAnnualizedPct | Gross hourly funding spread × 8760, in percent per year. |
| spreadRate1hPct | Short minus long hourly funding rate, in percentage points. |
| startTime | Requested history window start in Unix milliseconds. |
| status | Current worker state reported by Mobius. |
| task_id | Mobius position/task identifier. |
| tasks | Public Mobius position records; submitted is not confirmed execution. |
| thinHidden | Pairs hidden because either leg has low or unknown 24-hour volume. |
| time | Funding sample timestamp in Unix milliseconds. |
| timestamp | Observation time in Unix milliseconds. |
| trims | Liquidation-protection trim attempts reported by the server. |
| unmatched | Listings whose native market cannot be classified, or their count inside counts. |
| unsupported | Venues without keyless funding history. |
| updated_at | Last server record update timestamp. |
| venue | Venue identifier; see glossary.venues for deployment names. |
| view | Filtered and bounded rows for display. |
| volume24hUsd | Trailing 24-hour volume in USD; absent means unavailable. |

Additional public error or activity fields are preserved as server-reported context; their JSON glossary entries say so. Null means unavailable, never zero. Submission acknowledgement is not confirmed execution.
