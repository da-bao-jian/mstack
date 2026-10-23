# Liquidation protection

## Simple

Protection reduces both legs when one gets too close to liquidation. This lowers exposure while keeping the pair balanced. The default threshold is 8%, and the target distance is 12%. Protection needs fresh data and successful venue actions. It cannot guarantee an exit during a fast move or outage. Isolated positions need a margin step after a partial close.

## Precise

The shared default threshold is 8% of mark; target distance is `1.5 × threshold`. The open-time check blocks a measured distance strictly below the target, not equality. For current distance `d0`, target `dt`, maintenance fraction `m`, and `k = 1 + m` for a short or `1 - m` for a long, the trim fraction is `k × (dt - d0) / (k × dt + 100 × m)`, bounded to `[0, 1]`. The derivation assumes backing equity survives the trim. Cross margin satisfies that assumption; isolated margin needs the released margin added back. Without that second action, its equity/notional ratio stays unchanged. The solver uses `m = 0` when maintenance is unknown, which maximizes the trim over nonnegative maintenance fractions. Missing distance does not trigger a trim. There is no cumulative trim budget. Failed fills, asymmetric partial execution, margin-step failure, and fast prices remain gaps; the server's suspension and notice fields must be shown, not inferred from local counters. mstack only reads those fields.
