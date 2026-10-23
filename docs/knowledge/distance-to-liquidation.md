# Distance to liquidation

## Simple

Distance to liquidation tells you how far the mark price can move toward the venue's liquidation price. A smaller distance means less room for an adverse move. Cross margin can use account equity; isolated margin uses the margin assigned to that position. The two need different estimates. Missing liquidation data is unknown, not a safe distance.

## Precise

When the venue supplies a valid liquidation price, `distancePct = abs(mark - liquidationPrice) / mark × 100`. For a dominant cross-margin position, set `x = accountEquityUsd / positionNotionalUsd` and maintenance fraction `m`. Short distance is `max(0, ((x + 1) / (1 + m) - 1) × 100)`; long distance is `max(0, (1 - (1 - x) / (1 - m)) × 100)`. These are price distances, not the margin-ratio headroom `x - m`. The long formula can exceed 100%; it is deliberately not capped. The isolated pre-trade estimate uses move `1 / leverage - m`. Cross estimates assume this position dominates account maintenance and can overstate safety when other positions share equity. Invalid inputs return unknown. HL's estimate uses `m = 1 / (2 × maxLeverage)`; Lighter publishes its own maintenance fraction. mstack does not read private account health itself.
