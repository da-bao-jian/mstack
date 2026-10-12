# Agent install prompt

```text
Install mstack, the Mobius funding-arbitrage agent stack, and get me ready to trade.
Read https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.0/docs/AGENT-INSTALL.md
and follow it for this host exactly. Then verify with `mob --version` and `mob doctor`,
tell me if I need to restart, and when the skills are loaded start the onboarding
with "set me up". My wallet address is 0x…
```

## Without a wallet address

```text
Install mstack, the Mobius funding-arbitrage agent stack, and get me ready to trade.
Read https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.0/docs/AGENT-INSTALL.md
and follow it for this host exactly. Then verify with `mob --version` and `mob doctor`,
tell me if I need to restart, and when the skills are loaded start the onboarding
with "set me up". Ask for my wallet address only when onboarding needs it.
```

## Codex

```text
Install mstack, the Mobius funding-arbitrage agent stack, and get me ready to trade.
Read https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.0/docs/AGENT-INSTALL.md
and follow it for this host exactly. Then verify with `mob --version` and `mob doctor`,
tell me if I need to start a new session, and when the skills are loaded start the onboarding
with "set me up". My wallet address is 0x…
```

## Copy for `mob.exchange/agent`

Title: Install the Mobius funding-arbitrage agent stack

mstack gives your agent funding scans, guided onboarding, and policy-gated trading through Mobius.
Paste the prompt below into Claude Code, Codex, or another shell-capable agent.
The agent detects its host, installs one supported path, verifies the CLI, and starts onboarding.

```text
Install mstack, the Mobius funding-arbitrage agent stack, and get me ready to trade.
Read https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.0/docs/AGENT-INSTALL.md
and follow it for this host exactly. Then verify with `mob --version` and `mob doctor`,
tell me if I need to restart, and when the skills are loaded start the onboarding
with "set me up". My wallet address is 0x…
```

Custody: Your wallet key never leaves your wallet. The scoped Mobius API key cannot withdraw and stays subject to its venue and USD caps. Your funds stay in your own venue accounts. Revoke the API key on the Mobius API page at any time.
