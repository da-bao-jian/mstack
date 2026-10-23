# Market fields

- `class`: `crypto` or `rwa` (real-world asset). Venues label their own markets: OKX `instCategory`, Bitget `isRwa`, and Hyperliquid's xyz and io deployments list only real-world assets. One labeled listing classifies every venue's listing of that asset. A curated list fills in where no venue labels a ticker.
- `category`: for real-world assets only: `stock` (shares and ETFs), `index`, `commodity`, `fx`, `pre-ipo`, or `other` when no source names one.
- `variant`: 1 for the main asset on a ticker; 2 and up when the same ticker names a different asset, found because its price is more than 25% away.
- `ticker`: the shared spelling. Venue aliases fold in: GOLD is XAU, SILVER is XAG, SMSN is SAMSUNG, OAI is OPENAI.
- `venues`: distinct venues, counting Hyperliquid's builder deployments (hl:xyz, hl:io) separately. `markets` counts every listing, so one venue can list USDT and USDC markets.
- `volume24hUsd`, `openInterestUsd`: sums over the listings that report them. `missingVolume` and `missingOpenInterest` count listings without a figure; Binance, OKX, BingX and Aster publish no bulk open interest.
- `bestFunding`: the listing with the largest absolute annualized funding. A negative rate pays longs.
- `nextFundingSource`: `venue` when the feed reports the time; `hourly schedule` for Hyperliquid, which settles every hour on the hour.
- `widest`: the lowest-funding and highest-funding listings of one asset. It ignores fees, price gaps and depth; `mob scan --market <BASE>` ranks pairs after fees.
- `farm` (with `--rwa`): the best real-world funding pair after fees that is liquid and priced as one asset.
- `takerFeeBps` (venues): the documented estimate, or the user's `taker_fee_bps.<venue>` setting.
- Watchlist: `~/.mob/watchlist.json`, at most 50 pairs. `found: false` means a market is missing from this snapshot; `priceMismatch` means the two markets are not one asset. `alert` holds `spreadAbove`, `spreadBelow` (annualized percent) and `gapAbove` (percent); `triggered` lists the thresholds a pair crosses now, and `alerts` counts such pairs.
- `mob cost`: one row per listing with a public book. `costs` holds one fill per size: `mid`, `filledUsd`, `complete`, `averagePrice`, `slippageBps` (average fill against mid), `takerFeeBps`, `costBps` and `costUsd`. `truncated` means the venue returned its maximum number of levels, so deeper orders may exist. Hyperliquid publishes 20 levels a side; Lighter returns 250 orders.
- `mob spread`: `points` are `{ time, a, b, spreadPct }` at shared candle open times, per base unit; `stats` gives `last`, `mean`, `min`, `max` and `lastPercentile`. Intervals are 15m (up to 7 days), 1h (60), 4h (180) and 1d (365).
- `mob oil`: each venue's busiest WTI and Brent listing (WTI, USOIL and CL fold into CL; BZ and UKOIL into BRENTOIL), the Brent premium on that venue, and `carryLongWtiPct`: Brent's funding minus WTI's, per year. `best` is the best funding carry across venues for either direction, both legs priced and above $1M daily volume.
