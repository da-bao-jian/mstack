# @mstack/mobius-client

Typed funding-server reads and writes for arbitrage and binding. `MobiusClient.read(route, params)` and `write(route, body)` use the types exported in `ReadRoutes` and `WriteRoutes`. The client preserves bodies, sets the mstack client headers, rejects redirects, and reports malformed responses. Readiness failures retain the full server response in `ApiError.data` and the error message.

All client instances in a process share a per-host pacer with at least 500 ms between request starts. Reads have a 30-second deadline. Writes do not retry; callers may supply a deadline. A transport failure after sending a write is ambiguous and must not trigger resubmission.

The four frontend message builders retain their upstream test cases. Close, neutralize, and auto-close use the strings in `ManageView.tsx`. `stageOpenBody` records a random UUID nonce, unix-second timestamp, caller-supplied venue marks, and a default zero minimum APY. It omits unset options. Venue leverage/margin verification belongs to W10, so this staging helper rejects those options.

The existing CLI status reader and response validation now live here; the CLI retains display formatting. Binding `status` reads can finalize credentials. Proposal preflights therefore use `credential` and `rebind-check`, never binding `status`.

The vendored reference has no complex-order request schema. Those PRD routes are marked P3 and remain an open scope question for Fable; no request shape was invented.

Run `bun run check`, `bun run lint`, and `bun test`. Tests use local fixtures and injected fetches.
