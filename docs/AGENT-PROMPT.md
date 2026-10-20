# Agent install prompt

```text
Install mstack, the open agent stack for delta-neutral funding trades, with MoB execution. I authorize exactly:
claude plugin marketplace add da-bao-jian/mstack && claude plugin install mstack@mstack
curl -fsSL https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.8/install.sh | sh
Then follow https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.8/docs/AGENT-INSTALL.md from Verify: `mob --version`, `mob doctor`,
run `mob` and reproduce its output verbatim in a fenced block as the welcome.
Finish by telling me to type /reload-plugins, then show how to use mstack: how to invoke it and the welcome's "You can" options (research needs no account; "set up mstack" only to trade).
```

## Codex

```text
Install mstack, the open agent stack for delta-neutral funding trades, with MoB execution. I authorize exactly:
git clone --branch v0.4.8 https://github.com/da-bao-jian/mstack ~/.mstack && cd ~/.mstack && ./setup --host codex
export PATH="$HOME/.agents/skills/mstack/bin:$PATH"
Then follow https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.8/docs/AGENT-INSTALL.md from Verify: `mob --version`, `mob doctor`,
run `mob` and reproduce its output verbatim in a fenced block as the welcome.
Finish by telling me to start a new session, then show how to use mstack: how to invoke it and the welcome's "You can" options (research needs no account; "set up mstack" only to trade).
```

## Copy for `mob.exchange/agent`

Title: Install the MoB funding-arbitrage agent stack

mstack is an open framework for finding delta-neutral funding trades: scans across 14 venues, rate history, and plain explanations, with no account. When you want to execute, one wallet session sets up a scoped MoB key with caps you choose.
Paste the prompt below into Claude Code, Codex, or another shell-capable agent.
The prompt names the exact install commands, so a permission classifier such as Claude Code's auto mode sees them as the user's own request; the agent then verifies the CLI and starts onboarding.

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
Install mstack, the open agent stack for delta-neutral funding trades, with MoB execution. I authorize exactly:
claude plugin marketplace add da-bao-jian/mstack && claude plugin install mstack@mstack
curl -fsSL https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.8/install.sh | sh
Then follow https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.8/docs/AGENT-INSTALL.md from Verify: `mob --version`, `mob doctor`,
run `mob` and reproduce its output verbatim in a fenced block as the welcome.
Finish by telling me to type /reload-plugins, then show how to use mstack: how to invoke it and the welcome's "You can" options (research needs no account; "set up mstack" only to trade).
```

Custody: Your wallet key stays in your own wallet or in mstack's encrypted local keystore; the agent never sees it. The scoped MoB API key cannot withdraw and stays subject to its venue and USD caps. Your funds stay in your own venue accounts. Revoke the API key on the MoB API page at any time.
