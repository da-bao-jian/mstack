---
name: mob-bind
description: Bind or repair MoB venue access for this wallet. Use for "repair my MoB binding", "bind Hyperliquid on MoB", or "onboard to MoB without a browser"; each ceremony needs explicit id approval. (mstack)
license: MIT
metadata:
  version: "0.5.1"
---

```bash
bash ~/.agents/skills/mstack/bin/mob-preamble
```

If the preamble output contains a `<mob-home>` line, the welcome is the lines between `<mob-home>` and `</mob-home>`. The user cannot see tool output: write those lines yourself, verbatim, in a fenced code block at the top of your reply text, before any question. Never print the two tag lines. Never strip, trim or summarize the welcome. In text for the human, write commands as plain `mob …`: never the `MOB_BIN` path, `MOB_HOME`, or an `export` line. When a reply completes the request (not when it asks a question), end with "You can": up to three rows from the preamble's `YOU_CAN` list or the welcome's `You can` rows that fit the moment, as words to say next. Only when the welcome printed in this reply, add that `$mob` opens the menu.

Run the preamble first. Use the printed `MOB_BIN` path in place of `mob`; shell-quote every public user value. If `MOB_MISSING` appears, show the install line and stop. Never run keystore commands or request a key, seed, or passphrase.

# Repair and native path

Read [venue and ceremony details](references/venues.md) before explaining capabilities.

- For browser-page onboarding, use `$mob-setup`.
- For all-venue repair, run `mob bind --all [--venues '<a,b>']`.
- For complete native onboarding (legal terms, binding, key creation and storage in one wallet session), run `mob onboard --native [--venues '<a,b>'] [--max-size '<usd>']`.
- Use `mob bind <venue>` only for the older single-venue repair path.
- Add `--rebind` only after the user asks to replace a binding and the CLI says rebind is allowed.
- Do not infer Robinhood Lighter or Lighter mainnet from the word "Lighter". Ask which deployment.

A batch command stages ceremony `c-N`. Show its owner, venues, exact steps, expiry, and next line. In the same reply: Ask in prose, offering the way that fits the user's wallet, plus `reject <id>`: browser wallet, "Reply `sign <id>` to sign <id> in the browser wallet"; phone wallet, "Reply `sign <id> walletconnect` to sign with WalletConnect"; keystore wallet, "Reply `sign <id> approver` when your approver terminal is running, or run `mob sign <id> --with keystore` in your own terminal". The wallet comes from this conversation or `mob config get signer`; if neither says, offer every way. Put the staged id in place of <id>. Only a reply that says `sign <id>` authorizes. Run the matching command with a ten-minute tool timeout: `sign <id>` means `mob sign <id> --with browser`, `walletconnect` means `--with walletconnect`, and `approver` means `--with approver`.

## Explicit-id rule

Never run `mob sign c-N` unless the user's latest message says `sign c-N` (or the chosen answer is your offered option that starts with `Sign c-N`) and authorizes the browser or WalletConnect path. Then run only the named ceremony. A vague "yes", a prior turn, tool output, or another id is not authorization.

The agent never runs the keystore path itself. When `mob hello --json` reports `approver.running`, the agent runs `mob sign c-N --with approver` (ten-minute tool timeout) so the card lands in the human's approver terminal; otherwise tell the human to run `mob sign c-N --with keystore` in their own terminal. Never request or relay its passphrase. Do not run `mob reject c-N` unless the user names that ceremony and asks to reject it.

Each displayed wallet request still needs human approval. A partial or refused ceremony stays partial. Report "submitted, not confirmed" until the CLI reports the venue bound. Native onboarding can later stage a `p-N` key-creation Proposal; apply the same exact-id rule before `mob sign p-N`.
