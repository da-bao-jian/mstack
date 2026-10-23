# Delta-neutral

## Simple

A long position gains when the asset rises; a short loses. Holding equal amounts on both sides reduces exposure to that price move. The funding payments can still differ. This does not remove liquidation, venue, price-gap, or execution risk. Each venue holds its own margin, so one leg can fail while the other remains open.

## Precise

For the same underlying base unit, long size `q` and short size `q` have approximately offsetting first-order price exposure. Contract multipliers must be removed before comparing units. Perpetual/perpetual carry is driven by `shortRate1h - longRate1h`; net results also include trading fees and basis. Hedged account-wide exposure does not merge separate venues' collateral or guarantee fills.
