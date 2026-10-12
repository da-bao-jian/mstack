# Sign-guard transcript provenance

`claude-p-round2.jsonl` is a trimmed transcript from the real round-2
`claude -p` session `082fbff5-fb79-41b1-acf3-11594256550a`.
It retains the human request, the read of the guard, its tool result, and the
next sign command. Thinking, attachments, IDs and unrelated events were removed.
The local checkout path was replaced with `/tmp/mstack-qa`.
Content block shapes, roles and the sidechain flag are preserved.
The old last-user-event rule selects the tool result and fails authorization.

`paste-import.jsonl` models the accepted onboarding turn. The user pastes a
scoped API key, and the agent pipes one single-quoted shell-builtin `printf`
value through `mob keys import --stdin`.
The hook does not treat key import as signing authority. The CLI itself refuses
a positional key.
