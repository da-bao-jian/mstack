# @mstack/proposals

`ProposalStore(home)` stores numbered Proposals under `<home>/proposals/`. Use `stage`, `get`, `list`, `preview`, `sign`, and `reject`. Staging is a library operation in W7; there is no generic CLI staging command.

A Proposal stores its owner, purpose, signing payload, submission endpoint, full unsigned request body, signature field, and preflight plan. All values must survive JSON without changes. Use decimal strings for large EIP-712 integers. Kinds are `sign-text`, `sign-typed`, and `venue-submit`; W7's CLI submission adapter covers Mobius routes. Venue adapters arrive with later packages.

Text digests are keccak256 of UTF-8 message bytes. Typed digests use the EIP-712 hash. `createdAt` and `expiresAt` are milliseconds; expiry is exactly 300 seconds after the staged request timestamp. A separate immutable-intent hash detects changes to the message, body, endpoint, preflight plan, or expiry. Files use mode 0600. Writes use atomic rename and fsync.

`preview` runs the stored read-and-assert plan. It persists `previewed`, then `awaiting-signature`, and stops. Failed checks become `rejected`. W10 plans also contain named immutable evidence from staging: config, metadata, quantities, mark spread, and liquidation checks. CLI preview rechecks current config and the credential/task assertions, including minimum remaining approval lifetime. It retains staged math and never refreshes prices, quantities, or the signed body. The intent hash covers the entire plan.

`sign` requires manual policy, an approved preflight, an unexpired Proposal, and matching configured, staged, and signer addresses. It displays the persisted intent before connecting the signer. A permanent `.signature-used` file is synced before calling the signer. Concurrent calls, crashes, signing failures, restored JSON files, and submission failures cannot reuse that attempt. The body is copied from disk and receives only the signature. A failed or expired attempt requires a new Proposal.

Successful HTTP submission remains `submitted`. It does not mean a position is open. `confirmed` is a model state reserved for later verified execution evidence. There is no resend or automatic recovery command. An interrupted directory lock requires inspection; do not remove signature markers.

The intent hash detects file drift; it is not protection against an attacker who controls the user's account and can rewrite all local files.

Run `bun run check`, `bun run lint`, and `bun test`.
