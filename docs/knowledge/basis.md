# Basis

## Simple

The same asset can trade at different prices on two venues. This price gap is called basis. Buying the more expensive contract and selling the cheaper one creates an entry cost. A favorable gap can help, but the gap can change before closing. A mark price does not tell you the price a large order will receive.

## Precise

The shared funding entry-cost rule uses equal base size `q`: `costUsd = (longPrice - shortPrice) × q`; `costPct = costUsd / ((longPrice + shortPrice) × q) × 100`. The cost is signed and uses combined entry notional as its denominator. mstack divides each mark by its contract multiplier before comparing prices. A measured estimate is labeled `entryCostBasis: "mark"`; a missing mark yields `null` and `"unmeasured"`. The scan estimates entry from marks; `mob cost` walks each order book for the price a market order would get. Break-even assumes convergence on exit and does not model future basis, slippage, or available depth.
