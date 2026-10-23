# @mstack/funding

Read-only venue adapters and fresh funding snapshots. This package has no runtime dependencies.

```ts
import {
  aster, binance, bingx, bitget, bybit, fetchSnapshot, gate, grvt,
  hyperliquid, lighter, lighterMainnet, mexc, okx, qfex, variational,
} from "@mstack/funding";

const snapshot = await fetchSnapshot(
  [hyperliquid, lighter, lighterMainnet, aster, binance, bybit, okx,
   mexc, bingx, bitget, gate, grvt, variational, qfex],
  { timeoutMs: 60_000 },
);
```

`failed` contains venue names and errors. It can contain `hl` with a named builder dex while healthy Hyperliquid rows remain. A core failure discards all Hyperliquid rows. Builder requests have their own deadlines within the snapshot timeout. There are no retries or cached rates.

Every row carries `observedAt` in Unix milliseconds, `source`, and `annualizationMethod: "simple"`. Annualization is `ratePerInterval / intervalHours × 24 × 365 × 100`. Optional fields use milliseconds for `nextFundingAt` and USD for `markPrice` and `openInterestUsd`.

Native market names remain intact: `kPEPE`, `xyz:NVDA`, `USD1:BTC`, `BTCUSDT`, and `BTC-USDT-SWAP`. Aster follows the upstream USDT/USD1 market scope. Binance and Bybit dated futures and delisted Hyperliquid markets do not emit funding rows. OKX makes four parallel requests: SWAP instruments, bulk funding (`instId=ANY`), SWAP mark prices, and SWAP tickers. Only instruments marked `live` emit rows. Missing funding or marks for a live instrument fails the adapter.

Optional `volume24hUsd` is the bulk feed's 24-hour USD turnover: HL `dayNtlVlm`, Lighter `daily_quote_token_volume`, Bybit `turnover24h`, and Aster/Binance `ticker/24hr.quoteVolume`. OKX uses `volCcy24h × markPx` (base volume, not contract volume). Missing fields or ticker rows leave volume unknown; negative or malformed values fail the adapter. Aster and Binance fetch their bulk tickers alongside funding and marks.

Seven venues added on 2026-10-18 keep native names too: MEXC `BTC_USDT` (USDT, USDC, and USD1 settlement; coin-margined contracts are skipped), BingX `BTC-USDT`, Bitget `BTCUSDT` (USDT-M product only), Gate `BTC_USDT` (USDT book, delisting contracts skipped), GRVT `BTC_USDT_Perp`, Variational `BTC-PERP` (perpetuals only; swaps carry separate long and short rates), and QFEX `AAPL-USD` (USD quotes only). GRVT quotes an eight-hour rate in percentage points for every instrument, so the adapter scales it to the instrument's interval; QFEX publishes a percentage per hour. Open interest in USD is MEXC `holdVol × contractSize × fairPrice`, Bitget `holdingAmount × markPrice`, Gate `total_size × quanto_multiplier × mark_price`, GRVT `open_interest × mark_price`, Variational trader long plus short notional, and QFEX `open_interest_usd`; BingX serves it per symbol only, so it stays unknown. Volume is MEXC `amount24`, BingX `quoteVolume`, Bitget `usdtVolume`, Gate `volume_24h_settle`, GRVT taker buy plus sell quote volume, Variational `volume_24h`, and QFEX `target_volume`. GRVT tickers are one request per instrument, issued sixteen at a time. QFEX has no mark price in its feed, so entry cost stays unmeasured there.

Six venues added on 2026-10-23 read one bulk feed each, except Backpack. Pacifica `info/prices` (`next_funding` per hour; open interest in base units; the `info` instrument list drops spot pairs), Extended `info/markets` (active perpetuals; hourly `fundingRate`; open interest and volume in USD; its `RWA` category becomes `venueCategory: "rwa"`), Paradex `markets/summary?market=ALL` (perpetuals; `funding_rate` per `funding_interval_minutes`), dYdX `perpetualMarkets` (active markets; hourly `nextFundingRate`; the oracle price stands in for the mark), Backpack `markets`, `markPrices`, `tickers` and `openInterest` (open perpetuals; each market's `fundingInterval`; `.US` bases are stocks), and KuCoin `contracts/active` (linear perpetuals; `fundingFeeRate` per `fundingRateGranularity`; open interest in contracts of `multiplier`; XBT is bitcoin). Their books, candles and (except Paradex, whose funding is continuous) settled history are read too; see below.

Lighter joins `funding-rates` with `orderBookDetails` by symbol. It preserves inactive listings, omits an explicitly zero mark, and rejects negative or malformed marks. When a mark exists, open interest in USD is the reported base open interest times that mark. Missing details for a funding symbol fail the adapter.

Both Lighter deployments validate every feed row, including its exchange name, and emit only their own `exchange === "lighter"` rows. Competitor mirror rows are excluded because they use Lighter's symbol namespace and lower precision. Binance, Bybit, and Hyperliquid come from their direct adapters. `source` is `"direct" | "hosted"`; `listed` contains unique native `venue:market` keys.

`src/index.ts` and its tests are byte-exact upstream copies after a provenance header. Their legacy exports still accept four venues and uppercase names. `ObservedFundingRate` extends the canonical row with an open venue identifier and metadata. Adapters preserve native names and use the upstream annualization function. Use `fetchSnapshot` for adapter rows; the legacy lookup helpers retain their upstream contract.

Run `bun test` for offline fixture tests. Both root and package test configurations disable global network access. Run `MOB_LIVE=1 bun run live:smoke` from the repository root for a live check. The smoke check prints row counts per venue and exits nonzero when any venue or builder dex fails.

## Public history

`fetchFundingHistory(venue, nativeMarket, { startTime, endTime, timeoutMs?, fetch?, now? })` reads keyless settled funding for HL, both Lighter deployments, Binance, Aster, Bybit, OKX, Pacifica, Extended, dYdX, Backpack, and KuCoin (`HISTORY_VENUES`). Pacifica, dYdX and Backpack serve their newest 1,000 hourly settlements (about 41 days); Extended takes a time range; KuCoin reads a day early so its first 8-hour sample has a predecessor. Times are Unix milliseconds. Other venues throw `no keyless history`. Lighter finds the market id in `orderBookDetails`, then reads `/api/v1/fundings` hourly in disjoint 500-hour pages; each row is a percent rate and the paying side, so `direction: "long"` is a positive rate and `"short"` a negative one. Aster's native `USD1:BTC` maps to its API symbol `BTCUSD1`; HIP-3 names remain dex-qualified.

HL and Lighter samples have a one-hour interval. Other venues use the elapsed time from each preceding settlement, including changes in interval. Binance and Aster request one day of boundary context with both time bounds; Aster's end-time-only response can return an old listing settlement. Bybit fetches the preceding settlement separately. OKX pages backward with `after` until it includes a boundary row and uses `realizedRate`. Forward Binance/Aster and backward Bybit pages handle their respective limits. Duplicate settlements, stalled cursors, missing required boundaries, malformed rows, and HTTP errors throw. There are no retries or guessed intervals. If Binance/Aster have no predecessor in the extra day, history fails explicitly. An empty history has zero samples and null statistics.

The result includes samples, sample count, covered hours, average/min/max per-hour rates, and simple annualization. Average is `Σ ratePerInterval / Σ intervalHours`; min/max are per-hour fractions. Coverage is the sum of measured settlement intervals, not a promise of complete retention. Timestamp jitter remains in measured intervals. Venue retention and gaps can limit coverage; compare the reported hours before comparing averages.

Endpoint semantics follow the official [Binance](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History), [Aster](https://asterdex.github.io/aster-api-website/futures-v3/market-data/#get-funding-rate-history), [Bybit](https://bybit-exchange.github.io/docs/v5/market/history-fund-rate), and [OKX](https://www.okx.com/docs-v5/en/#public-data-rest-api-get-funding-rate-history) references, checked against the recorded responses.

## Order books and candles

`fetchOrderBook(venue, nativeMarket, { fetch?, now?, timeoutMs? })` reads one public order book and returns `bids` and `asks` as `[price, base size]`, best first, plus `truncated` when the venue returned its maximum number of levels. Hyperliquid `l2Book` (20 levels a side), Lighter `orderBookOrders` (250 orders, summed by price, after a market-id lookup), Aster and Binance `depth` (1000), Bybit `orderbook` (500), OKX `books` (400, contracts times `ctVal` from the instrument; linear swaps only), Bitget `merge-depth` (100), BingX `depth` coin sizes (1000), Gate `order_book` (300, contracts times `quanto_multiplier`), MEXC `depth` (1000, contracts times `contractSize`), GRVT `book` (500), Pacifica `book` (10), Extended `orderbook`, Paradex `orderbook` (100), dYdX indexer `orderbooks` (100), Backpack `depth`, and KuCoin `level2/depth100` (contracts times `multiplier`). Variational and QFEX publish no book (`BOOKLESS_VENUES`). Empty, crossed, or malformed books throw with the venue and market named.

`fetchCandles(venue, nativeMarket, { interval, startTime, endTime, fetch?, now?, timeoutMs? })` reads public trade candles at `15m`, `1h`, `4h` or `1d` and returns `{ time, close }` oldest first, one per open time, inside the window. OKX pages `history-candles` backward 100 at a time; Gate and MEXC use seconds, GRVT nanoseconds, dYdX ISO times and Backpack UTC date strings, all normalized to milliseconds. Paradex serves at most hourly candles, so 4h and 1d fold its hours. Variational and QFEX publish no candles (`CANDLELESS_VENUES`).
