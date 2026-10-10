# mobstack

An open-source funding-rate scanner and Mobius agent stack. The current P0 scope is read-only: no wallet, signing, or key handling.

## 30-second install (placeholder)

Build the local CLI with Bun 1.3 or newer. The installer, skills, and plugin arrive in later work packages.

```sh
bun install
bun run build
./apps/cli/dist/mob scan --size 1000 --top 5
./apps/cli/dist/mob explain funding --simple
```

For development, install Bun 1.3 or newer, then run:

```sh
bun install
bun run check
bun run lint
bun test
bun run deadcode
```

Funding annualization is simple, not compounded: `ratePerInterval / intervalHours × 24 × 365 × 100`.

## Funding and opportunity libraries

`@mobstack/funding` provides public venue adapters and fresh snapshots. `@mobstack/opportunities` ranks positive funding spreads, estimates round-trip fees and mark-based entry cost, and reports break-even hours. Fee defaults are estimates that callers should override. Native market names remain on every leg; unmatched symbols are listed explicitly.

```ts
import { rankOpportunities } from "@mobstack/opportunities";

const result = rankOpportunities(snapshot, { sizeUsd: 1_000 });
```

See [funding](packages/funding/README.md) and [opportunities](packages/opportunities/README.md) for the APIs, assumptions, and fee defaults. `mob open` strings in ranked output are suggestions for the future execution phase; no current command executes them.

## CLI

The compiled `mob` binary supports `scan`, `rates`, `history`, `explain`, `status`, and `config`. It runs without Bun or `node_modules` installed. [CLI documentation](apps/cli/README.md) describes flags, output, exit codes, and config. The ten [knowledge topics](docs/knowledge/) are embedded at build time.

Human data output always reports snapshot age, source, simple annualization, failures, and unmatched symbols. JSON stays on stdout; its human footer goes to stderr. Fee defaults are estimates. Entry costs use marks and do not measure executable depth.

## Custody

This statement describes the full planned product. P0 contains only public reads.

- **Your wallet key never leaves your wallet.** mobstack signs through your browser wallet, WalletConnect, Ledger, or a keystore only you can unlock. Nothing in the agent, the MCP server or the skills can sign for you.
- **Your funds stay in your own venue accounts.** Mobius never holds, routes or custodies funds. The Mobius worker places and closes orders with venue keys that cannot withdraw (Hyperliquid, Aster) or can withdraw only to your own address (Lighter). You can revoke every key at the venue at any time.
- **What Mobius does hold:** the encrypted venue trading keys it minted during binding, so its worker can run liquidation protection and auto-close for you around the clock; your task history; and, if you grant one, a scoped session grant (not the key).
- **Everything the agent reads is public** by wallet address on the Mobius API. Anyone who knows your address can see your tasks.
