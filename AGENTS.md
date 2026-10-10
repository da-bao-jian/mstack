# AGENTS.md — rules for every agent working in this repo

## Roles
- **Codex (implementer):** builds exactly the work package it is assigned in `docs/BUILD-PLAN.md`. Nothing more, nothing less.
- **Fable (coordinator, PM, QA):** assigns packages, reviews each delivery against the acceptance criteria, and sends back a fix list. Codex does not self-assign the next package.

## What this is
`docs/PRD.md` is the spec. Read §0, §3, §4, §5, §6.1, §7 and §11 before touching code. The product is an open-source funding-rate scanner and Mobius agent stack: `mob` CLI, `mob mcp`, skills, Claude Code plugin. Working names (`mobstack`, `mob`, `/mob-*`) are placeholders; keep them consistent and easy to rename.

## Hard rules
1. **Fail fast. No unrequested fallbacks.** Malformed venue data throws inside that adapter. A failed venue is reported in `failed[]`, never silently empty, never filled with a stale number. No `try { … } catch { return [] }`.
2. **No signing code, no key handling, no secrets in P0.** No `--private-key`, no passphrase, no env secret reads, no wallet libraries. P0 is read-only (PRD tier T0). Signing arrives in P1 with its own package and review.
3. **Parity is byte-exact.** Anything ported from `reference/upstream/` (message builders, funding-rate math, opportunity math) keeps a `// Ported from mobius@33ed2ece <path>` header and a test that pins the exact upstream behavior, using the upstream test file as the fixture source.
4. **Keep the canonical shapes.** `FundingRate { venue, market, ratePerInterval, intervalHours, annualizedPct }` from `reference/upstream/packages/funding-rates/src/index.ts` is the row shape. Annualization is simple (`rate1h × 24 × 365 × 100`), never compounded, and every output says so.
5. **Venue-native market strings are preserved** (Hyperliquid casing and `xyz:NVDA`, Aster `USD1:BTC`). A normalized base ticker exists only for cross-venue matching.
6. **Tests use recorded fixtures, never the network.** Record real responses once into `fixtures/<venue>/`. Live checks live behind `MOB_LIVE=1` and are not part of `bun test`.
7. **Every package has `check`, `lint`, `test`.** Root `bun run check` (tsc, strict), `bun run lint` (Biome, zero warnings), `bun test`, `bun run deadcode` (knip) must be green before you report done.
8. **No telemetry, no analytics, no network calls except to the venue and Mobius API hosts named in the PRD.**
9. **Commit per work package** with a conventional-commit message on `main`. Do not push. Do not create remotes.
10. **Do not edit `reference/` or `docs/PRD.md`.** If the PRD is wrong or ambiguous, write the question in your report; do not guess silently.

## Stack
Bun ≥ 1.3 workspace (`packages/*`, `apps/*`), TypeScript strict, ESM, Biome for lint/format, `bun test`, `bun build --compile` for the CLI binary, knip for dead code. Minimal dependencies; justify each one in the report.

## Delivery protocol
When a package is done, write `docs/reports/<package>.md` with: what was built (files), how it was verified (exact commands + output summary), live smoke output if the package has one, open questions, and anything deliberately left out. Then stop. Fable reviews and replies.
