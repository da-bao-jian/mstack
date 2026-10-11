## Change

Describe the problem, resulting behavior, and assigned package or issue.

## Verification

- [ ] `bun run gen:skills`; generated outputs committed when changed
- [ ] `bun run check`
- [ ] `bun run lint` (zero warnings)
- [ ] `bun test` (fixtures or local fake servers only)
- [ ] `bun run deadcode`
- [ ] `bun run build` when build or runtime code changed
- [ ] Both `claude plugin validate --strict` targets when plugin or skills changed
- [ ] Relevant adapter contracts and upstream byte-exact parity remain green
- [ ] No secrets, compiled binaries, signing shortcuts, or stale-data fallbacks
- [ ] Dependencies, limits, and exact check results recorded in the package report

## Limits

List remaining risks, unverified live behavior, and deliberate omissions.
