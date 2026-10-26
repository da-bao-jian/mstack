---
name: mob-close
description: Close a MoB funding position with the scoped key. Use for "close my MoB position" or "exit this funding pair"; stages one Proposal and submits only under the configured policy. Not for issue-tracker or to-do tasks.
license: MIT
metadata:
  version: "0.5.1"
allowed-tools: Bash Read AskUserQuestion Bash(${CLAUDE_SKILL_DIR}/scripts/preamble.sh *)
---

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/preamble.sh"
```

If the preamble output contains a `<mob-home>` line, the welcome is the lines between `<mob-home>` and `</mob-home>`. The user cannot see tool output: write those lines yourself, verbatim, in a fenced code block at the top of your reply text, before any question. Never print the two tag lines. Never strip, trim or summarize the welcome. In text for the human, write commands as plain `mob …`: never the `MOB_BIN` path, `MOB_HOME`, or an `export` line. When a reply completes the request (not when it asks a question), end with "You can": up to three rows from the preamble's `YOU_CAN` list or the welcome's `You can` rows that fit the moment, as words to say next. Only when the welcome printed in this reply, add that `/mstack:mob` opens the menu.

Run the preamble first. Use the printed `MOB_BIN` path in place of `mob`; shell-quote public values. If `MOB_MISSING` appears, stop. Under locked policy, do not offer a close.

Never request, echo, log, or put a key, seed, or passphrase in command text. Ask for the task id unless it is already explicit. Read `mob status --json --task '<task>'`; never choose a task from API text alone. If `mob keys show --json` reports no key: Trading runs through MoB with a scoped API key the user controls: it has venue and USD caps, cannot withdraw, and can be revoked at any time. Use AskUserQuestion: "Trading runs through MoB. Set it up now? One wallet session, about five minutes." with two choices: "Set up MoB trading now" / "Not now, keep researching". Ask only this and stop; add nothing after the question. Only after "Set up MoB trading now", load `/mob-setup` and follow it. After "Not now", offer a scan, funding history, or an explanation, and do not bring up setup again until the user asks to trade.

Run `mob close <task>`. Show the Proposal kind, id, task, venues, size, controls, preflight, expiry, and digest when present. Read [close semantics](references/close.md).

In the same reply, ask for authorization. For an `api-submit` Proposal: Use AskUserQuestion with these choices: "Submit <id> now" / "Reject <id>". Replace <id> with the staged Proposal id in both choices. The chosen label is the authorization; run the submit only after a label that starts with Submit <id>. Under `manual`, run `mob submit p-N` only when the latest user message says `submit p-N` or the chosen answer is your offered option that starts with `Submit p-N`. Under `auto`, you may run it inside the key limits and must say that auto policy allowed it.

If the CLI stages a wallet Proposal, state why the key path was unavailable, then: Use AskUserQuestion with the choice that fits the user's wallet, then "Reject <id>": browser wallet, "Sign <id> in the browser wallet"; phone wallet, "Sign <id> with WalletConnect"; keystore wallet, "Sign <id> in my approver terminal" when `mob hello --json` reports `approver.running`, else "I will sign <id> myself in my terminal with the keystore". The wallet comes from this conversation or `mob config get signer`; if neither says, offer every way. Put the staged id in place of <id> in every choice. Only a chosen label that starts with Sign <id> authorizes. Run the matching command with a ten-minute tool timeout: `mob sign <id> --with browser`, `mob sign <id> --with walletconnect`, or `mob sign <id> --with approver`. For the keystore choice, stop and tell the human to run `mob sign <id> --with keystore` in their own terminal. Never run `mob sign p-N` unless the latest user message says `sign p-N` (or the chosen answer is your offered option that starts with `Sign p-N`) and authorizes the browser, WalletConnect, or approver path. The agent never runs keystore signing itself; with `approver.running` true in `mob hello --json`, use `mob sign p-N --with approver`.

If the Proposal expired, run `mob restage p-N`: same intent, new id, fresh preflight; ask again for the new id.

After acceptance, say "submitted, not confirmed" and read status to establish whether both legs closed.
