# Venue capabilities and ceremonies

The default page path binds venues during `mob onboard`. This reference covers
the repair path and `mob onboard --native`.

| Venue | Key capabilities | Limits and expiry |
|---|---|---|
| HL | Trade, cancel, adjust margin | Cannot withdraw; 179 days |
| Aster | Trade perpetuals | Cannot trade spot or withdraw; 365 days |
| Either Lighter deployment | Trade, cancel, adjust leverage and isolated margin, approve integrators, withdraw to the owner's address | Third-party transfers need the owner's L1 signature; no expiry |

HL uses prepare, agent approval, then builder fee approval up to 0.1%.
Browser staging reads the wallet chain on a connection-only page. Keystore HL
uses the configured signing chain, default Arbitrum `0xa4b1`.

Aster uses prepare then typed agent approval on chain 56, including the server's
builder terms. Lighter uses prepare, exact-message key approval, and a stored
sendTx plan. Mainnet also asks for one zero-fee integrator approval.
Robinhood Lighter uses chain 466324; mainnet uses chain 304.

Explain status polling and builder finalization from the stored plan.
A bound credential confirms binding only, not position execution.
