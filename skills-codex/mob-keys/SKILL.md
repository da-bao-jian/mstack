---
name: mob-keys
description: Manage the scoped MoB API key; never reveals the secret. Use for "import my MoB key", "show my MoB key", "raise my MoB key cap", or "revoke my MoB key". Only MoB keys, never SSH, cloud or app keys. (mstack)
license: MIT
metadata:
  version: "0.5.1"
---

```bash
bash ~/.agents/skills/mstack/bin/mob-preamble
```

If the preamble output contains a `<mob-home>` line, the welcome is the lines between `<mob-home>` and `</mob-home>`. The user cannot see tool output: write those lines yourself, verbatim, in a fenced code block at the top of your reply text, before any question. Never print the two tag lines. Never strip, trim or summarize the welcome. In text for the human, write commands as plain `mob …`: never the `MOB_BIN` path, `MOB_HOME`, or an `export` line. When a reply completes the request (not when it asks a question), end with "You can": up to three rows from the preamble's `YOU_CAN` list or the welcome's `You can` rows that fit the moment, as words to say next. Only when the welcome printed in this reply, add that `$mob` opens the menu.

Run the preamble first. Use the printed `MOB_BIN` path in place of `mob`; shell-quote public values. If `MOB_MISSING` appears, show the install line and stop. Read [key safety and actions](references/keys.md).

# Key actions

- Status: run `mob keys show [--json]`. Report only prefix, backend, scope, cap, and verification.
- Server list: run `mob keys list`. This stages a wallet Proposal. Apply the exact `p-N` authorization rule below.
- Revoke: run `mob keys revoke <uuid>`. This stages a wallet Proposal and deletes a matching local key only after acknowledgement.
- Local delete: run `mob keys delete`. It does not revoke the server key. Confirm that distinction before deleting.
- Import: ask for a name, exact venues, and modest USD cap. If owner is unset, also ask for the public wallet address that made the key (it starts with 0x) and add `--owner '<owner>'` after `--stdin`. Ask the user to paste the key in chat. Never repeat it.
- Raise or lower the cap, or change venues: a MoB API key cannot be edited. Run `mob keys create --name '<name>' --venues '<a,b>' --max-size '<usd>'` with the new values; it stages a wallet Proposal and stores the new key locally once signed. Then offer `mob keys revoke <uuid>` for the old key from `mob keys list`. MoB allows caps from 10 USD to 1,000,000,000 USD and at most 10 active keys per wallet.
- No key yet: for show, create, a new cap, list or revoke when `mob keys show --json` reports no key, do not improvise commands. Trading runs through MoB with a scoped API key the user controls: it has venue and USD caps, cannot withdraw, and can be revoked at any time. Ask in prose: "Trading runs through MoB. Set it up now? One wallet session, about five minutes. Reply `set up` or `not now`." Ask only this and stop; add nothing after the question. Only after `set up`, load `$mob-setup` and follow it. After `not now`, offer a scan, funding history, or an explanation, and do not bring up setup again until the user asks to trade.

For import, run exactly one command. Put the already-pasted key in the single-quoted stdin value below, replacing `mobius_…`:

```bash
printf '%s' 'mobius_…' | mob keys import --stdin --name '<name>' --venues '<a,b>' --max-size '<usd>'
```

Before you run it, check that the pasted text matches exactly `^mobius_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{64}$`; if it does not, run nothing and ask the human to run `mob keys import` in their own terminal.

Use the printed `MOB_BIN` path. `printf` is a shell builtin and `mob` never puts the key on any argv, but the shell running this one command carries it on its own command line while it runs; that is part of the chat-paste trade-off. Never echo the key. Never use `echo`, a file, a positional key, an environment variable, or `--from-env`. Never repeat the key in a reply or any other command. Report only the stored prefix and backend.

If import answers `could not verify; not stored`, report the reason it names and stop. Use `--unverified` only when the user explicitly asks for it. A human can instead run `mob keys import` and use the hidden prompt.

## Wallet Proposal rule

For list or revoke, show the id, exact purpose, owner, preflight, expiry, message, and digest. STOP. Never run `mob sign p-N` unless the latest user message says `sign p-N` and authorizes the browser path. The agent never runs keystore signing and never requests a passphrase.
