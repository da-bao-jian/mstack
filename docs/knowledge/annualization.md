# Annualization

## Simple

Annualization shows what a rate would mean over a year if it stayed unchanged. The scanner uses simple multiplication, without reinvesting payments. For example, 0.01% per hour becomes 87.6% per year. This is a comparison number, not a forecast. Funding can change or turn negative before the next payment.

## Precise

`annualizedPct = ratePerInterval / intervalHours × 24 × 365 × 100`. A spread uses the difference between the two hourly rates in the same formula. All outputs identify `annualizationMethod: "simple"`; they do not calculate `(1 + rate)^periods - 1`. Historical averages use total funding divided by measured hours before annualization. The CLI's `--min-apy` flag names a filter on this simple annualized percentage; it does not switch to compounded APY. Quoted spread excludes fee and entry costs, which are reported separately.
