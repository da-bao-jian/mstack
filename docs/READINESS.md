# v0.3.0 readiness

The automated checks cover public reads, local staging, and signing against test
wallets and fake servers. Public launch still needs the human checklist below.
The [W17 report](reports/W17.md) records the security review and exact checks.

## Hosts

| Host | Available workflow | Proven against |
|---|---|---|
| Claude Code plugin | Guided reads and staging; explicit-id browser signing guard | Live venue reads in onboarding QA; fake Mobius server and fake venue; real `claude -p` transcript regression |
| Codex skills | Generated guidance through the same CLI; human approval per id | Fake Mobius server / fake venue; clean-home installation and preamble tests |
| MCP in any compatible client | Public reads and `propose_*`; no signing, rejection, or config writes | Fake Mobius server / fake venue over stdio; protocol tests, not every client UI |
| Plain CLI | Public reads, staging, manual signing and diagnostics | Live venue reads; fake Mobius server / fake venue; human only for live execution |

## Commands

“Fake venue” includes recorded public responses and scripted test wallets.
Live-read evidence comes from the recorded W1/W3 checks and onboarding QA.
It does not prove that a live order has executed.

| Command or skill | Proven against | Limit |
|---|---|---|
| `scan` | Live venue reads / fake venue | Current funding is simply annualized; quotes are not promised returns |
| `rates` | Live venue reads / fake venue | Native market names are retained |
| `history` | Live venue reads / fake venue | Coverage and unsupported venues are explicit |
| `explain` | Fake venue examples; local knowledge tests | No wallet or network is needed for the knowledge text |
| `setup` | Fake Mobius server / fake venue | Live legal acceptance: human only |
| `bind` | Fake Mobius server / fake venue | Live venue binding: human only |
| `open` | Fake Mobius server / fake venue | Live order: human only; missing readiness stops the skill before risk questions |
| `status` | Fake Mobius server; public-read QA | Submission and confirmed execution are separate states |
| `/mob-manage` | Fake Mobius server / fake venue | CLI: `resize`, `neutralize`, `protect`, `auto-close`, `size-mismatch-close` |
| `close` | Fake Mobius server / fake venue | Live close and flat balances: human only |
| `proposals` / `proposal show` | Fake Mobius server; local corruption and lifecycle tests | Audit signatures are omitted from output |
| `sign` | Fake Mobius server / fake venue | Browser and mock WalletConnect approval; test keystore reader; live signatures: human only |
| `reject` | Local state tests with fake Mobius Proposals | No remote request |
| `doctor` | Fake Mobius server / fake venue | Public settings and readiness only; never unlocks a wallet |
| `upgrade` | Local Git repositories / fake release downloads | Public-release installation: human only; hashes checked before replacement |

## What automation has not done

- A live legal acceptance.
- A live binding or approval of a real venue key.
- A live order, resize, protection change, or close with real funds.
- WalletConnect pairing and signing against a real relay and wallet.
- Installation of the announced public v0.3.0 release on a clean human machine.

## Gaps carried forward

- The upstream worker has no trim budget. Protection does not guarantee that
  liquidation cannot happen.
- There are no push notifications or background position monitoring.
- Cross-deployment Lighter pairs are informational only. The flag
  `--include-cross-deployment` reveals them; it does not make them executable.
- Thin pairs do not carry an executable command, including with `--include-thin`.
- Session grants, a hosted MCP server, and Ledger remain future work.
- Public reads expose task and binding information by owner address.
- WalletConnect uses the Community License. Optional loading does not remove
  the obligations of distributing a binary that includes the SDK.

## Human checklist before announcing

1. Run [LIVE-TEST.md](LIVE-TEST.md) once with **$50 per leg**. Use v0.3.0 and the
   actual Proposal ids printed in that run. Check both venues are flat at the end.
2. Decide the [WalletConnect license question](licenses/walletconnect-2.25.0.md)
   before distributing the bundled SDK.
3. Move `docs/PRD.md` §5 out of the repository before making it public. Decide
   whether the public Git history also needs cleanup. W17 does not edit the PRD.
4. Review and commit the release-ready tree. Create the local `v0.3.0` tag with
   `bun scripts/release.ts 0.3.0`. Tag publication and release publication are
   separate, human-authorized actions. W17 creates no tag and pushes nothing.
5. After the repository and release are public, use a clean machine and run:

   ```sh
   claude plugin marketplace add da-bao-jian/mstack
   claude plugin install mstack@mstack
   ```

   Check `mob --version`, run a public scan, and verify the preamble reports
   `UPGRADE_CHECK: ok` without credentials. Complete the browser approval flow
   with the human present. Record the results before announcing.
