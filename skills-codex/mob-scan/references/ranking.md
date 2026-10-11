# Ranking details

Each section ranks by measured net APY for the hold period (`holdDays`, default
seven). Costs include taker and builder fees plus positive mark entry cost.
A negative mark estimate never counts as a gain. Break-even still uses signed
entry cost. Null net APY sorts last. Never re-sort by gross spread.

Read both leg volumes, flags, OI caps, and missing measurements with the result.
Marks do not measure fill depth. Fee defaults are estimates the user can override.
Annualized rates are simple, not compounded.
