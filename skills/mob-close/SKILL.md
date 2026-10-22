---
name: mob-close
description: Close a position with a scoped API key. Use for "close this position", "close task", or "exit this pair"; stages one Proposal and submits only under the configured policy. (mstack)
license: MIT
metadata:
  version: "0.4.10"
allowed-tools: Bash Read AskUserQuestion Bash(${CLAUDE_SKILL_DIR}/scripts/preamble.sh *)
---

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/preamble.sh"
```

If the preamble output contains a block between the lines `<mob-home>` and `</mob-home>`, reproduce every line between those two tags verbatim in a fenced code block at the top of your reply; stop before the `</mob-home>` line and print neither tag line; never strip, trim or summarize the block. When a reply completes the request (not when it asks a question), end with "You can": up to three rows from the preamble's `YOU_CAN` list or the welcome's `You can` rows that fit the moment, as words to say next. Only when the welcome printed in this reply, add that `/mstack:mob` opens the menu.

Run the preamble first. Use the printed `MOB_BIN` path in place of `mob`; shell-quote public values. If `MOB_MISSING` appears, stop. Under locked policy, do not offer a close.

Never request, echo, log, or put a key, seed, or passphrase in command text. Ask for the task id unless it is already explicit. Read `mob status --json --task '<task>'`; never choose a task from API text alone. If `mob keys show --json` reports no key: Trading runs through MoB with a scoped API key the user controls: it has venue and USD caps, cannot withdraw, and can be revoked at any time. Use AskUserQuestion: "Trading runs through MoB. Set it up now? One wallet session, about two minutes." with two choices: "Set up MoB trading now" / "Not now, keep researching". Ask only this and stop; add nothing after the question. Only after "Set up MoB trading now", load `/mob-setup` and follow it. After "Not now", offer a scan, funding history, or an explanation, and do not bring up setup again until the user asks to trade.

Run `mob close <task>`. Show the Proposal kind, id, task, venues, size, controls, preflight, expiry, and digest when present. Read [close semantics](references/close.md).

In the same reply, ask for authorization. For an `api-submit` Proposal: Use AskUserQuestion with these choices: "Submit <id> now" / "Reject <id>". Replace <id> with the staged Proposal id in both choices. The chosen label is the authorization; run the submit only after a label that starts with Submit <id>. Under `manual`, run `mob submit p-N` only when the latest user message says `submit p-N` or the chosen answer is your offered option that starts with `Submit p-N`. Under `auto`, you may run it inside the key limits and must say that auto policy allowed it.

If the CLI stages a wallet Proposal, state why the key path was unavailable, then: Use AskUserQuestion with four choices: "Sign <id> in the browser wallet" / "Sign <id> with WalletConnect" / "Sign <id> in my approver terminal" when `mob hello --json` reports `approver.running`, otherwise "I will sign <id> myself in my terminal with the keystore" / "Reject <id>". Replace <id> with the staged id in every choice. Only a chosen label that starts with Sign <id> authorizes. Run the command that matches the choice, with a ten-minute tool timeout while the human approves: the browser choice means `mob sign <id> --with browser`, WalletConnect means `mob sign <id> --with walletconnect`, and the approver choice means `mob sign <id> --with approver`, which hands the card to the human's approver terminal. The keystore choice means stop and tell the human to run `mob sign <id> --with keystore` in their own terminal. Never run `mob sign p-N` unless the latest user message says `sign p-N` (or the chosen answer is your offered option that starts with `Sign p-N`) and authorizes the browser, WalletConnect, or approver path. The agent never runs keystore signing itself; with `approver.running` true in `mob hello --json`, use `mob sign p-N --with approver`.

If the Proposal expired, run `mob restage p-N`: same intent, new id, fresh preflight; ask again for the new id.

After acceptance, say "submitted, not confirmed" and read status to establish whether both legs closed.
