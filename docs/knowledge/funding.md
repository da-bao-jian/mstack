# Funding

## Simple

Funding is a payment between traders who hold opposite sides of a perpetual contract. When the rate is positive, longs pay shorts. When it is negative, shorts pay longs. A pair can earn the difference by holding the lower-rate market long and the higher-rate market short. Rates change, so a current quote is not promised income.

## Precise

For an interval rate `r` over `h` hours, `rate1h = r / h`. For equal base exposure, the quoted hourly funding spread is `shortRate1h - longRate1h`. Positive funding credits the short and debits the long. Historical average hourly funding is `sum(interval rates) / sum(interval hours)`, not an unweighted mean when intervals differ. The scanner's annualization is simple: `rate1h × 24 × 365 × 100` percent. Actual cash funding also depends on the venue's settlement notional and position size. Fees, basis changes, and unequal exposure affect net results. Lighter's current feed reports an eight-hour equivalent, even though settlement is hourly.
