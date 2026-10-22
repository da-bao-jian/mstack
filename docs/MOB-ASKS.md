# MoB-side work that mstack depends on

Each item has a fallback in mstack, listed so nothing here blocks the client work. Specs are exact so they can be built without a second conversation.

## A. (withdrawn 2026-10-12) API page → CLI handoff

Decided against a localhost receiver. The user copies the key from the page and pastes it into the agent chat. One optional nicety on the page: under the revealed key, a line "Using mstack? Paste this key into your agent chat; it stores the key and never shows it again." No other change.

## B. (done 2026-10-19) Deploy API 1.2.0

`api.mob.exchange/openapi.json` serves 1.2.0 with `/v1/venue-bindings/prepare`, `/v1/venue-bindings/{bindingId}`, and `/v1/venue-bindings/{bindingId}/submit`, which mstack's native onboarding uses. Unit tests still use a fake server.

## C. Key expiry and last-used

`POST /api/keys/create` accepts optional `expiresAt` (Unix seconds, ≤ 1 year) inside the signed message (`… maxSizeUsd=… expiresAt=… nonce=…`, appended only when present so old clients still verify). `api_keys` gains `expires_at`, `last_used_at`. Authentication rejects expired keys with 401 `key_expired`. The API page shows both. Default stays "no expiry" so nothing breaks.

## D. Manage routes in the Strategy API

`POST /v1/delta-neutral/tasks/{id}/protection {liqProtectionPct|null}`, `/auto-close {autoClose}`, `/neutralize`, `/size-mismatch-auto-close {enabled}` with the same key scope and idempotency rules as resize. Until then mstack signs these on the funding server with the wallet.

## E. Key introspection

`GET /v1/me` → `{"keyId","owner","name","venues","maxSizeUsd","createdAt","expiresAt"}` for the bearer. Lets the CLI show the key's limits and validate a Proposal against them before submit. Fallback: `mob keys import` asks the user for venues and cap, and the server's 403 is the final check.

## F. Canonical JSON key order

`canonical()` in `funding-server/src/binding/apiService.ts` sorts keys with `localeCompare`, which depends on the runtime locale (case and accents). Mixed-case keys would sort differently on another machine or runtime. Sorting by code unit (`a < b ? -1 : 1`) is deterministic. All current payload keys are lowercase ASCII, so this is not urgent; mstack ports the same comparator and pins a mixed-case test either way.

## G. Copy prompt for mstack

On the API page, add **Copy prompt for mstack** beside the existing **Copy prompt**. Add the same prompt to a landing page at `mob.exchange/agent`.

```text
Install mstack, the open agent stack for delta-neutral funding trades, with MoB execution. I authorize exactly:
claude plugin marketplace add da-bao-jian/mstack && claude plugin install mstack@mstack
curl -fsSL https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.10/install.sh | sh
Then follow https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.10/docs/AGENT-INSTALL.md from Verify: `mob --version`, `mob doctor`,
run `mob` and reproduce its output verbatim in a fenced block as the welcome.
Finish by telling me to type /reload-plugins, then show how to use mstack: how to invoke it and the welcome's "You can" options (research needs no account; "set up mstack" only to trade).
```

The ready-to-paste landing-page title, three sentences, prompt, and custody statement are in `docs/AGENT-PROMPT.md`.
