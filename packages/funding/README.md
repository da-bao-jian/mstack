# @mobstack/funding

Read-only venue adapters and fresh funding snapshots. This package has no runtime dependencies.

```ts
import {
  aster, binance, bybit, fetchSnapshot, hyperliquid,
  lighter, lighterMainnet, okx,
} from "@mobstack/funding";

const snapshot = await fetchSnapshot(
  [hyperliquid, lighter, lighterMainnet, aster, binance, bybit, okx],
  { timeoutMs: 60_000 },
);
```

`failed` contains venue names and errors. It can contain `hl` with a named builder dex while healthy Hyperliquid rows remain. A core failure discards all Hyperliquid rows. Builder requests have their own deadlines within the snapshot timeout. There are no retries or cached rates.

Every row carries `observedAt` in Unix milliseconds, `source`, and `annualizationMethod: "simple"`. Annualization is `ratePerInterval / intervalHours × 24 × 365 × 100`. Optional fields use milliseconds for `nextFundingAt` and USD for `markPrice` and `openInterestUsd`.

Native market names remain intact: `kPEPE`, `xyz:NVDA`, `USD1:BTC`, `BTCUSDT`, and `BTC-USDT-SWAP`. Aster follows the upstream USDT/USD1 market scope. Bybit dated futures and delisted Hyperliquid markets do not emit funding rows. OKX makes two requests: SWAP instruments and bulk funding (`instId=ANY`). Only instruments marked `live` emit rows. Missing funding for a live instrument fails the adapter.

Both Lighter deployments validate every feed row, including its exchange name, and emit only their own `exchange === "lighter"` rows. Competitor mirror rows are excluded because they use Lighter's symbol namespace and lower precision. Binance, Bybit, and Hyperliquid come from their direct adapters. `source` is `"direct" | "hosted"`; `listed` contains unique native `venue:market` keys.

`src/index.ts` and its tests are byte-exact upstream copies after a provenance header. Their legacy exports still accept four venues and uppercase names. `ObservedFundingRate` extends the canonical row with an open venue identifier and metadata. Adapters preserve native names and use the upstream annualization function. Use `fetchSnapshot` for adapter rows; the legacy lookup helpers retain their upstream contract.

Run `bun test` for offline fixture tests. Both root and package test configurations disable global network access. Run `MOB_LIVE=1 bun run live:smoke` from the repository root for a live check. The smoke check prints row counts per venue and exits nonzero when any venue or builder dex fails.
