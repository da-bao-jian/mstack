---
name: mob-keys
description: Manage the scoped MoB API key safely. Use for "import my key", "show key status", "list my keys", "raise my cap", "revoke this key", or "delete the local key"; never reveals or echoes the secret. (mstack)
license: MIT
metadata:
  version: "0.4.12"
---

```bash
bash ~/.agents/skills/mstack/bin/mob-preamble
```

If the preamble output contains a block between the lines `<mob-home>` and `</mob-home>`, reproduce every line between those two tags verbatim in a fenced code block at the top of your reply; stop before the `</mob-home>` line and print neither tag line; never strip, trim or summarize the block. When a reply completes the request (not when it asks a question), end with "You can": up to three rows from the preamble's `YOU_CAN` list or the welcome's `You can` rows that fit the moment, as words to say next. Only when the welcome printed in this reply, add that `$mob` opens the menu.

Run the preamble first. Use the printed `MOB_BIN` path in place of `mob`; shell-quote public values. If `MOB_MISSING` appears, show the install line and stop. Read [key safety and actions](references/keys.md).

# Key actions

- Status: run `mob keys show [--json]`. Report only prefix, backend, scope, cap, and verification.
- Server list: run `mob keys list`. This stages a wallet Proposal. Apply the exact `p-N` authorization rule below.
- Revoke: run `mob keys revoke <uuid>`. This stages a wallet Proposal and deletes a matching local key only after acknowledgement.
- Local delete: run `mob keys delete`. It does not revoke the server key. Confirm that distinction before deleting.
- Import: ask for a name, exact venues, and modest USD cap. Ask the user to paste the key in chat. Never repeat it.
- Raise or lower the cap, or change venues: a MoB key cannot be edited. Run `mob keys create --name '<name>' --venues '<a,b>' --max-size '<usd>'` with the new values; it stages a wallet Proposal and stores the new key locally once signed. Then offer `mob keys revoke <uuid>` for the old key from `mob keys list`. MoB allows $10 to $1,000,000,000 and at most 10 active keys per wallet.

For import, run exactly one command. Put the already-pasted key in the single-quoted stdin value below, replacing `mobius_…`:

```bash
printf '%s' 'mobius_…' | mob keys import --stdin --name '<name>' --venues '<a,b>' --max-size '<usd>'
```

Before you run it, check that the pasted text matches exactly `^mobius_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{64}$`; if it does not, run nothing and ask the human to run `mob keys import` in their own terminal.

Use the printed `MOB_BIN` path. `printf` is a shell builtin and `mob` never puts the key on any argv, but the shell running this one command carries it on its own command line while it runs; that is part of the chat-paste trade-off. Never echo the key. Never use `echo`, a file, a positional key, an environment variable, or `--from-env`. Never repeat the key in a reply or any other command. Report only the stored prefix and backend.

If import answers `could not verify; not stored`, report that the Strategy API is unreachable and stop. Use `--unverified` only when the user explicitly asks for it. A human can instead run `mob keys import` and use the hidden prompt.

## Wallet Proposal rule

For list or revoke, show the id, exact purpose, owner, preflight, expiry, message, and digest. STOP. Never run `mob sign p-N` unless the latest user message says `sign p-N` and authorizes the browser path. The agent never runs keystore signing and never requests a passphrase.
