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

Resource handlers get the same treatment: a helper that redacts resource contents and writes
`{ "event": "resource_read", "scheme", "ok", "ms", "bytes", "redactions" }`. Only the URI scheme
(`adr`, `ticket`), never the id (requirements NFR-6, ADR 0005).

## Acceptance criteria

- [ ] Test: a structured result with a fake GitHub token in a nested field comes back masked in
      both `content` and `structuredContent`.
- [ ] Test: a `SafeFsError('outside_root')` becomes a tool error, not an exception.
- [ ] Test: the audit line contains no input values (capture stderr in the test).
- [ ] Test: a resource read writes one `resource_read` line without the id.
- [ ] No `--audit-file` option; audit goes to stderr only (ADR 0005).
