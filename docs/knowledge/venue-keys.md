# Venue keys

## Simple

The scanner needs no key. In the full Mobius service, the user's wallet authorizes venue keys that the server stores in encrypted form. Those keys let the worker trade. Hyperliquid and Aster keys cannot withdraw. Lighter's key is not trade-only: it can withdraw to the owner's own address. Funds stay in the user's venue accounts.

## Precise

The current binding model has the server mint and hold encrypted venue keys; it does not hold the owner's wallet key. Hyperliquid permissions cover trading, cancellation, and margin adjustment, with a 179-day approval. Aster permits perpetual trading, not spot trading or withdrawal, with a 365-day approval. Lighter permits trading, cancellation, leverage, isolated-margin changes, integrator approvals, and withdrawal to the owner's own L1 address; third-party transfers need the owner's L1 signature. Its key has no stated expiry in the PRD. Keys can be revoked at the venue. Public reads by owner address expose task history. W3 performs only public reads and implements no key storage, binding, or authorization flow.

Sources: `docs/PRD.md` §6.7–6.8 and §7.4. These describe the current server trust model, not scanner capabilities.
