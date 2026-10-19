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

The other fixtures are synthetic. Their event shapes follow Claude Code 2.1.303
transcripts: a typed human message carries `origin.kind: "human"` and
`promptSource: "typed"`; a background-task notification carries
`origin.kind: "task-notification"`; a compaction summary carries
`isCompactSummary`; an AskUserQuestion result carries `toolUseResult.answers`.
No conversation text was copied. Files without any `origin` or `promptSource`
model older transcripts, where plain untagged user text counts as human.

- `consent-p2.jsonl` and `ask-genuine.jsonl` authorize p-2.
- `task-notification.jsonl`, `compact-summary.jsonl`, `local-stdout.jsonl`, and
  `forged-unmarked.jsonl` put "submit p-2" in non-human events.
- `ask-injected-question.jsonl` and `ask-injected-preview.jsonl` put a fake
  `"…"="Submit p-2"` pair in assistant-written question or preview text.
- `steer.jsonl` merges a "stop" message into a tool result after consent.
- `negation.jsonl` names p-2 only in a question and a negated request.
