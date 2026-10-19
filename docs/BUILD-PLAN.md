# Build plan — P0 "Scan" (PRD §12)

Goal: a new user installs mstack and gets a ranked, fee-adjusted funding answer across venues in under a minute with no wallet. Read-only. No signing.

Each package below is assigned by Fable one at a time. Acceptance is checked by Fable before the next package starts.

## W0 — Scaffold
Build: Bun workspace (`packages/*`, `apps/*`), root scripts `check` / `lint` / `test` / `build` / `deadcode`, Biome config, strict `tsconfig.base.json`, knip config, `LICENSE` (MIT), `README.md` containing the custody statement from PRD §6.8 verbatim plus the 30-second install placeholder, `.github/workflows/ci.yml` (bun install → check → lint → test → deadcode), `docs/` kept.
Accept: `bun install && bun run check && bun run lint && bun test && bun run deadcode` all green on the empty workspace; CI file validates; one commit `chore: scaffold workspace`.

## W1 — `packages/funding` (`@mstack/funding`)
Build:
- Port `reference/upstream/packages/funding-rates/src/index.ts` and its test verbatim (header comment, same exports).
- `VenueAdapter { venue: string; tier: "A" | "B" | "C"; fetchRates(ctx): Promise<FundingRate[]> }` plus per-row extras (`observedAt`, `nextFundingAt?`, `markPrice?`, `openInterestUsd?`, `oiCapped?`).
- Adapters: `hyperliquid` (core + `xyz` + `io` dexes via `metaAndAssetCtxs`, `perpsAtOpenInterestCap` → `oiCapped`; a builder-dex failure is isolated to that dex and reported, core failure fails the adapter — mirror `reference/upstream/funding-server/src/arbitrage/fundingRates.ts`), `lighter` (both deployments; the `/funding-rates` response also carries `binance`/`bybit`/`hyperliquid` rows — emit those as their own venue rows tagged `source: "lighter-mirror"`), `aster` (`premiumIndex` + `fundingInfo`), `binance` (`/fapi/v1/premiumIndex` + `/fapi/v1/fundingInfo` for per-symbol intervals), `bybit` (`/v5/market/tickers?category=linear`, `fundingIntervalHour`), `okx` (`/api/v5/public/instruments?instType=SWAP` then `/api/v5/public/funding-rate` per instrument, bounded concurrency).
- `fetchSnapshot(adapters, { timeoutMs })` → `{ observedAt, rates, listed, failed: [{ venue, error }] }`. One adapter failing never fails the snapshot; a malformed row fails its adapter.
- Fixtures recorded from real responses into `packages/funding/fixtures/<venue>/`. Tests: fixture → expected rows (exact numbers), malformed → throws, snapshot isolates a failing adapter.
- `bun run live:smoke` (guarded by `MOB_LIVE=1`) prints row counts per venue.
Accept: all root scripts green; ≥ 6 adapters with fixture tests; smoke output pasted in `docs/reports/W1.md`; commit `feat(funding): venue adapters and snapshot`.

## W2 — `packages/opportunities` (`@mstack/opportunities`)
Build: port the pure math from `reference/upstream/tg-monitor/src/monitoring/scanner.ts` (`normalizeFundingRatePerHour`, `fundingEntryPriceSpreadCost`, `hyperliquidPerpTakerFeeScale`, `hyperliquidEffectiveTakerFeeBps`, `builderFeeMultiplierForPair`, break-even logic) as pure functions with upstream tests as fixtures. Cross-venue matching by normalized base ticker. `rankOpportunities(snapshot, { sizeUsd, fees, builderFeeTenthsBps, breakEvenHours, executableVenues })` → rows with spread/yr, round-trip fees (builder ×2 on the HL leg when paired with Lighter), break-even hours, `executable`, and the exact `mob open …` string for Tier A pairs. P0 has no order books: entry price-spread cost uses marks and is flagged `entryCost: "unmeasured"`; keep the book-VWAP interface for later.
Accept: hand-computed test values; root scripts green; commit `feat(opportunities): fee-adjusted ranking`.

## W3 — `apps/cli` (`mob`)
Build: `mob scan [--size N] [--market X] [--venues a,b] [--top N] [--json]` (direct venue fetch; `--hosted` reserved for the snapshot route from PRD §10 #6), `mob history <market> [--days N] [--json]` for venues with keyless history (hl `fundingHistory`, binance `/fapi/v1/fundingRate`, bybit, okx, aster), `mob explain <topic> [--simple]` reading `docs/knowledge/*.md`, `mob status --owner 0x… [--task id] [--json]` reading `GET /api/arbitrage/list` / `task` / `liq-trims` / `resizes` from `https://funding.mob.exchange` (`--api-base` override; render the `publicTask` fields per `reference/upstream/funding-server/src/server/routes/arbitrage.ts`), `mob config get|set`. Table output for humans, `--json` for agents, every output carries `source`, `observedAt`, `annualizationMethod: "simple"`. Build to a single binary with `bun build --compile`. No signing commands exist in P0, not even stubs.
Accept: `mob scan --json` returns ranked rows with ≥ 6 venues; `mob status --owner <any address>` renders a real task list; binary runs from a clean shell; root scripts green; commit `feat(cli): scan, history, explain, status`.

## W4 — Skills, plugin, setup
Build: `skills/mob`, `skills/mob-scan`, `skills/mob-explain`, `skills/mob-status` as `SKILL.md` generated from `hosts/<host>/` templates for `claude` and `codex` (PRD §7, §7.5 preamble: version, config, API reachability); `.claude-plugin/plugin.json` (name, version, `userConfig` for api_base) and `.claude-plugin/marketplace.json`; `bin/mob` wrapper; `./setup --host claude|codex` mirroring gstack's host table; `docs/knowledge/` written from PRD §7.4 and the liquidation references. Mutation skills (`/mob-open` etc.) do NOT exist in P0.
Accept: `claude plugin validate .` passes; `./setup --host codex` installs under `~/.codex/skills/`; skills' bash preambles run clean; commit `feat(skills): P0 skills and plugin`.

## W5 — `apps/mcp` (`mob mcp`)
Build: stdio MCP server with tools `funding_scan`, `funding_history`, `explain`, `task_list`, `task_get` over the same library; tool descriptions state that no tool signs anything. Register in the plugin's `.mcp.json`.
Accept: MCP inspector lists five tools and `funding_scan` returns rows; root scripts green; commit `feat(mcp): read-only server`.

## W6 — Project rename to `mstack`
Build: rename the root project, workspace scope to `@mstack/*`, plugin/marketplace and MCP names, client headers, setup paths, generated skills, and current documentation. Document `https://github.com/da-bao-jian/mstack.git` and the GitHub plugin install path. Keep the `mob` binary, `/mob*` skills, `~/.mob`, `MOB_HOME`, `MOB_LIVE`, config keys, and `mob:` errors unchanged. Preserve the PRD, reports W0–W5, and prompts as the historical record.
Accept: regenerate the lockfile and skills; all root gates, build, plugin validation, and temporary-home Codex setup/preamble/uninstall pass. Audit old-name references and report them in `docs/reports/W6.md`. One commit on `main`: `chore: rename project to mstack`. Fable pushes after review.

## QA protocol (Fable)
After each report: run the root scripts, read the diff against the acceptance list and `AGENTS.md`, run the live smoke once, and reply with APPROVED or a numbered fix list. Codex resumes the same session for fixes.

---

# Build plan — P1 "Open" (PRD §12), client-side only

Decision 2026-10-10: the MoB funding-server cannot change for now. P1 is built entirely in this repo against the routes that exist today (PRD §5). Substitutes for the PRD §10 server items:

| PRD §10 item | Substitute in mstack |
|---|---|
| #1 preview route | Client-side preflight: venue readiness from `GET /api/binding/<venue>/credential` and `rebind-check`, HL open-interest caps, floors and quantization from venue metadata (mirroring the frontend's `resizePlan.ts`), the protection gate from the ported liquidation math, entry spread vs `maxSpreadBps` from live marks. The server's own `create` validation remains the final gate and its `readiness` error body is rendered verbatim. |
| #2 server-applied leverage | Hyperliquid only: the owner's wallet signs `updateLeverage` directly (a `venue-submit` Proposal) before the open. Lighter and Aster leverage/margin mode cannot be set without a venue key, so the CLI reads what is keyless, warns, and **never includes `longLeverage` / `shortLeverage` / `*MarginMode` segments in the signed message unless it verified them on the venue**. The server would otherwise store metadata the worker could plan trims against. |
| #3 client logging | The `X-Mobius-Client: mstack/<version>` header is already sent. Nothing else. |
| #4 rate limits | The client self-limits to at most 2 requests/s per host to MoB. |
| #5 legal acceptance | Existing auth-server routes: `GET /legal/terms`, `GET /legal/acceptance?wallet=`, `POST /legal/acceptance` with the EIP-712 `AcceptLegalTerms` from `reference/upstream/frontend/src/lib/legal.ts`, domain `{ name: "Mobius Legal", version: "1", chainId: <legal_chain_id config, default 97> }`. |
| #12 Lighter tier check | The tier is not readable keylessly. The integrator approval is attempted once through the existing route; a refusal is reported as the venue's answer and never retried. |

Signing rules (PRD §6.1) apply unchanged: the agent never signs; `mob sign <id>` is the only entrypoint; stage → preflight → stop → the user names the id.

## W7 — Proposals, policy, signer core, MoB write client
- `packages/mobius-client` (`@mstack/mobius-client`): a typed client for every funding-server route in PRD §5.2 (reads move here from `apps/cli/src/status.ts`; the CLI keeps rendering). Message builders ported byte-exact from `reference/upstream/frontend/src/features/delta-neutral/lib/{openTaskMessage,resizeTaskMessage,liqProtectionMessage,sizeMismatchAutoCloseMessage}.ts` with their upstream tests, plus the inlined close / neutralize / auto-close messages from `ManageView.tsx` (lines ~883, ~1003, ~1025). Request bodies mirror `reference/upstream/frontend/src/features/binding/api.ts` (lines 489–735) and `OpenForm.tsx` (lines 1287–1373): `nonce = crypto.randomUUID()`, `timestamp` in unix seconds, `longPrice`/`shortPrice` = the venue marks at staging, `minFundingApy` always present in the message (default 0), optional segments only when set, numbers formatted with JS `String(n)`. Readiness errors parsed like `isVenueReadinessError`. Rate limiting as above.
- `packages/proposals` (`@mstack/proposals`): the Proposal model of PRD §6.2. Store `~/.mob/proposals/<id>.json` (0600), ids `p-<n>` from a counter file, kinds `sign-text | sign-typed | venue-submit`, statuses `staged → previewed → awaiting-signature → signed → submitted → confirmed | rejected | failed | expired`, `expiresAt = createdAt + 300 s`, `digest` = keccak256 of the exact message bytes (text) or the EIP-712 hash (typed). A Proposal carries its `submit` plan (route + body builder from the signature) and its `preflight` result. One signature per Proposal, ever.
- `packages/signers` (`@mstack/signers`): `Signer { address(): Promise<Address>; signMessage(args): Promise<Hex>; signTypedData(args): Promise<Hex> }`, viem-shaped so Hyperliquid's SDK can wrap it later. Backend `keystore`: `~/.mob/keystore/<address>.json`, scrypt + AES-256-GCM in the shape of `reference/upstream/packages/kms/src/kek.ts`, passphrase read from `/dev/tty` only (never stdin, argv or env), so an agent without a TTY cannot unlock it. `mob keystore create | import | list` (import reads the key from the TTY). Browser and WalletConnect arrive in W8 behind the same interface.
- Policy in config: `signer` (`keystore | browser | walletconnect`), `policy` (`locked | manual`, default `manual`), `owner` must equal the signer's address at sign time.
- CLI: `mob proposals`, `mob proposal show <id>`, `mob preview <id>` (re-runs the stored preflight), `mob sign <id> [--with …]` (refuses `locked`, expired, owner mismatch; prints purpose, route, message, digest; signs; submits; records the server answer), `mob reject <id>`. No `--yes`. No mutation commands yet (W10).
- Tests: a fake funding-server (`Bun.serve`) that recovers the signer and checks the exact body; a throwaway keystore key under a temp `MOB_HOME`; byte-exact message tests; expiry; one-signature-only; policy refusals. The TTY passphrase read is injected in tests.

## W8 — Browser bridge and WalletConnect signers
- `browser`: localhost daemon (random port, token file 0600, one-time token per Proposal), a single-file page bundled into the binary (EIP-6963 wallet discovery, `personal_sign`, `eth_signTypedData_v4`, `wallet_switchEthereumChain` when the Proposal pins a chain), the page shows purpose, exact message, digest and the expected owner; the daemon rejects a signature whose recovered address ≠ owner. `mob sign` with `browser` works from an agent's shell because the human clicks in the wallet.
- `walletconnect`: pairing URI as a terminal QR; same checks.
- Tests: a scripted fake wallet (viem account) drives the daemon's HTTP API; expiry; wrong-signer rejection.

## W9 — `mob setup` and `mob bind`
- `mob setup`: owner, signer backend, policy, `legal_chain_id`, `auth_base` (default `https://auth.mob.exchange`), legal acceptance (skip when `GET /legal/acceptance` says accepted; `LegalStaleVersionError` handling), telemetry stays off.
- `mob bind hl | aster | lighter | lighter-mainnet`: the ceremonies of PRD §6.7 on the existing routes, re-entrant (reads `credential`/`status` and stages only the next needed step, one Proposal per signature). Hyperliquid through `@nktkas/hyperliquid` over the Signer (`approveAgent` name `mobius-bot valid_until <ms>`, `approveBuilderFee` with the server's builder and `0.1%`); pre-check that the wallet has deposited (keyless `clearinghouseState`). Aster: port `reference/upstream/packages/aster-client/src/signing.ts` (dynamic EIP-712 types on chain 56) and POST `/fapi/v3/approveAgent`. Lighter: send `chainId` explicitly (304 mainnet, 466324 Robinhood), `personal_sign` the server's `messageToSign`, POST `sendTx` type 8 with `L1Sig`, poll; mainnet integrator approval attempted once. The Lighter key's withdraw-to-owner capability is stated before the signature.

## W10 — Open and manage
- `mob open <BASE> --long v:market --short v:market --size usd [--leverage L[,S]] [--margin cross|isolated] [--protect pct|off] [--auto-close on|off --min-apy N] [--max-spread-bps N (default 50)] [--size-mismatch pct]`: preflight as in the table above, HL `updateLeverage` as an owner-signed step when `--leverage` names the HL leg, warnings for the other venues, then one `sign-text` Proposal with the full message and the preflight summary. `mob close | resize | neutralize | protect | auto-close | size-mismatch-close <task>` each stage one Proposal. `mob status --readiness` shows per-venue binding readiness. Port the liquidation math into `@mstack/liquidation` from `reference/upstream/packages/liquidation/src/`.

## W11 — Skills, MCP, docs
- Skills `/mob-setup`, `/mob-bind`, `/mob-open`, `/mob-manage`, `/mob-close` per PRD §7.2–7.3; the router's P1 refusal sentence is replaced by the stop-and-ask rules. MCP tools `propose_open`, `propose_resize`, `propose_neutralize`, `propose_protect`, `propose_auto_close`, `propose_close`, `propose_bind_step` return a Proposal id and the `mob sign <id>` instruction; there is no signing tool. Static skill test: no skill runs `mob sign` without the user's latest message naming the id. A plugin `PreToolUse` hook that refuses a `mob sign` whose id is absent from the last user turn. README custody statement unchanged; version 0.2.0.

---

# Production-readiness program (after P1)

Decided 2026-10-11. Goal: ship something that feels like a finished product from an experienced agentic engineer: a sleek, consistent terminal experience, and a repository that follows the current Claude Code and Codex conventions for skills, plugins, MCP and `AGENTS.md`/`CLAUDE.md`. Each package is one Codex run under two hours, reviewed by Fable before the next.

| Package | Scope |
|---|---|
| **W12 brand + home screen** | The MoB logo rendered in the terminal from `assets/logo.json`; `mob` with no arguments becomes a neofetch-style home screen; `./setup` ends with it; the `/mob` skill shows it once per hour; `mob doctor`. |
| **W13 agent conventions + repo hygiene** | Plugin root moves to `plugin/` so the repo root can carry `CLAUDE.md` without a validator warning; `CLAUDE.md` → `@AGENTS.md`; `AGENTS.md` rewritten for contributors; skills slimmed to progressive-disclosure form with a one-line preamble call; full `plugin.json` metadata for the Anthropic directory; SECURITY, CONTRIBUTING, CHANGELOG, THIRD_PARTY_NOTICES, ARCHITECTURE, issue templates, Renovate; everything checked against the official Claude Code and Codex docs. |
| **W14 output polish** | Preview cards instead of JSON dumps, checklists for preflight, grouped `mob status`, number formatting, brand colors on TTY only, error hints, first-run guidance. |
| **W15 sign page + ceremonies** | The browser sign page in brand style with the logo, a plain "this authorizes" sentence, countdown, phone width; step indicators for setup and bind. |
| **W16 release engineering** | GitHub Actions release matrix (macOS arm64/x64, Linux x64/arm64) with SHA-256 sums, `bin/mob` download fallback for users without Bun, CHANGELOG, tag 0.3.0, README refresh. |
| **W17 final sweep** | Security review of the signing surfaces, argument-parsing fuzz tests, dependency audit, a production-readiness report listing what only a human can do (live run, public repo, license decision). |

---

# Session program (after 0.3.0)

Decided 2026-10-12, design in `docs/SESSION-ONBOARDING.md`, MoB-side asks in `docs/MOB-ASKS.md`. Goal: onboarding in one browser visit on the MoB API page, the API key as the session key, trading without a wallet popup, native signing kept for terminals without a browser.

| Package | Scope | Depends on |
|---|---|---|
| **W18 Strategy API client** | `@mstack/mobius-api`: typed client from the pinned OpenAPI 1.2.0 (tasks, requests, venue bindings), bearer + Idempotency-Key + 429, byte-exact `bindingMessage`/`canonical` port, funding-server key routes with the byte-exact `apiKeyMessage`, a fake Strategy API server for tests. | — |
| **W19 key custody** | `@mstack/keys`: env → keychain → secret-tool → 0600 file; `mob keys import|create|list|revoke|show`; the key never printed, never in a Proposal file, redacted from errors; home screen and doctor lines. | — |
| **W20 onboarding ceremony** | `mob onboard`: one-shot receiver + MoB API page + polling checklist + hidden paste fallback; `--native`: legal, batch venue binding through the API, key creation Proposal; the browser sign page serves a multi-request session (one tab, one connection). | W18, W19 |
| **W21 trading via submit** | Proposal kind `api-submit`, `mob submit`, policy `auto`, `mob status` with the key, sign-guard covers submit, manage edits stay wallet-signed with a clear message. | W18, W19 |
| **W22 skills, MCP, docs, QA, 0.4.0** | `/mob-setup` → onboard, `/mob-open` → submit, `/mob-keys`, MCP `propose_*` unchanged, README/READINESS/ARCHITECTURE, journeys E and F, CHANGELOG 0.4.0. | W20, W21 |
| **W23 distribution by pasted prompt** | Agent-only install instructions, a release-pinned paste prompt, install-doc validation, a sandboxed paste-prompt smoke, and release placeholder wiring. | W22 |

P2: Build a skills-only plugin over a hosted MCP for claude.ai and Cowork, which refuse plugins with `bin/`, then submit it to the Anthropic plugin directory.
