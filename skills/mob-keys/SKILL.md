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

Run the preamble first. Use the printed `MOB_BIN` path in place of `mob`; shell-quote public values. If `MOB_MISSING` appears, show the install line and stop. Read [key safety and actions](references/keys.md).

# Key actions

- Status: run `mob keys show [--json]`. Report only prefix, backend, scope, cap, and verification.
- Server list: run `mob keys list`. This stages a wallet Proposal. Apply the exact `p-N` authorization rule below.
- Revoke: run `mob keys revoke <uuid>`. This stages a wallet Proposal and deletes a matching local key only after acknowledgement.
- Local delete: run `mob keys delete`. It does not revoke the server key. Confirm that distinction before deleting.
- Import: ask for a name, exact venues, and modest USD cap. Ask the user to paste the key in chat. Never repeat it.

For import, never echo the key, write it to a file, log it, put it in command text or argv, or use an environment variable. Bind it through the host's secret-safe shell variable `KEY`, then run exactly:

```bash
printf '%s' "$KEY" | mob keys import --stdin --name '<name>' --venues '<a,b>' --max-size '<usd>'
```

Use the printed `MOB_BIN` path. Do not use `echo`, a positional key, or `--from-env`. Report only the stored prefix and backend. A human can instead run `mob keys import` and use the hidden prompt.

## Wallet Proposal rule

For list or revoke, show the id, exact purpose, owner, preflight, expiry, message, and digest. STOP. Never run `mob sign p-N` unless the latest user message names that exact id and authorizes the browser path. The agent never runs keystore signing and never requests a passphrase.
