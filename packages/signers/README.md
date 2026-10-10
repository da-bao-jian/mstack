# @mstack/signers

The `Signer` interface exposes `address()`, viem-shaped `signMessage({ message })`, and `signTypedData(typedData)`. The W7 backend is a local encrypted keystore. Browser and WalletConnect backends belong to W8.

`createKeystore`, `importKeystore`, and `unlockKeystore` read secrets from `/dev/tty` without echo. They never read stdin, environment secrets, or command arguments. Tests may inject the `SecretReader` function. `listKeystores` shows addresses without unlocking keys.

Files live at `<home>/keystore/<lowercase-address>.json`, mode 0600. Each uses a random 32-byte salt and scrypt (`N=32768`, `r=8`, `p=1`) to derive an AES-256-GCM key. The nonce is 12 bytes and the authentication tag is 16 bytes. The encrypted payload retains the reference `iv`, `authTag`, and `ciphertext` base64 fields. Version and address are authenticated as additional data. Existing files cannot be overwritten; symlinks and broadly readable files are refused.

The vendored KMS source contains the encrypted-blob interface, not its scrypt implementation. This is a new local passphrase envelope, not an import format for Mobius server credentials. Keys are generated and signatures produced by viem. The backend has no transaction-signing method. Decrypted buffers are cleared after use; JavaScript strings and viem account state cannot be guaranteed to erase immediately.

Run `bun run check`, `bun run lint`, and `bun test`.
