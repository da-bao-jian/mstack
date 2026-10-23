---
name: mob-setup
description: Onboard to trading through MoB; research never needs this. Use for "set up mstack", "set me up", "set up MoB", "connect wallet", "I want to trade", or "create a trading key"; one wallet session accepts the terms, binds venues, creates the scoped key, and stores it without echoing it. (mstack)
license: MIT
metadata:
  version: "0.5.1"
allowed-tools: Bash Read AskUserQuestion Bash(${CLAUDE_SKILL_DIR}/scripts/preamble.sh *)
---

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/preamble.sh"
```

If the preamble output contains a `<mob-home>` line, the welcome is the lines after `<mob-home>` and before `</mob-home>`. Put exactly those lines, verbatim, in a fenced code block at the top of your reply. The two tag lines are markers, not part of the welcome: never print `<mob-home>` or `</mob-home>`. Never strip, trim or summarize the welcome. When a reply completes the request (not when it asks a question), end with "You can": up to three rows from the preamble's `YOU_CAN` list or the welcome's `You can` rows that fit the moment, as words to say next. Only when the welcome printed in this reply, add that `/mstack:mob` opens the menu.

Run the preamble first. Use the printed `MOB_BIN` path in place of `mob`; shell-quote public user values. If `MOB_MISSING` appears, show the install line and stop.

# Onboard in one wallet session

Setup is needed only to trade through MoB; for funding data alone, point to research in plain words, such as "best funding now". First say what it gives: a scoped MoB API key with venue and USD caps that cannot withdraw and can be revoked at any time.

1. If owner is unset, use AskUserQuestion to ask "Do you want to bring your own wallet or create a new one?" with four choices: "Bring my browser wallet" (MetaMask, Rabby, or another extension on this computer), "Bring my phone wallet (WalletConnect)", "Bring my wallet into mstack's encrypted keystore", and "Create a new wallet with mstack". For a browser or phone wallet, ask for its public 0x address; WalletConnect also needs a Reown project id, which the human saves in their own terminal with `mob config set walletconnect_project_id <id>`. For the keystore choices, tell the human to run `mob keystore import` (their existing private key) or `mob keystore create` (a new key) in a separate terminal window, never in this chat, and to reply with the address it prints. A created wallet starts empty, and its encrypted file in `~/.mob/keystore/` plus the passphrase are the only copy: tell the human to back up both and to fund the wallet on each venue before trading. Never ask for or accept a private key, seed phrase, or passphrase in the chat. Use the address with `--owner`. Do not change config unless the user explicitly asks to save it.
2. Ask which venues to bind and a modest USD cap per leg for the key (suggest 5,000 USD). The venue ids are exactly `hl`, `lighter` (Robinhood Chain), `lighter-mainnet`, and `aster`; ask which Lighter deployment, never infer it, and do not look the ids up with `--help`. The key can open, cancel, close, and resize inside those limits; it cannot withdraw, bind venues, approve fees, accept terms, or create keys.
3. Run `mob onboard --native --owner '<owner>' --venues '<a,b>' --max-size '<usd>'`. It stages one ceremony `c-N` that accepts the legal terms when needed, binds the venues, creates the key, and stores it locally, all in one wallet session. Show the ceremony line, the step list, the expiry, and `Next: mob sign c-N`. It first checks that the wallet has an account on each venue; if it prints `No … account` and stages nothing, show that line, ask whether to create the account on the venue's website or leave the venue out, and run it again with the chosen `--venues`. If it says a venue has a MoB key that no longer works, explain that plainly and ask whether to replace the key; only after a yes, add `--rebind`. A missing Lighter integrator approval needs no question: the ceremony lists it as a signing step and keeps the key.
4. Use AskUserQuestion with four choices: "Sign <id> in the browser wallet" / "Sign <id> with WalletConnect" / "Sign <id> in my approver terminal" when `mob hello --json` reports `approver.running`, otherwise "I will sign <id> myself in my terminal with the keystore" / "Reject <id>". Replace <id> with the staged id in every choice. Only a chosen label that starts with Sign <id> authorizes. Run the command that matches the choice, with a ten-minute tool timeout while the human approves: the browser choice means `mob sign <id> --with browser`, WalletConnect means `mob sign <id> --with walletconnect`, and the approver choice means `mob sign <id> --with approver`, which hands the card to the human's approver terminal. The keystore choice means stop and tell the human to run `mob sign <id> --with keystore` in their own terminal. Run the sign command only when the user's latest message says `sign c-N` (or the chosen answer is your offered option that starts with `Sign c-N`) and authorizes the browser or WalletConnect path. The page walks every step; each wallet request still needs approval in the wallet. The key never prints.
5. Report the exact `Ready · …` line the CLI prints; never claim Ready otherwise. Then run `mob onboard` and reproduce the home-screen block printed with Ready verbatim in a fenced code block at the top of your reply, without the `<mob-home>` and `</mob-home>` tag lines; never strip, trim or summarize it.
6. If the ceremony expired, run the same `mob onboard --native …` again for a fresh one. If a venue stays partial, use `/mob-bind`. When `mob sign` stops, quote its last message: it names the cause and the next command; run it only after the user agrees.

## Wallet elsewhere

If the user's wallet is not on this machine, add `--with walletconnect` to `mob sign c-N` once `walletconnect_project_id` is configured; the terminal shows a QR code. As a last resort, `mob onboard` without `--native` prints the MoB page URL and a checklist; the user then pastes the key into the chat, which lands in the chat transcript and agent session logs, and you run exactly one import:

```bash
printf '%s' 'mobius_…' | mob keys import --stdin --name '<name>' --venues '<a,b>' --max-size '<usd>'
```

Before you run it, check that the pasted text matches exactly `^mobius_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{64}$`; if it does not, run nothing and ask the human to run `mob keys import` in their own terminal.

`printf` is a shell builtin and `mob` never puts the key on any argv, but the shell running this one command carries it on its own command line while it runs; that is part of the chat-paste trade-off. Never echo the key, use `echo`, a file, a positional key, an environment variable, or repeat it in a reply. If import answers `could not verify; not stored`, report that the Strategy API is unreachable and stop. Use `--unverified` only when the user explicitly asks for it. For key inspection or revocation, use `/mob-keys`.
