# W28 security audit — secrets, signing, agent boundary

Audit of branch `audit-w28` after the W28 audit fixes, 2026-10-19. Three independent reviews,
each briefed on the security boundaries in `AGENTS.md` and `SECURITY.md`: secrets and key
custody, the signing path (binding requests, approver, browser bridge), and the agent
boundary (sign guard, config, release downloads). Each reviewer reproduced its findings with
probes against the built binary or local fake servers. Every confirmed finding is fixed on
this branch with a regression test; two design items need the maintainer and are listed at
the end. A manual first-user QA run of the paste prompt found the onboarding items.

## High

| Finding | Fix | Commit |
|---|---|---|
| Server-prepared binding requests were signed as received. A hostile or compromised API could ask the wallet to approve any typed data or message inside an onboarding ceremony. | `classifySignRequest` accepts only the exact request each venue uses: domain, chain, types, every message field, the owner, `CanWithdraw false`, fee caps, and a venue the owner asked to bind. Stored requests are checked again on load; the ceremony fingerprint covers them; each step names what it allows. | `3e789df` |
| The agent could switch the policy to `auto`, point the API bases elsewhere, or change the key store with `mob config set`. | These keys need the human's terminal and a typed `yes` from `/dev/tty`; the hook also denies them, `setup --policy`, `onboard --app-base`, and `mob upgrade`. | `8abd330` |
| The hook counted task notifications, compact summaries, and command output in the transcript as the user's message. | Consent comes only from events Claude Code marks as human-typed. | `8abd330` |
| The hook accepted any AskUserQuestion answer text, including a spoofed `"q"="a"` string. | The chosen label must exactly equal a label the assistant offered, starting with `Sign <id>` or `Submit <id>`. | `8abd330` |

## Other fixes

| Area | Finding | Fix | Commit |
|---|---|---|---|
| Onboarding | A new user's first `mob sign c-N` failed: no signer was saved. | Each signing choice runs an explicit `--with`; the CLI names the choices. | `28933ac` |
| Key storage | The Keychain entry was shared by every `MOB_HOME` for one owner. | Per-home service names; `~/.mob` keeps the original name; migration by key id. | `28933ac`, `31297e4` |
| Signing | The approver read the card and its pin in two reads. | One read gives both. | `3e789df` |
| Signing | The browser ceremony waited forever for the wallet account. | The account is accepted before the first step. | `3e789df` |
| Signing | The signing link worked more than once; malformed JSON returned Bun's development page. | One-time link, then an `HttpOnly; SameSite=Strict` cookie; 400 for bad JSON. | `3e789df` |
| Secrets | Error excerpts were cut before redaction and could end in a key fragment. | Redact first; never echo a key-create answer. | `31297e4` |
| Secrets | The Keychain write put the key on the `security` argv. | `security -i` on stdin, then read back. | `31297e4` |
| Secrets | The stored key could be sent to any configured base, including plain HTTP. | The key goes only to the base it was verified against; HTTPS or loopback HTTP only. | `31297e4` |
| Secrets | Keystore KDF was weak for a long-lived file. | Version 2: scrypt N=2^17, r=8, p=1, parameters in the AAD; 12-character minimum. | `31297e4` |
| Secrets | Grant agent key files were written non-atomically. | Private-file helpers: 0700 directory, 0600 file, exclusive create, atomic rename. | `31297e4` |
| Boundary | Indirection (`eval`, `sh -c`, decoded scripts, copied binaries) bypassed the hook. | Denied next to mob; mob paths recognized; consent needs the verb right before the id. | `8abd330` |
| Boundary | `mob submit` sent the stored body without checking it again. | Submit reruns the preflight, checks the body against the evidence, and prints the request. | `8abd330` |
| Release | Downloads allowed HTTP and HTTP redirects; Actions used mutable tags. | HTTPS-only (loopback HTTP for tests), pinned TLS; Actions pinned to SHAs. | `8abd330` |
| Tests | `bun run test` and CI never ran `apps/cli/test`; four CLI expectations had drifted. | The root script runs both suites. | `84cad27` |
| Onboarding | The wallet address in the paste prompt was lost at the restart; the setup skill told the agent to run a bare `mob sign c-N`; install text was stale. | The install guide saves the address; the skill runs the chosen command; text refreshed. | `a5aacff` |

The boundary reviewer's first hook change denied every Bash command containing "sign" or
"submit" in any project. The hook now acts only when mob is involved or the verb is followed
by a Proposal id, so `git commit -m 'sign …'` and `grep submit` pass.

## Verification

| Command | Result |
|---|---|
| `bun run gen:skills` | No drift. |
| `bun run check`, `bun run lint`, `bun run deadcode` | Passed (one pre-existing lint info). |
| `bun run test` | `packages/`: 1,207 passed, 0 failed. `apps/cli`: 263 passed, 0 failed. |
| `bun run build` | Passed. |
| `claude plugin validate --strict .` and `.claude-plugin/plugin.json` | Passed. |
| `MOB_EVAL=1 bun run eval:skills` | 6 of 6 (before `a5aacff`; descriptions unchanged since). |
| Lab install | The served `install.sh` downloaded the branch build, verified SHA-256, and `mob config set owner` saved the address. |

Live API check, read-only: `api.mob.exchange` serves 1.2.0 with `/v1/venue-bindings/*`;
`funding.mob.exchange` answers binding readiness and validates `/api/keys/create`.

## Open, for the maintainer

1. **Same-user tampering under manual policy.** The agent runs as the human's OS user and can
   edit the transcript or a staged Proposal. Submit now catches edits that leave the stored
   evidence inconsistent; a careful edit still passes. A hard fix needs a human `y` in the
   approver or a terminal for each manual submit. Documented in `SECURITY.md`.
2. **Release signing.** Releases carry SHA-256 sums from the same origin as the binaries. A
   real fix needs a maintainer key (minisign, cosign, or GitHub attestations).

Also open: `mob onboard --app-base` is blocked only by the hook; a script written with the
Write tool and run with `bash` is outside the hook (not a sandbox); the grant agent key is a
file, not the keychain; desktop or SDK sessions without a human-origin marker get no typed
consent, but AskUserQuestion answers still work.
