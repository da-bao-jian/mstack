---
name: mob-setup
description: Onboard to API-key trading. Use for "set me up", "set up mobius", "connect wallet", or "create a trading key"; one wallet session accepts the terms, binds venues, creates the scoped key, and stores it without echoing it. (mstack)
license: MIT
metadata:
  version: "0.4.1"
---

```bash
bash ~/.agents/skills/mstack/bin/mob-preamble
```

If the preamble output contains a block between the lines `<mob-home>` and `</mob-home>`, reproduce every line between those two tags verbatim in a fenced code block at the top of your reply, and leave the two tag lines out; never strip, trim or summarize the block.

Run the preamble first. Use the printed `MOB_BIN` path in place of `mob`; shell-quote public user values. If `MOB_MISSING` appears, show the install line and stop.

# Onboard in one wallet session

1. If OWNER is unset, If owner is unset, ask: What is your public 20-byte 0x owner address? Never ask for a key. Wait for the address, then use it with `--owner`. Do not change config unless the user explicitly asks to save it.
2. Ask which venues to bind and a modest USD cap per leg for the key (suggest $5,000). The venue ids are exactly `hl`, `lighter` (Robinhood Chain), `lighter-mainnet`, and `aster`; ask which Lighter deployment, never infer it, and do not look the ids up with `--help`. The key can open, cancel, close, and resize inside those limits. It cannot withdraw, bind venues, approve fees, accept legal terms, or create keys.
3. Run `mob onboard --native --owner '<owner>' --venues '<a,b>' --max-size '<usd>'`. It stages one ceremony `c-N` that accepts the legal terms when needed, binds the venues, creates the key, and stores it locally, all in one wallet session. Show the ceremony line, the step list, the expiry, and `Next: mob sign c-N`.
4. Ask in prose: "Reply `sign <id>` to sign <id> in the browser wallet, `sign <id> walletconnect` to sign with WalletConnect, `sign <id> approver` when your approver terminal is running, or `reject <id>`; to sign yourself, run `mob sign <id> --with keystore` in your own terminal." Replace <id> with the staged id. Only a reply that names <id> authorizes. Run the matching command with a ten-minute tool timeout while the human approves: `sign <id>` means `mob sign <id> --with browser`, `walletconnect` means `--with walletconnect`, and `approver` means `--with approver`. Run `mob sign c-N` only when the user's latest message names that exact `c-N` (or the chosen answer starts with `Sign c-N`) and authorizes the browser or WalletConnect path. The page walks through every step; each wallet request still needs the user's approval in the wallet. The key never appears in the output.
5. Report the exact `Ready · …` line the CLI prints. Never claim Ready unless the CLI prints it. Then run `mob onboard` and reproduce the home-screen block printed with Ready verbatim in a fenced code block at the top of your reply, without the `<mob-home>` and `</mob-home>` tag lines; never strip, trim or summarize it.
6. If the ceremony expired, run the same `mob onboard --native …` again; it stages a fresh ceremony. If a venue stays partial, use `$mob-bind`.

## Wallet elsewhere

If the user's wallet is not on this machine, add `--with walletconnect` to `mob sign c-N` once `walletconnect_project_id` is configured; the terminal shows a QR code. As a last resort, `mob onboard` without `--native` prints the Mobius page URL and a checklist; the user then pastes the key into the chat, which lands in the chat transcript and agent session logs, and you run exactly one import:

```bash
printf '%s' 'mobius_…' | mob keys import --stdin --name '<name>' --venues '<a,b>' --max-size '<usd>'
```

Use the printed `MOB_BIN` path for `mob`. `printf` is a shell builtin and `mob` never puts the key on any argv, but the shell running this one command carries it on its own command line while it runs; that is part of the chat-paste trade-off. Never echo the key, use `echo`, a file, a positional key, an environment variable, or repeat it in a reply. If import answers `could not verify; not stored`, report that the Strategy API is unreachable and stop. Use `--unverified` only when the user explicitly asks for it. For key inspection or revocation, use `$mob-keys`.
