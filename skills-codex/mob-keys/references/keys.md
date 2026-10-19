# Key safety and actions

The MoB API key can open, cancel, close, and resize positions only for its
venue scope and USD cap per leg. It cannot withdraw, bind venues, approve fees,
accept legal terms, or create another key. It has no expiry. Revoke it on the
MoB API page or with the signed `mob keys revoke <uuid>` flow.

The chat paste is stored in the chat transcript and local agent session logs.
After import, the CLI prints only the `mobius_<uuid>…` prefix. A local delete
does not revoke the server key. A server revoke is the action that ends it.

`MOBIUS_API_KEY` is a read-only runtime override. Never use it as an import
source. Never pass a key as argv. The direct human import reads from `/dev/tty`.
If verification cannot reach the Strategy API, stop without storing the key.
Use `--unverified` only after the user explicitly requests it.
