# Close semantics

With a matching stored key, close stages one idempotent Strategy API request.
The Proposal stores its idempotency key before the first send and can be
submitted once. Without a matching key, the wallet request remains replayable
inside the funding server's 300-second window. A failed preflight stages nothing.

Submission acknowledges the request, not completed execution. Show the server's
answer and use a later status read to establish what happened to the position.
Do not replace a failed read with a remembered state.
