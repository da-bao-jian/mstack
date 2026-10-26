---
name: mob-setup
description: One-time MoB setup to trade; research never needs it. Use for "set up mstack", "set up MoB", "connect my wallet to MoB", or "create a MoB trading key"; one wallet session binds venues and stores a scoped key without echoing it.
license: MIT
metadata:
  version: "0.5.1"
allowed-tools: Bash Read AskUserQuestion Bash(${CLAUDE_SKILL_DIR}/scripts/preamble.sh *)
---

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/preamble.sh"
```

If the preamble output contains a `<mob-home>` line, the welcome is the lines between `<mob-home>` and `</mob-home>`. The user cannot see tool output: write those lines yourself, verbatim, in a fenced code block at the top of your reply text, before any question. Never print the two tag lines. Never strip, trim or summarize the welcome. In text for the human, write commands as plain `mob …`: never the `MOB_BIN` path, `MOB_HOME`, or an `export` line. When a reply completes the request (not when it asks a question), end with "You can": up to three rows from the preamble's `YOU_CAN` list or the welcome's `You can` rows that fit the moment, as words to say next. Only when the welcome printed in this reply, add that `/mstack:mob` opens the menu.

Run the preamble first. Use the printed `MOB_BIN` path in place of `mob`; shell-quote public user values. If `MOB_MISSING` appears, show the install line and stop.

# Onboard in one wallet session

Setup is needed only to trade through MoB; for funding data alone, point to research, such as "best funding now". First say what it gives: a scoped MoB API key with venue and USD caps that cannot withdraw and can be revoked at any time. Then say in one sentence what it needs: two venues where this wallet already has an account (Hyperliquid also needs USDC in its perps account), and about 5 to 7 wallet approvals in one session of about five minutes.

1. If owner is unset, use AskUserQuestion: "Which wallet do you want to use?" with four choices: "Bring my browser wallet" (MetaMask, Rabby), "Bring my wallet into mstack's encrypted keystore", "Create a new wallet with mstack", and "Bring my phone wallet (WalletConnect)" (needs a free Reown project id). For a browser or phone wallet, ask for its public 0x address; for a phone wallet, the human gets a free project id at https://cloud.reown.com and saves it in their own terminal with `mob config set walletconnect_project_id` and the id. For a keystore choice, the human runs `mob keystore import` (existing key) or `mob keystore create` (new key) in a separate terminal window, never in this chat, and replies with the address it prints. A created wallet starts empty; its keystore file (`~/.mob/keystore` by default) and passphrase are the only copy: the human backs up both and funds the wallet on each venue. Never ask for or accept a private key, seed phrase, or passphrase in the chat. Pass the address with `--owner`; `mob onboard` saves it only once setup is staged.
2. Ask which venues to bind, at least two (one for each leg) where the wallet already has an account, and a modest USD cap per leg for the key (suggest 1,000 USD; a new key can raise it later). The venue ids are exactly `hl` (Hyperliquid), `lighter-mainnet` (Lighter), `lighter` (Lighter on Robinhood Chain), and `aster`; ask "Lighter or Lighter on Robinhood Chain?" and never infer it.
3. The ceremony expires five minutes after staging, so stage only when the wallet can sign now: the browser wallet is unlocked here, `mob config get walletconnect_project_id` prints an id, or the human replied with their keystore address. Run `mob onboard --native --owner '<owner>' --venues '<a,b>' --max-size '<usd>'`. It stages one ceremony `c-N` that accepts the terms when needed, binds the venues, creates the key and stores it, in one wallet session. Show its lines: `c-N` with the expiry, the session line, the terms links, and `Next: mob sign c-N`. If it stops and stages nothing, show that line: it names the next step. If a venue's trading key no longer works, explain plainly and ask whether to replace it; only after a yes, add `--rebind`. A missing Lighter integrator approval needs no question.
4. Use AskUserQuestion with the choice that fits the user's wallet, then "Reject <id>": browser wallet, "Sign <id> in the browser wallet"; phone wallet, "Sign <id> with WalletConnect"; keystore wallet, "Sign <id> in my approver terminal" when `mob hello --json` reports `approver.running`, else "I will sign <id> myself in my terminal with the keystore". The wallet comes from this conversation or `mob config get signer`; if neither says, offer every way. Put the staged id in place of <id> in every choice. Only a chosen label that starts with Sign <id> authorizes. Run the matching command with a ten-minute tool timeout: `mob sign <id> --with browser`, `mob sign <id> --with walletconnect`, or `mob sign <id> --with approver`. For the keystore choice, stop and tell the human to run `mob sign <id> --with keystore` in their own terminal. Sign only when the user's latest message says `sign c-N` or the chosen answer starts with `Sign c-N`. Each wallet request still needs approval in the wallet. After "Reject c-N", run `mob reject c-N`.
5. Report the exact `Ready · …` line the CLI prints; never claim Ready otherwise. If the human signed in their own terminal, ask them to paste that line. Then run `mob onboard --venues '<the same venues>'` and reproduce its home-screen block verbatim in a fenced code block at the top of your reply, without the tag lines. The closing You can offers trading: `say "open <base>"`, `say "my positions"`, `say "my key"`.
6. If the ceremony expired, run the same `mob onboard --native …` again for a fresh one; the new id needs a new `sign c-N`. If a venue stays partial, use `/mob-bind`. When `mob sign` stops, quote its last message: it names the cause and the next command; run it only after the user agrees.

## Wallet elsewhere

As a last resort, `mob onboard --owner '<owner>'` without `--native` prints the MoB page URL and a checklist; the user then pastes the key into the chat, which lands in the chat transcript and agent session logs, and you run exactly one import:

```bash
printf '%s' 'mobius_…' | mob keys import --stdin --name '<name>' --venues '<a,b>' --max-size '<usd>'
```

Before you run it, check that the pasted text matches exactly `^mobius_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{64}$`; if it does not, run nothing and ask the human to run `mob keys import` in their own terminal.

`printf` is a shell builtin and `mob` never puts the key on any argv, but the shell running this one command carries it on its own command line while it runs; that is part of the chat-paste trade-off. Never echo the key, use `echo`, a file, a positional key, an environment variable, or repeat it in a reply. If import answers `could not verify; not stored`, report the reason it names and stop. Use `--unverified` only when the user explicitly asks for it. For key inspection or revocation, use `/mob-keys`.
