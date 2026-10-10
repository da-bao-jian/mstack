# @mstack/opportunities

Pure funding opportunity classification and ranking. This package reads a funding snapshot and makes no network requests.

```ts
import { rankOpportunities } from "@mstack/opportunities";

const result = rankOpportunities(snapshot, { sizeUsd: 1_000 });
// result.opportunities: positive-carry pairs, sorted by netApyPct (null last)
// result.unmatched: every venue/market that could not be classified
// result.failed: failures carried through from the input snapshot
```

## Fee and filter defaults

Fees are estimates. Override them for the user's actual account tier and venue terms.

| Venue | Estimated taker fee (bps per order) |
|---|---:|
| hl | 4.5 |
| lighter | 0 |
| lighter-mainnet | 0 |
| aster | 3.5 |
| binance | 5 |
| bybit | 5.5 |
| okx | 5 |

`takerFeeBps` merges per-venue overrides into these defaults. `builderFeeTenthsBps` defaults to 15 (1.5 bps). `breakEvenHours` defaults to 24. `sizeUsd` is required and must be positive.

`executableVenues` defaults to `["hl", "lighter", "lighter-mainnet", "aster"]`. `quoteClasses` defaults to `["usd-stable"]`. Include `"coin"` explicitly to compare coin-margined OKX swaps. Empty filter arrays are allowed and select nothing.

`minVolume24hUsd` defaults to $1,000,000 on each leg. A leg below this threshold, or with unknown volume, adds `thin` and forces `qualifies: false`. Execution support is unaffected. Setting the threshold to zero accepts measured zero volume; unknown volume stays thin.

## Market identity

| Venue | Native market examples | Matching base and multiplier |
|---|---|---|
| hl | `BTC`, `xyz:NVDA`, `kPEPE` | BTC ×1, NVDA ×1, PEPE ×1000 |
| lighter / lighter-mainnet | `BTC`, `PEPE` | Symbol as-is, ×1 |
| aster | `BTC`, `USD1:BTC` | BTC ×1 |
| binance | `BTCUSDT`, `BTCUSDC`, `1000PEPEUSDT` | BTC ×1, PEPE ×1000 |
| bybit | `BTCUSDT`, `BTCPERP`, `1000PEPEUSDT` | BTC ×1, PEPE ×1000 |
| okx | `BTC-USDT-SWAP`, `BTC-USDC-SWAP` | BTC ×1, usd-stable |
| okx | `BTC-USD-SWAP` | BTC ×1, coin |

`classifyMarket(venue, market)` returns `{ base, quoteClass, contractMultiplier }` or `null`. A null classification is copied into `unmatched`; ranking continues. Recognized rows excluded by `quoteClasses` are policy exclusions, not unmatched symbols.

Every leg retains its native market, rate, mark, and observation metadata. Contract multipliers affect the mark price used for comparison, not the funding rate. Different HIP-3 listings remain distinct. Pairs must use different venues; multiple listings of the same base on one venue can each pair with another venue.

All venues recognize numeric unit prefixes consisting of `1` followed by zeros and a letter: `10000SATS` becomes SATS ×10000. HL's `k` plus uppercase rule remains ×1000. Base tickers support Unicode letters and digits. Binance also recognizes USD1 quotes; `ETHBTC` and `ETHU` remain unmatched. A pair between the two Lighter deployments carries `cross-deployment` and remains executable.

## Calculations and output

Hourly funding is `ratePerInterval / intervalHours`. The long leg has the lower hourly rate. Equal rates produce no opportunity. `spreadRate1hPct` is the short-minus-long hourly difference ×100. `spreadAnnualizedPct` is that hourly percentage ×8760, simple and not compounded.

`roundTripFeePct` includes open and close taker fees on both legs: `2 × (longFeeBps + shortFeeBps) / 100`. It excludes the separately reported `builderFeePct`. The builder fee applies to open and close on the HL leg only. It doubles when the other leg is either Lighter deployment. Pairs without HL have zero builder fee.

When both marks exist, divide each mark by its contract multiplier and pass equal base exposure to the unchanged upstream `fundingEntryPriceSpreadCost`. `entryCostPct` uses that helper's combined-leg-notional denominator and can be negative. `entryCostBasis` is `"mark"`. The helper accepts entry prices directly, so future book VWAP prices can use the same pure interface without an order-book dependency.

When either mark is missing, `entryCostPct` is `null`, `entryCostBasis` is `"unmeasured"`, `breakEvenHours` is `null`, and `qualifies` is false. Missing marks are never replaced with zero entry cost.

With measured marks, total cost is `roundTripFeePct + builderFeePct + entryCostPct`. Break-even is total cost divided by `spreadRate1hPct`. Nonpositive spread returns `null`; nonpositive cost with positive spread returns `0`. `qualifies` means the known break-even is at most the configured window. Values retain JavaScript floating-point precision; display rounding belongs to callers.

For example, equal-mark HL/Lighter rows with a 0.01% hourly spread have 0.09% taker fees and 0.06% builder fees. Break-even is 15 hours. The simple annualized spread is approximately 87.6%.

`netApyPct = spreadAnnualizedPct − (roundTripFeePct + builderFeePct + max(entryCostPct, 0)) × (365 / holdDays)`. The positive `holdDays` option defaults to 7 and is included in the result. Costs are amortized over that hold period. A favorable mark estimate never increases net APY; break-even keeps the signed entry-cost calculation above. Missing entry cost produces null net APY. Opportunities sort by net APY descending, with null last. Despite its name, net APY uses simple annualization, not compounding, and assumes the current spread persists.

`executable` means both venues are in `executableVenues` and no HL leg is OI-capped. It is independent of `qualifies`. An OI cap adds `hl-oi-capped`; an included coin-margined leg adds `coin-margined`. Only executable rows include:

```text
mob open <BASE> --long <venue>:<nativeMarket> --short <venue>:<nativeMarket> --size <sizeUsd>
```

The result and each opportunity carry `observedAt`, `source`, and `annualizationMethod: "simple"`. Results retain `failed` and list every null classification in `unmatched`. Ranking does not mutate its snapshot. Invalid numeric inputs and duplicate recognized `venue:market` rows throw.

## Upstream parity and scope

The five functions in `src/upstream.ts` are copied verbatim from `mobius@33ed2ece tg-monitor/src/monitoring/scanner.ts`. Tests copy the pure cases from its test file and pin function-source digests. The upstream builder helper keeps its original two-venue signature; ranking maps both Lighter deployments to its Lighter branch and other counterparts to its non-Lighter branch.

HIP-3 fee-scale and referral helpers are exported unchanged. Ranking uses the supplied per-venue fee estimates; the funding snapshot does not supply fee-scale or referral inputs. Break-even follows the W2 assignment's explicit percentage model and null semantics.

The only runtime dependency is the local `@mstack/funding` workspace, for canonical types and constants. No order books, WebSockets, Telegram, signing, or key handling are included. Run `bun run check`, `bun run lint`, and `bun test` in this package for offline checks.
