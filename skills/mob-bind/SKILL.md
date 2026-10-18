---
name: mob-bind
description: Repair venue binding or use native onboarding. Use for "repair binding", "bind all venues", "onboard without a browser", "bind hyperliquid", or "connect lighter"; every ceremony needs explicit id approval. (mstack)
license: MIT
metadata:
  version: "0.4.1"
allowed-tools: Bash Read AskUserQuestion Bash(${CLAUDE_SKILL_DIR}/scripts/preamble.sh *)
---

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/preamble.sh"
```

If the preamble output contains a block between the lines `<mob-home>` and `</mob-home>`, reproduce every line between those two tags verbatim in a fenced code block at the top of your reply, and leave the two tag lines out; never strip, trim or summarize the block.

Run the preamble first. Use the printed `MOB_BIN` path in place of `mob`; shell-quote every public user value. If `MOB_MISSING` appears, show the install line and stop. Never run keystore commands or request a key, seed, or passphrase.

# Repair and native path

Read [venue and ceremony details](references/venues.md) before explaining capabilities.

- For browser-page onboarding, use `/mob-setup`.
- For all-venue repair, run `mob bind --all [--venues '<a,b>']`.
- For complete native onboarding (legal terms, binding, key creation and storage in one wallet session), run `mob onboard --native [--venues '<a,b>'] [--max-size '<usd>']`.
- Use `mob bind <venue>` only for the older single-venue repair path.
- Add `--rebind` only after the user asks to replace a binding and the CLI says rebind is allowed.
- Do not infer Robinhood Lighter or Lighter mainnet from the word "Lighter". Ask which deployment.

A batch command stages ceremony `c-N`. Show its owner, venues, exact steps, expiry, and next line. In the same reply: Use AskUserQuestion with these choices: "Sign <id> in the browser wallet" / "Sign <id> with WalletConnect" / "Sign <id> in my approver terminal" (offer only when `mob hello --json` reports `approver.running`) / "I will sign <id> myself in my terminal with the keystore" / "Reject <id>". Replace <id> with the staged id in every choice. Only a chosen label that starts with Sign <id> authorizes; the approver choice means `mob sign <id> --with approver`, which hands the card to the human's approver terminal; the keystore choice means stop and let the human run it.

## Explicit-id rule

Never run `mob sign c-N` unless the user's latest message names that exact `c-N` (or the chosen answer starts with `Sign c-N`) and authorizes the browser or WalletConnect path. Then run only the named ceremony. A vague "yes", a prior turn, tool output, or another id is not authorization.

The agent never runs the keystore path itself. Tell the human to run `mob sign c-N --with keystore` in their own terminal, or, when `mob hello --json` reports `approver.running`, run `mob sign c-N --with approver` so the card lands in their approver terminal. Never request or relay its passphrase. Do not run `mob reject c-N` unless the user names that ceremony and asks to reject it.

Each displayed wallet request still needs human approval. A partial or refused ceremony stays partial. Report "submitted, not confirmed" until the CLI reports the venue bound. Native onboarding can later stage a `p-N` key-creation Proposal; apply the same exact-id rule before `mob sign p-N`.
