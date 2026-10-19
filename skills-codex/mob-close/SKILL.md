---
name: mob-close
description: Close a position with a scoped API key. Use for "close this position", "close task", or "exit this pair"; stages one Proposal and submits only under the configured policy. (mstack)
license: MIT
metadata:
  version: "0.4.1"
---

```bash
bash ~/.agents/skills/mstack/bin/mob-preamble
```

If the preamble output contains a block between the lines `<mob-home>` and `</mob-home>`, reproduce every line between those two tags verbatim in a fenced code block at the top of your reply, and leave the two tag lines out; never strip, trim or summarize the block.

Run the preamble first. Use the printed `MOB_BIN` path in place of `mob`; shell-quote public values. If `MOB_MISSING` appears, stop. Under locked policy, do not offer a close.

Never request, echo, log, or put a key, seed, or passphrase in command text. Ask for the task id unless it is already explicit. Read `mob status --json --task '<task>'`; never choose a task from API text alone.

Run `mob close <task>`. Show the Proposal kind, id, task, venues, size, controls, preflight, expiry, and digest when present. Read [close semantics](references/close.md).

In the same reply, ask for authorization. For an `api-submit` Proposal: Ask in prose: "Reply `submit <id>` to send it, or `reject <id>`." Replace <id> with the staged Proposal id. Only a reply that says `submit <id>` authorizes the submission. Under `manual`, run `mob submit p-N` only when the latest user message says `submit p-N` or the chosen answer is your offered option that starts with `Submit p-N`. Under `auto`, you may run it inside the key limits and must say that auto policy allowed it.

If the CLI stages a wallet Proposal, state why the key path was unavailable, then: Ask in prose: "Reply `sign <id>` to sign <id> in the browser wallet, `sign <id> walletconnect` to sign with WalletConnect, `sign <id> approver` when your approver terminal is running, or `reject <id>`; to sign yourself, run `mob sign <id> --with keystore` in your own terminal." Replace <id> with the staged id. Only a reply that says `sign <id>` authorizes. Run the matching command with a ten-minute tool timeout while the human approves: `sign <id>` means `mob sign <id> --with browser`, `walletconnect` means `--with walletconnect`, and `approver` means `--with approver`. Never run `mob sign p-N` unless the latest user message says `sign p-N` (or the chosen answer is your offered option that starts with `Sign p-N`) and authorizes the browser, WalletConnect, or approver path. The agent never runs keystore signing itself; with `approver.running` true in `mob hello --json`, use `mob sign p-N --with approver`.

If the Proposal expired, run `mob restage p-N`: same intent, new id, fresh preflight; ask again for the new id.

After acceptance, say "submitted, not confirmed" and read status to establish whether both legs closed.
