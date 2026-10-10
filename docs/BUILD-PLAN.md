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
