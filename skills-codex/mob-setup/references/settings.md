# Public settings and legal acceptance

The auth API base defaults to `https://auth.mob.exchange`. The legal signing
chain defaults to 56 (BNB Smart Chain, which MoB production uses for legal terms). Existing optional settings remain the defaults on later
setup runs. These settings are public, not secrets.

The legal chain identifies the typed signature domain. Acceptance records consent
to the terms and privacy documents. It does not authorize trading or move funds.
Review the versions, URLs, acceptance statement, expected owner, chain, expiry,
and digest from the staged Proposal.

WalletConnect needs a supplied or saved public Reown project ID. There is no
default ID. Setup does not create or unlock a keystore. Any keystore creation
step belongs in the human's terminal.
