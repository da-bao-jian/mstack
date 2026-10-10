# @mstack/liquidation

Verbatim pure liquidation-distance and trim math from `mobius@33ed2ece`, with source headers and SHA-256 parity tests. No dependencies or network calls.

Exports include `distanceToLiqPct`, `crossDistanceToLiqPct`, `estimateLiquidationPrice`, `protectionOpenBlock`, and `trimFractionToTarget`. Percent distances are measured from the mark. `protectionOpenBlock` uses a strict boundary at 1.5 times the threshold. Missing inputs must be handled by the caller; the upstream protection function ignores unknown distances.

`bun run check`, `bun run lint`, and `bun test` verify the package. Tests retain the applicable upstream frontend distance cases and the upstream trim suite, plus hand-computed examples.
