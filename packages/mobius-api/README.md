# @mstack/mobius-api

Typed client for MoB Strategy API 1.2.0. It covers delta-neutral tasks,
request logs, and batch venue binding. Perpetual-order routes are out of scope
for W18.

Every call identifies `mstack/<version>` and rejects redirects. Authenticated
task calls use the configured bearer. Binding calls use the exact wallet
authorization supplied by the caller. Every POST needs a caller-owned
`Idempotency-Key`; the client never retries a mutation.

HTTP 202 means **accepted, not executed**. Poll the task or binding route for
worker state. Decimal money and quantity fields in responses remain strings.

The client redacts complete MoB keys from every error. It never logs the
key. API key storage belongs to `@mstack/keys` in W19.

The package vendors `src/openapi-1.2.0.json` from MoB commit `0e3ff530` and
pins its SHA-256 in tests. Test traffic uses only the loopback fake server.
