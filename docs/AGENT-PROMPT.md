# Agent install prompt

```text
Install mstack, the Mobius funding-arbitrage agent stack, and get me ready to trade.
Read https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.2/docs/AGENT-INSTALL.md
and follow it for this host exactly. Then verify with `mob --version` and `mob doctor`,
run `mob` and reproduce its output verbatim in a fenced block as the welcome.
Tell me if I need to restart; when the skills load, start with "set me up". My wallet address is 0x…
```

## Without a wallet address

```text
Install mstack, the Mobius funding-arbitrage agent stack, and get me ready to trade.
Read https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.2/docs/AGENT-INSTALL.md
and follow it for this host exactly. Then verify with `mob --version` and `mob doctor`,
run `mob` and reproduce its output verbatim in a fenced block as the welcome.
Tell me if I need to restart; start with "set me up". Ask for my wallet address only when needed.
```

## Codex

```text
Install mstack, the Mobius funding-arbitrage agent stack, and get me ready to trade.
Read https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.2/docs/AGENT-INSTALL.md
and follow it for this host exactly. Then verify with `mob --version` and `mob doctor`,
run `mob` and reproduce its output verbatim in a fenced block as the welcome.
Tell me if I need a new session; when the skills load, start with "set me up". My wallet address is 0x…
```

## Copy for `mob.exchange/agent`

Title: Install the Mobius funding-arbitrage agent stack

mstack gives your agent funding scans, guided onboarding, and policy-gated trading through Mobius.
Paste the prompt below into Claude Code, Codex, or another shell-capable agent.
The agent detects its host, installs one supported path, verifies the CLI, and starts onboarding.

```text
                         ------------------
                       --#-----------------
                     --###-----------------
                    -#####-----------------
          ++++++++########-----------------
       +++++++++++########-----------------
     +++++++++++++########-----------------
   +++++++++++++++########-----------------
 +++++++++++++++++########-----------------
 -----------------########+++++++++++++++++
 -----------------########+++++++++++++++
 -----------------########+++++++++++++
 -----------------########+++++++++++
 -----------------########+++++++++
 -----------------######-
 -----------------#####
 -----------------###
 -----------------#
```

```text
Install mstack, the Mobius funding-arbitrage agent stack, and get me ready to trade.
Read https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.2/docs/AGENT-INSTALL.md
and follow it for this host exactly. Then verify with `mob --version` and `mob doctor`,
run `mob` and reproduce its output verbatim in a fenced block as the welcome.
Tell me if I need to restart; when the skills load, start with "set me up". My wallet address is 0x…
```

Custody: Your wallet key never leaves your wallet. The scoped Mobius API key cannot withdraw and stays subject to its venue and USD caps. Your funds stay in your own venue accounts. Revoke the API key on the Mobius API page at any time.
