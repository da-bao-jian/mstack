# Close semantics

The close request is replayable inside the server's 300-second window because
the route has no nonce. The local Proposal expires after 300 seconds and can be
signed once. A failed preflight stages nothing.

Submission acknowledges the request, not completed execution. Show the server's
answer and use a later status read to establish what happened to the position.
Do not replace a failed read with a remembered state.
