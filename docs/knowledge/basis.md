# Basis

## Simple

The same asset can trade at different prices on two venues. This price gap is called basis. Buying the more expensive contract and selling the cheaper one creates an entry cost. A favorable gap can help, but the gap can change before closing. A mark price does not tell you the price a large order will receive.

## Precise

The shared funding entry-cost rule uses equal base size `q`: `costUsd = (longPrice - shortPrice) × q`; `costPct = costUsd / ((longPrice + shortPrice) × q) × 100`. The cost is signed and uses combined entry notional as its denominator. W3 divides each mark by its contract multiplier before comparing prices. A measured estimate is labeled `entryCostBasis: "mark"`; a missing mark yields `null` and `"unmeasured"`. There are no order-book VWAPs in P0. Break-even assumes convergence on exit and does not model future basis, slippage, or available depth.

Sources: `docs/PRD.md` §4.3 and §7.4; `reference/upstream/tg-monitor/README.md`; `packages/opportunities/README.md`.
