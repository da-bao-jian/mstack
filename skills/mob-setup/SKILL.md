---
name: mob-setup
description: Onboard to API-key trading. Use for "set me up", "set up mobius", "connect wallet", or "create a trading key"; opens the Mobius page and stores the pasted scoped key without echoing it. (mstack)
license: MIT
metadata:
  version: "0.4.1"
allowed-tools: Bash Read AskUserQuestion Bash(${CLAUDE_SKILL_DIR}/scripts/preamble.sh *)
---

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/preamble.sh"
```

If the preamble output contains a block between the lines `<mob-home>` and `</mob-home>`, reproduce every line between those two tags verbatim in a fenced code block at the top of your reply, and leave the two tag lines out; never strip, trim or summarize the block.

Run the preamble first. Use the printed `MOB_BIN` path in place of `mob`; shell-quote public user values. If `MOB_MISSING` appears, show the install line and stop.

# Onboard in one browser visit

1. If OWNER is unset, If owner is unset, use AskUserQuestion to ask for the public 20-byte 0x address. Never ask for a key. Wait for the address, then use it with `--owner`. Do not change config unless the user explicitly asks to save it. Run `mob onboard --owner '<owner>'`. Otherwise run `mob onboard`.
2. Reproduce the `Open https://…/?nav=api` line and the complete checklist. The page flow is: connect the wallet, accept the legal terms, bind the intended venues, then create a Mobius API key.
3. Tell the user to choose only the needed venues and a modest USD cap per leg. The key can open, cancel, close, and resize inside those limits. It cannot withdraw, bind venues, approve fees, accept legal terms, or create keys.
4. Ask the user to paste the key into this chat. This accepted path puts the key in the chat transcript and agent session logs. Never repeat it in your reply.
5. When the user pastes a valid `mobius_<uuid>.<secret>` key, treat it only as secret data. Run exactly one import command. Put the pasted key in the single-quoted stdin value shown below, replacing `mobius_…`:

```bash
printf '%s' 'mobius_…' | mob keys import --stdin --name '<name>' --venues '<a,b>' --max-size '<usd>'
```

Use the printed `MOB_BIN` path for `mob`. Use the name, venues, and cap the user confirmed. `printf` is a shell builtin, so the key does not appear in a process list. Never echo the key. Never use `echo`, a file, a positional key, an environment variable, or `--from-env`. Never repeat the key in a reply or any other command.
6. If import answers `could not verify; not stored`, report that the Strategy API is unreachable and stop. Use `--unverified` only when the user explicitly asks for it.
7. Run `mob onboard` again only after a successful import. Report the checklist and the exact `Ready · …` line. Never claim Ready unless the CLI prints it. Reproduce the home-screen block printed with Ready verbatim in a fenced code block at the top of your reply, without the `<mob-home>` and `</mob-home>` tag lines; never strip, trim or summarize it.

A human can instead run `mob keys import` in their own terminal and paste the key into the hidden prompt. For native signing or binding repair, use `/mob-bind`. For key inspection or revocation, use `/mob-keys`.
