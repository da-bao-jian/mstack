# Mobius-side work that mstack depends on

Each item has a fallback in mstack, listed so nothing here blocks the client work. Specs are exact so they can be built without a second conversation.

## A. API page → CLI key handoff (frontend)

`https://app.mob.exchange/?nav=api&cli=<port>&token=<token>` where `port` is 1024–65535 and `token` is 64 lowercase hex characters. When both are present and valid:

1. Keep the current flow (connect, bind, create key). After a key is created and shown in the dialog, add a button **Send to mstack** next to **Copy**.
2. On click, `fetch("http://127.0.0.1:<port>/mstack/key", { method: "POST", mode: "cors", headers: { "Content-Type": "application/json" }, body })` with body `{"token":"<token>","key":"mobius_…","name":"…","venues":["hl","lighter"],"maxSizeUsd":5000,"owner":"0x…"}`.
3. Expect `200 {"ok":true}`; then show "Sent to mstack. You can close this tab." Any other result shows "mstack did not answer; copy the key instead." The key stays in the dialog until Done.
4. CSP: add `http://127.0.0.1:*` to `connect-src` for prod and dev (`frontend/scripts/headers.ts` static baseline or `NEXT_PUBLIC_CSP_EXTRA_CONNECT_SRC`). The CLI answers the preflight with `Access-Control-Allow-Origin: https://app.mob.exchange` (dev: `https://dev.mob.exchange`), `Access-Control-Allow-Headers: Content-Type`, `Access-Control-Allow-Methods: POST`.
5. Never put the key in a URL, a redirect, localStorage or analytics. The `cli` and `token` parameters are ignored on every other tab.

Fallback in mstack: the terminal says "press Enter and paste the key"; input is hidden; nothing changes on the page.

## B. Deploy API 1.2.0

`api.mob.exchange/openapi.json` serves 1.1.0 without `/v1/venue-bindings/*`. PR #1460 is merged to `dev`. mstack's native path targets 1.2.0; its tests run against a fake until the deploy.

## C. Key expiry and last-used

`POST /api/keys/create` accepts optional `expiresAt` (Unix seconds, ≤ 1 year) inside the signed message (`… maxSizeUsd=… expiresAt=… nonce=…`, appended only when present so old clients still verify). `api_keys` gains `expires_at`, `last_used_at`. Authentication rejects expired keys with 401 `key_expired`. The API page shows both. Default stays "no expiry" so nothing breaks.

## D. Manage routes in the Strategy API

`POST /v1/delta-neutral/tasks/{id}/protection {liqProtectionPct|null}`, `/auto-close {autoClose}`, `/neutralize`, `/size-mismatch-auto-close {enabled}` with the same key scope and idempotency rules as resize. Until then mstack signs these on the funding server with the wallet.

## E. Key introspection

`GET /v1/me` → `{"keyId","owner","name","venues","maxSizeUsd","createdAt","expiresAt"}` for the bearer. Lets the CLI show the key's limits and validate a Proposal against them before submit. Fallback: `mob keys import` asks the user for venues and cap, and the server's 403 is the final check.

## F. Canonical JSON key order

`canonical()` in `funding-server/src/binding/apiService.ts` sorts keys with `localeCompare`, which depends on the runtime locale (case and accents). Mixed-case keys would sort differently on another machine or runtime. Sorting by code unit (`a < b ? -1 : 1`) is deterministic. All current payload keys are lowercase ASCII, so this is not urgent; mstack ports the same comparator and pins a mixed-case test either way.
