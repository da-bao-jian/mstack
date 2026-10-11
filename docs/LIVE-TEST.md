# Live test 1 — first real run against production

Goal: prove the P1 flow against the real Mobius API and real venues with a tiny position. Everything before this ran against fake servers. Budget: about 30 minutes, about $60 of margin on each venue account, one $50-per-leg position that you close at the end.

Target: production (`funding.mob.exchange`, `auth.mob.exchange`). Your venue accounts and any existing binding live there. The dev tier would need new bindings and separate venue approvals.

## Before you start

- A browser with MetaMask or Rabby holding the wallet you use on app.mob.exchange, with network 97 (BSC testnet) added. The legal signature is pinned to chain 97; the sign page switches to it but never adds a network.
- About $60 free margin on Hyperliquid and on Lighter (Robinhood chain, which is what Mobius calls `lighter`).
- Bun 1.3+ installed. Nothing else.
- Never type or paste a private key anywhere in this flow. The browser wallet signs; the CLI only sees signatures.

## 1. Install (2 min)

```sh
cd ~/dev/mstack && ./setup --host claude
export PATH="$HOME/.claude/skills/mstack/bin:$PATH"
mob --version            # 0.2.0
mob scan --top 3         # proves venue reads work; no wallet needed
```

## 2. Setup and legal acceptance (3 min)

```sh
mob setup
```
Answer: owner = your wallet address; signer = `browser`; policy = `manual`; keep the defaults for `auth_base` and `legal_chain_id` (97). Setup then asks the auth-server whether this wallet already accepted the current terms (2026-08-17). If you accepted in the app, it says so and stages nothing. If not, it stages `p-1`:

```sh
mob sign p-1
```
A page opens at `http://127.0.0.1:<port>/sign/p-1?t=…`. Check that the digest on the page equals the digest in your terminal, pick your wallet, sign. The CLI posts the acceptance and prints `p-1: submitted`.

Watch for: `503 legal clickwrap not configured` (report it; setup continues) or a chain-switch refusal (add network 97 to the wallet and run `mob sign p-1` again only if the Proposal has not expired; otherwise `mob setup` again).

## 3. Check your bindings (1 min)

```sh
mob status --readiness
```
This reads the public credential routes for your address. For each venue it prints bound / not bound, builder approved, and "rebind allowed". If `hl` and `lighter` are already bound from the app, skip to step 5.

## 4. Bind only what is missing (5–10 min per venue)

`mob bind` is re-entrant: each call reads the server, stages exactly the next step as one Proposal, and stops. Run it, sign, run it again, until it reports bound.

```sh
mob bind hl          # step 1: prepare (text signature)
mob sign p-2
mob bind hl          # step 2: approve-agent (typed, first a connection-only page to read your wallet chain)
mob sign p-3
mob bind hl          # step 3: approve-builder-fee, then it polls and finalizes
mob sign p-4
mob bind hl          # reports: bound
```
Hyperliquid refuses agent approval from a wallet that never deposited; the CLI checks this first.

```sh
mob bind lighter     # Robinhood-chain Lighter: prepare, then approve-key
mob sign p-5
mob bind lighter
mob sign p-6         # personal_sign of Lighter's message; the CLI posts sendTx and polls
mob bind lighter     # reports: bound
```
Before the Lighter signature the CLI states that this key can withdraw to your own address and is not trade-only. That is the venue's design, not ours.

## 5. Open a $50 position (5 min)

```sh
mob scan --market BTC --all-pairs
```
Pick the executable `hl` / `lighter` row and note which side is long (the venue with the lower funding rate). Then, with protection and auto-close off for this first run:

```sh
mob open BTC --long lighter:BTC --short hl:BTC --size 50 --protect off --auto-close off
```
(swap the two legs if the scan showed the other direction). The CLI runs the preflight: config, readiness per venue, open-interest cap, marks, lot metadata, quantized base per leg (about 0.0006 BTC), entry spread against 50 bps. It prints the exact message it will sign and stops.

```sh
mob sign p-7
```
Sign in the wallet. The CLI posts `create` and prints `Server answer: {"taskId": …}` and "submitted, not confirmed".

Watch for: a `409` with a `readiness` body (a venue is not ready; the body names the issue), or `400` with the server's own validation message. Both are the server's final gate doing its job.

## 6. Watch it go live (1–2 min)

```sh
mob status --task <taskId>
```
Run it a few times. Expected: `pending` → `ordering` → `running` within about 10 seconds (the worker loop runs every 3 seconds). Then check both venue UIs: a long on one, a short on the other, about 0.0006 BTC each.

If it stays `pending` for more than a minute, read the `error` field. The usual causes are a venue not ready or the funding pre-check. This is the one moment where your engineer's worker logs help.

## 7. Close it (2 min)

```sh
mob close <taskId>
mob sign p-8
mob status --task <taskId>     # closing → closed, close_reason manual
```
Confirm both venues are flat.

## If something goes wrong

- A Proposal you don't want: `mob reject <id>`. An expired one: stage again.
- A signature the server refused: the full response body is stored on the Proposal; `mob proposal show <id>`.
- A task stuck or a leg open on one venue only: close it in app.mob.exchange, or ask your engineer. Nothing in the CLI can move funds, so the worst case is a position you close by hand.

## What to send me

The terminal transcript (copy it, or run everything under `script -q ~/mob-live.txt`), and the JSON for the task: `mob status --task <taskId> --json`. I will file whatever diverged from the fakes as the next fix round.
