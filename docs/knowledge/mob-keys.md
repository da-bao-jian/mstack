# MoB keys

## Simple

Research needs no key. To trade through MoB, a one-time setup with your wallet creates a MoB API key. The key works only on the venues you choose and up to the USD cap per leg that you set. It can open, cancel, close and resize positions. It cannot withdraw, move funds or create other keys.

Setup also gives MoB a trading key for each venue you bind, so its worker can place and close orders in your own venue account. Hyperliquid and Aster keys cannot withdraw. Lighter's key can withdraw, but only to your own address. Your funds stay in your venue accounts, and you can revoke any key at any time.

## Precise

The MoB API key has the form `mobius_<uuid>.<64 hex>`. One wallet signature creates it with named venues and a USD cap per leg. It can open, cancel, close and resize positions inside those limits. It cannot withdraw, bind venues, approve fees, accept legal terms or create keys. It has no expiry. The MoB server stores only its hash. mstack keeps the key in Keychain, Secret Service or a private `0600` file and never prints it. `mob keys show` reports its prefix, venues, cap and verification. `mob keys revoke <uuid>` (a wallet Proposal) or the MoB API page ends the key; `mob keys delete` removes only the local copy.

Under the default `manual` policy, every trade is a staged Proposal that runs only after you say `submit p-N` with its exact id. The opt-in `auto` policy lets the agent submit inside the key's venues and cap, and the agent must say when it did.

Venue keys are minted during binding and held encrypted by the MoB server; it never holds your wallet key. Hyperliquid keys can trade, cancel and adjust margin, cannot withdraw, and expire after 179 days. Aster keys can trade perpetuals, cannot trade spot or withdraw, and expire after 365 days. Lighter keys can trade, cancel, set leverage and isolated margin, approve integrators, and withdraw to your own L1 address; transfers to anyone else need your L1 signature, and the key has no stated expiry. Revoke venue keys at the venue. The MoB worker never deposits, withdraws or transfers funds.
