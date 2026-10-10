# Recorded venue responses

These JSON files contain real public API responses recorded on 2026-10-10. Each endpoint was requested once during recording. `manifest.json` records the URL, method, POST body where needed, HTTP status, receipt time, and SHA-256 of the original full response. No credentials were used.

Only market arrays were trimmed. Response envelopes and retained rows keep their original fields and values. Hyperliquid universe rows and asset contexts were trimmed together. The cap arrays remain complete.

- Hyperliquid: `BTC`, `kPEPE`, delisted `CANTO`, two `xyz` markets including `xyz:NVDA`, and two `io` markets.
- Lighter: BTC and ETH from both deployments, including every exchange discriminator.
- W2.1 adds matching Lighter order-book details and OKX mark prices. Mainnet details also retain real inactive MAGS and zero-mark MKR rows. Neither had a funding row at capture time; labeled test mutations exercise their joins. Robinhood had no inactive or zero-mark listing. Binance `delivery.json` retains two real dated contracts; its adjacent metadata records the capture.
- Aster: four USDT/USD1 markets across 1h, 4h, and 8h intervals. Three out-of-scope rows (`AAPLUSD`, `ETHU`, `CDLFORM`) test the upstream scope filter.
- Binance: 1h, 4h, and 8h rows, plus symbols absent from the interval override list and a zero next-funding timestamp.
- Bybit: 1h and 8h perpetuals plus a dated future with empty funding fields.
- OKX (re-recorded for W1.1): BTC linear and inverse swaps, ETH, and the four-hour CHIP swap, with one bulk funding response. An extra FUTURES row exercises exclusion outside the live SWAP list. The live capture returned 500 instruments, all `live`; no non-live instrument could be recorded. `instruments-suspended.derived.json` is an explicitly derived fixture that changes only the recorded ETH row's state to `suspend`. It tests non-live filtering without claiming that state was observed.

`../test/expected.json` pins exact normalized rows independently of runtime parsing. Its observation timestamp is fixed by the test clock. Malformed and scheduling cases mutate copies of these recorded responses; they are not presented as live observations. Tests never refresh fixtures or use the network.
