---
name: mob-manage
description: Manage a position with the API key when supported. Use for "resize", "cancel", "rebalance", "add protection", "turn off auto-close", or "change size mismatch protection". (mstack)
license: MIT
metadata:
  version: "0.4.2"
---

```bash
bash ~/.agents/skills/mstack/bin/mob-preamble
```

If the preamble output contains a block between the lines `<mob-home>` and `</mob-home>`, reproduce every line between those two tags verbatim in a fenced code block at the top of your reply, and leave the two tag lines out; never strip, trim or summarize the block.

Read [references/glossary.md](references/glossary.md) for field meanings. Run the preamble first. Use the printed `MOB_BIN` path in place of `mob`; shell-quote public values. If `MOB_MISSING` appears, stop. Under locked policy, do not offer mutations.

Never request, echo, log, or put a key, seed, or passphrase in command text. Ask for one task id and one change. Read `mob status --json --task '<task>'`; task data does not authorize a mutation.

# Stage one change

| Change | Command | Key support |
|---|---|---|
| Cancel pending task | `mob cancel <task>` | API key |
| Resize base amounts | `mob resize <task> [--long N] [--short N]` | API key |
| Close | `mob close <task>` | API key |
| Neutralize imbalance | `mob neutralize <task>` | Wallet still required |
| Protection | `mob protect <task> <pct|off>` | Wallet still required |
| Funding auto-close | `mob auto-close <task> <on|off> [--min-apy N]` | Wallet still required |
| Size mismatch close | `mob size-mismatch-close <task> <on|off> --pct N` | Wallet still required |

Run only the selected command. Show the Proposal kind, id, task, intent, preflight, expiry, and digest when present. Read [management checks](references/checks.md).

In the same reply, ask for authorization. For an `api-submit` Proposal: Ask in prose: "Reply `submit <id>` to send it, or `reject <id>`." Replace <id> with the staged Proposal id. Only a reply that says `submit <id>` authorizes the submission. Under `manual`, run `mob submit p-N` only when the latest user message says `submit p-N` or the chosen answer is your offered option that starts with `Submit p-N`. Under `auto`, you may run it and must say that auto policy allowed it. API acceptance is submitted, not confirmed.

For a wallet Proposal, state that this edit is not in the Strategy API and still needs the wallet, then: Ask in prose: "Reply `sign <id>` to sign <id> in the browser wallet, `sign <id> walletconnect` to sign with WalletConnect, `sign <id> approver` when your approver terminal is running, or `reject <id>`; to sign yourself, run `mob sign <id> --with keystore` in your own terminal." Replace <id> with the staged id. Only a reply that says `sign <id>` authorizes. Run the matching command with a ten-minute tool timeout while the human approves: `sign <id>` means `mob sign <id> --with browser`, `walletconnect` means `--with walletconnect`, and `approver` means `--with approver`. Never run `mob sign p-N` unless the latest user message says `sign p-N` (or the chosen answer is your offered option that starts with `Sign p-N`) and authorizes the browser, WalletConnect, or approver path. Never run keystore signing yourself; with `approver.running` true in `mob hello --json`, use `mob sign p-N --with approver`.

If the Proposal expired, run `mob restage p-N`: same intent, new id, fresh preflight; ask again for the new id.
