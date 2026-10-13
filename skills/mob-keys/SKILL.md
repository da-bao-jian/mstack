---
name: mob-keys
description: Manage the scoped Mobius API key safely. Use for "import my key", "show key status", "list my keys", "revoke this key", or "delete the local key"; never reveals or echoes the secret. (mstack)
license: MIT
metadata:
  version: "0.4.0"
allowed-tools: Bash Read AskUserQuestion Bash(${CLAUDE_SKILL_DIR}/scripts/preamble.sh *)
---

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/preamble.sh"
```

If the preamble output contains a block between the lines `<mob-home>` and `</mob-home>`, reproduce every line between those two tags verbatim in a fenced code block at the top of your reply, and leave the two tag lines out; never strip, trim or summarize the block.

Run the preamble first. Use the printed `MOB_BIN` path in place of `mob`; shell-quote public values. If `MOB_MISSING` appears, show the install line and stop. Read [key safety and actions](references/keys.md).

# Key actions

- Status: run `mob keys show [--json]`. Report only prefix, backend, scope, cap, and verification.
- Server list: run `mob keys list`. This stages a wallet Proposal. Apply the exact `p-N` authorization rule below.
- Revoke: run `mob keys revoke <uuid>`. This stages a wallet Proposal and deletes a matching local key only after acknowledgement.
- Local delete: run `mob keys delete`. It does not revoke the server key. Confirm that distinction before deleting.
- Import: ask for a name, exact venues, and modest USD cap. Ask the user to paste the key in chat. Never repeat it.

For import, run exactly one command. Put the already-pasted key in the single-quoted stdin value below, replacing `mobius_…`:

```bash
printf '%s' 'mobius_…' | mob keys import --stdin --name '<name>' --venues '<a,b>' --max-size '<usd>'
```

Use the printed `MOB_BIN` path. `printf` is a shell builtin, so the key does not appear in a process list. Never echo the key. Never use `echo`, a file, a positional key, an environment variable, or `--from-env`. Never repeat the key in a reply or any other command. Report only the stored prefix and backend.

If import answers `could not verify; not stored`, report that the Strategy API is unreachable and stop. Use `--unverified` only when the user explicitly asks for it. A human can instead run `mob keys import` and use the hidden prompt.

## Wallet Proposal rule

For list or revoke, show the id, exact purpose, owner, preflight, expiry, message, and digest. STOP. Never run `mob sign p-N` unless the latest user message names that exact id and authorizes the browser path. The agent never runs keystore signing and never requests a passphrase.
