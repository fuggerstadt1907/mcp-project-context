# 04 Result helper and audit log

Labels: foundation, observability

## Goal

Every tool returns results the same way: redacted, with structured content, and audited.

## Scope

`src/tools/result.ts`:

- `ok(toolName, structured, text)` → `{ content: [{ type: 'text', text }], structuredContent }`,
  with `redact()` applied to `text` and to every string inside `structured`.
- `fail(toolName, message)` → `{ isError: true, content: [{ type: 'text', text: message }] }`.
- `withAudit(toolName, handler)` wraps a handler: measures duration, catches `SafeFsError` and
  turns it into `fail` with a helpful message, writes one audit line.

Audit line (stderr, JSON): `{ "event": "tool_call", "tool", "ok", "ms", "bytes", "redactions" }`.
No arguments, no content.

## Acceptance criteria

- [ ] Test: a structured result with a fake GitHub token in a nested field comes back masked in
      both `content` and `structuredContent`.
- [ ] Test: a `SafeFsError('outside_root')` becomes a tool error, not an exception.
- [ ] Test: the audit line contains no input values (capture stderr in the test).
- [ ] Decide open question 5 (`--audit-file`) and record it.
