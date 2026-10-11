# Open preview details

Include quantized base sizes and floors, assumed leverage if supplied, protection,
and auto-close. State missing estimates rather than inventing fees, liquidation
distance, or break-even values. Readiness, spread, and protection checks come
from the returned preview.

Assumed leverage is not verified on the venue. It does not set leverage or margin
mode. Protected Aster opens fail closed without maintenance-margin data.
Protection cannot guarantee against liquidation. Funding can flip, and losing
one leg leaves unhedged exposure. Auto-close reacts to funding; it is not a
guaranteed profit or loss limit.
