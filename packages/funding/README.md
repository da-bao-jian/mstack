# @mstack/funding

Read-only venue adapters and fresh funding snapshots. This package has no runtime dependencies.

```ts
import {
  aster, binance, bybit, fetchSnapshot, hyperliquid,
  lighter, lighterMainnet, okx,
} from "@mstack/funding";

const snapshot = await fetchSnapshot(
  [hyperliquid, lighter, lighterMainnet, aster, binance, bybit, okx],
  { timeoutMs: 60_000 },
);
```

`failed` contains venue names and errors. It can contain `hl` with a named builder dex while healthy Hyperliquid rows remain. A core failure discards all Hyperliquid rows. Builder requests have their own deadlines within the snapshot timeout. There are no retries or cached rates.

Every row carries `observedAt` in Unix milliseconds, `source`, and `annualizationMethod: "simple"`. Annualization is `ratePerInterval / intervalHours × 24 × 365 × 100`. Optional fields use milliseconds for `nextFundingAt` and USD for `markPrice` and `openInterestUsd`.

Native market names remain intact: `kPEPE`, `xyz:NVDA`, `USD1:BTC`, `BTCUSDT`, and `BTC-USDT-SWAP`. Aster follows the upstream USDT/USD1 market scope. Binance and Bybit dated futures and delisted Hyperliquid markets do not emit funding rows. OKX makes four parallel requests: SWAP instruments, bulk funding (`instId=ANY`), SWAP mark prices, and SWAP tickers. Only instruments marked `live` emit rows. Missing funding or marks for a live instrument fails the adapter.

Optional `volume24hUsd` is the bulk feed's 24-hour USD turnover: HL `dayNtlVlm`, Lighter `daily_quote_token_volume`, Bybit `turnover24h`, and Aster/Binance `ticker/24hr.quoteVolume`. OKX uses `volCcy24h × markPx` (base volume, not contract volume). Missing fields or ticker rows leave volume unknown; negative or malformed values fail the adapter. Aster and Binance fetch their bulk tickers alongside funding and marks.

Lighter joins `funding-rates` with `orderBookDetails` by symbol. It preserves inactive listings, omits an explicitly zero mark, and rejects negative or malformed marks. When a mark exists, open interest in USD is the reported base open interest times that mark. Missing details for a funding symbol fail the adapter.

Both Lighter deployments validate every feed row, including its exchange name, and emit only their own `exchange === "lighter"` rows. Competitor mirror rows are excluded because they use Lighter's symbol namespace and lower precision. Binance, Bybit, and Hyperliquid come from their direct adapters. `source` is `"direct" | "hosted"`; `listed` contains unique native `venue:market` keys.

`src/index.ts` and its tests are byte-exact upstream copies after a provenance header. Their legacy exports still accept four venues and uppercase names. `ObservedFundingRate` extends the canonical row with an open venue identifier and metadata. Adapters preserve native names and use the upstream annualization function. Use `fetchSnapshot` for adapter rows; the legacy lookup helpers retain their upstream contract.

Run `bun test` for offline fixture tests. Both root and package test configurations disable global network access. Run `MOB_LIVE=1 bun run live:smoke` from the repository root for a live check. The smoke check prints row counts per venue and exits nonzero when any venue or builder dex fails.

## Public history

`fetchFundingHistory(venue, nativeMarket, { startTime, endTime, timeoutMs?, fetch?, now? })` reads keyless settled funding for HL, Binance, Aster, Bybit, and OKX. Times are Unix milliseconds. Lighter throws `no keyless history`. Aster's native `USD1:BTC` maps to its API symbol `BTCUSD1`; HIP-3 names remain dex-qualified.

HL samples have a one-hour interval. Other venues use the elapsed time from each preceding settlement, including changes in interval. Binance and Aster request one day of boundary context with both time bounds; Aster's end-time-only response can return an old listing settlement. Bybit fetches the preceding settlement separately. OKX pages backward with `after` until it includes a boundary row and uses `realizedRate`. Forward Binance/Aster and backward Bybit pages handle their respective limits. Duplicate settlements, stalled cursors, missing required boundaries, malformed rows, and HTTP errors throw. There are no retries or guessed intervals. If Binance/Aster have no predecessor in the extra day, history fails explicitly. An empty history has zero samples and null statistics.

The result includes samples, sample count, covered hours, average/min/max per-hour rates, and simple annualization. Average is `Σ ratePerInterval / Σ intervalHours`; min/max are per-hour fractions. Coverage is the sum of measured settlement intervals, not a promise of complete retention. Timestamp jitter remains in measured intervals. Venue retention and gaps can limit coverage; compare the reported hours before comparing averages.

Endpoint semantics follow the official [Binance](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History), [Aster](https://asterdex.github.io/aster-api-website/futures-v3/market-data/#get-funding-rate-history), [Bybit](https://bybit-exchange.github.io/docs/v5/market/history-fund-rate), and [OKX](https://www.okx.com/docs-v5/en/#public-data-rest-api-get-funding-rate-history) references, checked against the recorded responses.
