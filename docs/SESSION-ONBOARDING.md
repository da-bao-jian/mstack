# Session onboarding and API-key trading

Decided 2026-10-12. Supersedes the per-signature browser page as the main onboarding and trading path. PRD sections 6.3–6.7 still describe the manual signer backends, which remain available.

## 0. Decision

- **The Mobius API key is the session key.** One wallet signature creates a key scoped to venues and a USD cap per leg. It can open, cancel, close and resize positions. It cannot withdraw, bind venues, approve fees or create keys. After onboarding, trading needs no wallet.
- **Onboarding is one browser visit.** `mob onboard` opens the Mobius API page (`app.mob.exchange/?nav=api`). The user connects a wallet once, accepts the legal terms (the app's gate), binds venues in the page's own dialog, and creates the key. Then the user copies the key and pastes it into the chat; the agent stores it with `mob keys import --stdin` and the CLI never prints it again. No localhost receiver, no page change on the Mobius side. A human at a terminal may instead run `mob keys import` and paste it hidden.
- **Accepted cost (decided 2026-10-12).** A key pasted into the chat lives in the transcript and in the agent's session logs on disk. It cannot withdraw, it is scoped to venues and a USD cap, and `mob keys revoke` or the API page ends it. The skill tells the user to create a key with a modest cap for the agent.
- **Native signing stays for terminals without a browser.** `mob onboard --native` runs the same steps with a keystore or WalletConnect signer through the API's batch venue-binding routes (Mobius PR #1460, API 1.2.0): one prepare signature, one signature per venue request, one submit. The browser signer gets one page with one connection for the whole batch.
- **Approval model.** Policy `manual` (default): the agent stages a Proposal; the user names it; `mob submit p-N` sends it with the key, no wallet. Policy `auto` (opt-in, needs a key): the agent may submit inside the key's caps without naming each Proposal. Policy `locked`: no submission. The existing sign-guard hook covers `mob submit` exactly as it covers `mob sign`.

## 1. What the key can and cannot do

| Action | With the key | Without the key (today's path) |
|---|---|---|
| scan, rates, history, status | public reads, or owner-scoped reads with the key | public reads |
| open, cancel, close, resize | `mob submit` through `api.mob.exchange` | wallet signature per action on the funding server |
| protection, auto-close, neutralize, size-mismatch edits | not in the Strategy API (Mobius ask D) | wallet signature per action |
| legal acceptance, venue binding, builder/integrator approval, key create/revoke | never | wallet signature |
| withdraw | never | never |

A key is `mobius_<uuid>.<64 hex>`. The server stores only its hash. Keys have no expiry (Mobius ask C); `mob keys revoke` and the API page revoke them.

## 2. Flows

```text
BROWSER PATH (default)
mob onboard
  ├─ opens  https://app.mob.exchange/?nav=api   (once per hour; prints the URL always)
  │     page: connect wallet → legal gate → bind venues (page dialog) → create key → Copy
  ├─ prints the checklist from public reads:  legal ✓   hl ✓   lighter …   key …
  │     on a TTY it redraws every 5 s (--watch); in an agent shell it prints once and exits 0
  ├─ the user pastes the key into the chat
  │     agent:  printf '%s' 'mobius_…' | mob keys import --stdin   (human: mob keys import, hidden)
  │     verify: GET /v1/delta-neutral/tasks?limit=1 → 200 → store in keychain / secret-tool / 0600 file
  └─ mob onboard again → home screen: Ready · 2 venues · key mobius_ab12… · cap $5,000

NATIVE PATH (--native, keystore or WalletConnect; browser signer gets one page)
mob onboard --native
  ├─ legal acceptance Proposal (existing)                       1 signature
  ├─ binding ceremony c-1 through api.mob.exchange:
  │     prepare authorization (personal_sign, canonical JSON)   1 signature
  │     POST /v1/venue-bindings/prepare → signRequests
  │     sign each request exactly as returned                   1–2 per venue
  │     POST /v1/venue-bindings/{id}/submit (Idempotency-Key = c-1)
  │     GET  /v1/venue-bindings/{id} with wallet read headers until bound
  ├─ key creation Proposal on the funding server                1 signature
  │     the response key goes straight to the key store, never printed
  └─ home screen

TRADING (both paths)
mob open ETH --long hl:ETH --short lighter:ETH --size 1000
  └─ stages p-7: preflight (14 checks + key scope + cap), card, Next: mob submit p-7
mob submit p-7           # policy manual: only after the user names p-7
  └─ POST /v1/delta-neutral/tasks  Authorization: Bearer <key>  Idempotency-Key: <p-7 uuid>
       202 → submitted → mob status polls the task
```

## 3. Components

| Component | Package | Notes |
|---|---|---|
| Strategy API client | `@mstack/mobius-api` (W18) | Typed routes from the pinned OpenAPI 1.2.0; bearer; Idempotency-Key from the Proposal; 429 surfaces `Retry-After`; decimal strings stay strings; the bearer is redacted from every error. |
| Binding authorization | `@mstack/mobius-api` (W18) | Byte-exact port of `bindingMessage` and `canonical` from `funding-server/src/binding/apiService.ts` at `0e3ff530`. |
| Key routes | `@mstack/mobius-client` (W18) | `/api/keys/create|list|revoke` with the byte-exact `apiKeyMessage`. |
| Key store | `@mstack/keys` (W19) | `MOBIUS_API_KEY` env → keychain/secret-tool/file. `mob keys import|create|list|revoke|show`. |
| Onboarding | `apps/cli` (W20) | Mobius page, checklist, `--watch`, native ceremony, multi-request sign page. Key import is W19's `mob keys import --stdin`. |
| Submit | `apps/cli` (W21) | Proposal kind `api-submit`, `mob submit`, policy `auto`, status with the key, hook coverage. |
| Skills, MCP, docs, QA | W22 | `/mob-setup` → onboard; `/mob-open` → submit; journeys E and F; 0.4.0. |

## 4. Mobius dependencies and fallbacks

See `docs/MOBIUS-ASKS.md`. Every package below works against the API as it is today except the native binding path (B: API 1.2.0 is merged but not yet deployed to `api.mob.exchange`; the fake server stands in until it is). No Mobius page change is needed for the browser path.

## 5. Security notes

- After import the CLI never prints the key: not in cards, Proposal files, logs or errors. Errors redact `mobius_<uuid>.<secret>` to `mobius_<uuid>…`. The one exposure is the user's own paste in the chat, accepted above.
- The agent puts the already-pasted key once in a single-quoted shell-builtin `printf` input and pipes it to `mob keys import --stdin`. `mob` never puts the key on its own or a child's argv, but the host shell's command line (for example `/bin/zsh -c '…'`) carries it while that one command runs, visible to same-user process listings. That command remains part of the accepted agent session record. An unverified import needs an explicit user request.
- Idempotency keys are persisted in the Proposal before the first send, so a retry never duplicates a position.
- A leaked key is bounded by its venues and cap and cannot move funds. `mob keys revoke` and the API page end it.
- `auto` policy is opt-in and prints a warning line on every home screen while active.

## 6. Packages

| Package | Depends on | Parallel with |
|---|---|---|
| W18 API client, binding auth, key routes | — | W19 |
| W19 key custody | — | W18 |
| W20 onboarding ceremony | W18, W19 | W21 |
| W21 trading via submit | W18, W19 | W20 |
| W22 skills, MCP, docs, QA, 0.4.0 | W20, W21 | — |

## 7. QA

Fake Strategy API server (bearer, idempotency, 429, binding state machine, wallet-header recovery). Journey E: headless browser-path onboarding where the "user" pastes a fixture key into the chat, the agent imports it through stdin against the fake API, and the key never appears in any later output; then a submit. Journey F: native onboarding with a test keystore against the fake API. Live checks stay human: a real key from the real page, a real binding, a real $50 position.
