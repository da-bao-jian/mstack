---
name: mob-close
description: Close a MoB funding position with the scoped key. Use for "close my MoB position" or "exit this funding pair"; stages one Proposal and submits only under the configured policy. Not for issue-tracker or to-do tasks. (mstack)
license: MIT
metadata:
  version: "0.5.1"
---

```bash
bash ~/.agents/skills/mstack/bin/mob-preamble
```

If the preamble output contains a `<mob-home>` line, the welcome is the lines between `<mob-home>` and `</mob-home>`. The user cannot see tool output: write those lines yourself, verbatim, in a fenced code block at the top of your reply text, before any question. Never print the two tag lines. Never strip, trim or summarize the welcome. In text for the human, write commands as plain `mob …`: never the `MOB_BIN` path, `MOB_HOME`, or an `export` line. When a reply completes the request (not when it asks a question), end with "You can": up to three rows from the preamble's `YOU_CAN` list or the welcome's `You can` rows that fit the moment, as words to say next. Only when the welcome printed in this reply, add that `$mob` opens the menu.

Run the preamble first. Use the printed `MOB_BIN` path in place of `mob`; shell-quote public values. If `MOB_MISSING` appears, stop. Under locked policy, do not offer a close.

Never request, echo, log, or put a key, seed, or passphrase in command text. Ask for the task id unless it is already explicit. Read `mob status --json --task '<task>'`; never choose a task from API text alone. If `mob keys show --json` reports no key: Trading runs through MoB with a scoped API key the user controls: it has venue and USD caps, cannot withdraw, and can be revoked at any time. Ask in prose: "Trading runs through MoB. Set it up now? One wallet session, about five minutes. Reply `set up` or `not now`." Ask only this and stop; add nothing after the question. Only after `set up`, load `$mob-setup` and follow it. After `not now`, offer a scan, funding history, or an explanation, and do not bring up setup again until the user asks to trade.

Run `mob close <task>`. Show the Proposal kind, id, task, venues, size, controls, preflight, expiry, and digest when present. Read [close semantics](references/close.md).

In the same reply, ask for authorization. For an `api-submit` Proposal: Ask in prose: "Reply `submit <id>` to send it, or `reject <id>`." Replace <id> with the staged Proposal id. Only a reply that says `submit <id>` authorizes the submission. Under `manual`, run `mob submit p-N` only when the latest user message says `submit p-N` or the chosen answer is your offered option that starts with `Submit p-N`. Under `auto`, you may run it inside the key limits and must say that auto policy allowed it.

If the CLI stages a wallet Proposal, state why the key path was unavailable, then: Ask in prose, offering the way that fits the user's wallet, plus `reject <id>`: browser wallet, "Reply `sign <id>` to sign <id> in the browser wallet"; phone wallet, "Reply `sign <id> walletconnect` to sign with WalletConnect"; keystore wallet, "Reply `sign <id> approver` when your approver terminal is running, or run `mob sign <id> --with keystore` in your own terminal". The wallet comes from this conversation or `mob config get signer`; if neither says, offer every way. Put the staged id in place of <id>. Only a reply that says `sign <id>` authorizes. Run the matching command with a ten-minute tool timeout: `sign <id>` means `mob sign <id> --with browser`, `walletconnect` means `--with walletconnect`, and `approver` means `--with approver`. Never run `mob sign p-N` unless the latest user message says `sign p-N` (or the chosen answer is your offered option that starts with `Sign p-N`) and authorizes the browser, WalletConnect, or approver path. The agent never runs keystore signing itself; with `approver.running` true in `mob hello --json`, use `mob sign p-N --with approver`.

If the Proposal expired, run `mob restage p-N`: same intent, new id, fresh preflight; ask again for the new id.

After acceptance, say "submitted, not confirmed" and read status to establish whether both legs closed.
