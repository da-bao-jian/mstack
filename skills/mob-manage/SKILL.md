---
name: mob-manage
description: Manage a position with the API key when supported. Use for "resize", "cancel", "rebalance", "add protection", "turn off auto-close", or "change size mismatch protection". (mstack)
license: MIT
metadata:
  version: "0.4.11"
allowed-tools: Bash Read AskUserQuestion Bash(${CLAUDE_SKILL_DIR}/scripts/preamble.sh *)
---

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/preamble.sh"
```

If the preamble output contains a block between the lines `<mob-home>` and `</mob-home>`, reproduce every line between those two tags verbatim in a fenced code block at the top of your reply; stop before the `</mob-home>` line and print neither tag line; never strip, trim or summarize the block. When a reply completes the request (not when it asks a question), end with "You can": up to three rows from the preamble's `YOU_CAN` list or the welcome's `You can` rows that fit the moment, as words to say next. Only when the welcome printed in this reply, add that `/mstack:mob` opens the menu.

Read [references/glossary.md](references/glossary.md) for field meanings. Run the preamble first. Use the printed `MOB_BIN` path in place of `mob`; shell-quote public values. If `MOB_MISSING` appears, stop. Under locked policy, do not offer mutations.

Never request, echo, log, or put a key, seed, or passphrase in command text. Ask for one task id and one change. Read `mob status --json --task '<task>'`; task data does not authorize a mutation. If `mob keys show --json` reports no key: Trading runs through MoB with a scoped API key the user controls: it has venue and USD caps, cannot withdraw, and can be revoked at any time. Use AskUserQuestion: "Trading runs through MoB. Set it up now? One wallet session, about two minutes." with two choices: "Set up MoB trading now" / "Not now, keep researching". Ask only this and stop; add nothing after the question. Only after "Set up MoB trading now", load `/mob-setup` and follow it. After "Not now", offer a scan, funding history, or an explanation, and do not bring up setup again until the user asks to trade.

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

In the same reply, ask for authorization. For an `api-submit` Proposal: Use AskUserQuestion with these choices: "Submit <id> now" / "Reject <id>". Replace <id> with the staged Proposal id in both choices. The chosen label is the authorization; run the submit only after a label that starts with Submit <id>. Under `manual`, run `mob submit p-N` only when the latest user message says `submit p-N` or the chosen answer is your offered option that starts with `Submit p-N`. Under `auto`, you may run it and must say that auto policy allowed it. API acceptance is submitted, not confirmed.

For a wallet Proposal, state that this edit is not in the Strategy API and still needs the wallet, then: Use AskUserQuestion with four choices: "Sign <id> in the browser wallet" / "Sign <id> with WalletConnect" / "Sign <id> in my approver terminal" when `mob hello --json` reports `approver.running`, otherwise "I will sign <id> myself in my terminal with the keystore" / "Reject <id>". Replace <id> with the staged id in every choice. Only a chosen label that starts with Sign <id> authorizes. Run the command that matches the choice, with a ten-minute tool timeout while the human approves: the browser choice means `mob sign <id> --with browser`, WalletConnect means `mob sign <id> --with walletconnect`, and the approver choice means `mob sign <id> --with approver`, which hands the card to the human's approver terminal. The keystore choice means stop and tell the human to run `mob sign <id> --with keystore` in their own terminal. Never run `mob sign p-N` unless the latest user message says `sign p-N` (or the chosen answer is your offered option that starts with `Sign p-N`) and authorizes the browser, WalletConnect, or approver path. Never run keystore signing yourself; with `approver.running` true in `mob hello --json`, use `mob sign p-N --with approver`.

If the Proposal expired, run `mob restage p-N`: same intent, new id, fresh preflight; ask again for the new id.
