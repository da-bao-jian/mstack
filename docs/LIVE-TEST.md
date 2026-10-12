# Live test, 0.4.0

One sitting, about an hour, with a wallet that holds a little collateral on two venues and $50 per leg to risk. Nothing here is automated: this is the first time a real key and real money touch the agent path. Do it in a terminal next to your agent chat.

## Before you start

- Install the plugin from the checkout: `claude plugin marketplace add ~/dev/mstack` then `claude plugin install mstack@mstack`, or use the checkout's `bin/mob` directly.
- Fund the two venues you will use. Hyperliquid refuses agent approval from a wallet that never deposited.
- Keep `docs/READINESS.md` open; its checklist is the same list in short form.

## 1. Onboard on the Mobius API page (about 10 minutes)

In the chat, say: **set me up, my wallet is 0x…**. The agent runs `mob onboard`, prints the page link and a checklist like this:

```text
Open https://app.mob.exchange/?nav=api
Legal  ✗ missing
hl      – not bound
lighter – not bound
Key    – none
Next: bind hl on the page
```

On the page: connect the wallet, accept the terms, bind the two venues in the page's dialog, then **Create API key**. Give it the two venues and a cap of **$100**. Copy the key.

Paste the key into the chat: **here is my API key: mobius_…**. The agent stores it with `mob keys import --stdin` and answers with the prefix only. Then say **am I ready?** and expect:

```text
Legal  ✓ accepted
hl      ✓ bound
lighter ✓ bound
Key    ✓ verified ok · mobius_ab12…
Ready · 2 venues bound · key mobius_ab12… · cap $100
```

If `Key` says `rejected`, the key was created for other venues or was revoked; create another one.

## 2. Open $50 per leg (about 10 minutes)

Say: **find me the best pair on hl and lighter**, then **open $50 of <pair>, protection off, auto-close off**. The agent stages a Proposal and stops with the card and the line `Next: mob submit p-N`. Read the card: both legs, size, the eleven checks. Then say: **submit p-N**.

Expect `p-N: accepted, not executed; mob status shows the worker state (task …, status pending)`. Say **show my positions** until the task reads `running` with two legs. That takes the worker a minute or two.

## 3. Close (about 5 minutes)

Say: **close <task id>**. The agent stages the close and stops. Say **submit p-M**. Watch `mob status` until the task reads `closed`, then check both venues directly: no open position on either.

## 4. Clean up

Revoke the key on the API page or with `mob keys revoke <uuid>` (that one needs the wallet). Run `mob keys delete` to drop the local copy. Record what you saw in `docs/reports/E2E.md` under "Layer 5".

## If something stops

- `mob submit` answers `key rejected` → the key is gone; create a new one and import it.
- `mob submit` answers a 403 → the Proposal is outside the key's venues or cap; stage a smaller one.
- `mob status` stays `pending` for more than five minutes → the worker could not open; the task's error shows in `mob status --json`. Nothing was traded.
- A task ends `failed` with one leg open → close that leg on the venue by hand, then `mob status` again.

## The wallet path, still available

Users without a key sign each action in the browser or with a keystore: `mob setup`, `mob bind <venue>`, `mob open …`, `mob sign p-N`. The 0.3.0 runbook steps apply unchanged for that path.
