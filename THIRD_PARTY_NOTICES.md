# Third-party notices

mstack's own code is licensed under [MIT](LICENSE). Dependencies retain their own
licenses. This inventory records the named direct runtime dependencies; it is not
an exhaustive transitive dependency bill of materials.

| Component | Pinned version | License and notice |
|---|---|---|
| [viem](https://github.com/wevm/viem) | 2.57.4 | MIT; Copyright (c) 2023-present weth, LLC. [License copy](docs/licenses/viem-MIT.txt) |
| [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) | 1.32.1 | MIT; Copyright (c) 2024 Anthropic, PBC. [License copy](docs/licenses/mcp-sdk-MIT.txt) |
| [qrcode-terminal](https://github.com/gtanner/qrcode-terminal) | 0.12.0 | Apache-2.0, with a vendored MIT QRCode implementation by Kazuhiko Arase. [License and embedded notice](docs/licenses/qrcode-terminal.txt) |
| @walletconnect/sign-client, core, types, utils | 2.25.0 | [WalletConnect Community License](docs/licenses/walletconnect-2.25.0.md) |

Portions © 2025 Reown, Inc. All Rights Reserved

The license copies for viem, the MCP SDK, and qrcode-terminal come from the pinned
installed packages. The WalletConnect license copy and dependency review were
recorded in [W8b](docs/reports/W8.md#w8b--walletconnect). The Community License
is not MIT; the repository's MIT license does not replace it.

Byte-exact Mobius ports retain source paths and commit provenance in their headers.
Review dependency licenses and notices again when changing a pinned version or
preparing binary distribution. No dependency version changes are part of W13.

W14 and W16 add no packages. Compiled release binaries bundle the existing runtime
dependencies and retain their license obligations. Release assets include `VERSION`
and `SHA256SUMS`; the installer and downloaded upgrades verify the selected binary's
SHA-256 before installation. Checksums do not change the licenses listed above.

The W16 shim selects an explicit executable override, a checkout binary, then a
cache matching the plugin version. If none exists, it builds with Bun when source
is available, or downloads and verifies that pinned release. A failed build stops.
See [the full decision tree](docs/ARCHITECTURE.md#one-binary).
