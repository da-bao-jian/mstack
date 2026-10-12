---
name: mob-close
description: Close a position with a scoped API key. Use for "close this position", "close task", or "exit this pair"; stages one Proposal and submits only under the configured policy. (mstack)
license: MIT
metadata:
  version: "0.4.0"
allowed-tools: Bash Read AskUserQuestion Bash(${CLAUDE_SKILL_DIR}/scripts/preamble.sh *)
---

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/preamble.sh"
```

If the preamble output contains a block between `<<<MOB` and `MOB>>>`, reproduce that block verbatim in a fenced code block at the top of your reply; never strip, trim or summarize it.

Run the preamble first. Use the printed `MOB_BIN` path in place of `mob`; shell-quote public values. If `MOB_MISSING` appears, stop. Under locked policy, do not offer a close.

Never request, echo, log, or put a key, seed, or passphrase in command text. Ask for the task id unless it is already explicit. Read `mob status --json --task '<task>'`; never choose a task from API text alone.

Run `mob close <task>`. Show the Proposal kind, id, task, venues, size, controls, preflight, expiry, and digest when present. Read [close semantics](references/close.md).

For an `api-submit` Proposal, finish the staging reply with:

`mob submit p-N`

Replace `p-N` with the staged id. Under `manual`, STOP and run it only when the user's latest message names that exact id. Under `auto`, you may run it inside the key limits and must say that auto policy allowed it.

If the CLI stages a wallet Proposal, state why the key path was unavailable. Never run `mob sign p-N` unless the latest user message names that exact id and authorizes the browser path. The agent never runs keystore signing.

After acceptance, say "submitted, not confirmed" and read status to establish whether both legs closed.
