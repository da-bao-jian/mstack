# @mstack/signers

The `Signer` interface exposes `address()`, viem-shaped `signMessage({ message })`, `signTypedData(typedData)`, and optional `chainId()`. Backends are the local encrypted keystore, the one-shot browser bridge, and WalletConnect v2.

`createKeystore`, `importKeystore`, and `unlockKeystore` read secrets from `/dev/tty` without echo. They never read stdin, environment secrets, or command arguments. Tests may inject the `SecretReader` function. `listKeystores` shows addresses without unlocking keys.

Files live at `<home>/keystore/<lowercase-address>.json`, mode 0600. Each uses a random 32-byte salt and scrypt (`N=32768`, `r=8`, `p=1`) to derive an AES-256-GCM key. The nonce is 12 bytes and the authentication tag is 16 bytes. The encrypted payload retains the reference `iv`, `authTag`, and `ciphertext` base64 fields. Version and address are authenticated as additional data. Existing files cannot be overwritten; symlinks and broadly readable files are refused.

The vendored KMS source contains the encrypted-blob interface, not its scrypt implementation. This is a new local passphrase envelope, not an import format for Mobius server credentials. Keys are generated and signatures produced by viem. The backend has no transaction-signing method. Decrypted buffers are cleared after use; JavaScript strings and viem account state cannot be guaranteed to erase immediately.

`browserSigner(view, { openUrl, onUrl, now })` uses an immutable public Proposal view. The CLI supplies the stored Proposal and opens the local page through an injectable system-browser launcher. The page reports its connected account and current chain; `address()` and `chainId()` await that handshake. Signing remains disabled until the CLI invokes the signing method after writing its permanent used marker.

The bridge binds to `127.0.0.1` on a random port. Tokens remain in memory, every API request requires the token, and every POST requires the exact local Origin. A strict nonce CSP protects the bundled HTML. Accepted signatures must recover the expected owner and arrive before expiry. Call `close()` in a `finally` block to clean up a cancelled interaction; success, rejection, and expiry also close the server. No persistent daemon or token file is created.

Run `bun run check`, `bun run lint`, and `bun test`. The root `bun run smoke:browser` runs a disposable fake wallet through the HTTP bridge and verifies the resulting stored-body submission against a fake funding-server.

`walletConnectSigner(view, { projectId, onPairing, createClient, now })` establishes one session for the immutable Proposal. `projectId` is required; obtain one from [Reown Cloud](https://cloud.reown.com). The CLI uses `pairingQr(uri)` to render the URI in the terminal. The default factory loads the pinned SignClient SDK in a short-lived worker, disables telemetry and logging, and supplies isolated in-memory storage. The worker is bundled into the CLI. Cleanup attempts disconnects, stops the heartbeat, closes the relay, and terminates the worker within one second, including SDK initialization or request stalls. Tests inject a mocked client and never contact a relay.

The session must authorize the requested signing method and chain, and every account in its Ethereum namespace must match the expected owner. The signer validates the session again before and after the one signing request, then verifies recovery. A typed-data domain pins the chain; otherwise the transport uses `eip155:1`. Pairing, approval, signing, and verification share the Proposal's expiry. Call `close()` in `finally` to release the session, pairing, relay connection, and heartbeat on every exit path.
