# 04 Result helper and audit log

Labels: foundation, observability

## Goal

Every tool returns results the same way: redacted, with structured content, and audited.

## Scope

`src/tools/result.ts`:

- `ok(structured, text)` → `{ content: [{ type: 'text', text }], structuredContent }`,
  with `redact()` applied to `text` and to every string inside `structured`.
- `fail(message)` → `{ isError: true, content: [{ type: 'text', text: message }] }`, message redacted.
- `withAudit(toolName, handler)` wraps a handler: measures duration, turns a `SafeFsError` into
  `fail` with its message and any other exception into a generic tool error, writes one audit
  line. A result not built with `ok()` or `fail()` becomes a tool error (decisions 51–53).

Audit line (stderr, JSON): `{ "event": "tool_call", "tool", "ok", "ms", "bytes", "redactions" }`.
No arguments, no content.

Resource handlers get the same treatment: `withResourceAudit(scheme, read)` redacts resource
contents and writes `{ "event": "resource_read", "scheme", "ok", "ms", "bytes", "redactions" }`.
Only the URI scheme
(`adr`, `ticket`), never the id (requirements NFR-6, ADR 0005).

## Acceptance criteria

- [x] Test: a structured result with a fake GitHub token in a nested field comes back masked in
      both `content` and `structuredContent`.
- [x] Test: a `SafeFsError('outside_root')` becomes a tool error, not an exception.
- [x] Test: the audit line contains no input values (capture stderr in the test).
- [x] Test: a resource read writes one `resource_read` line without the id.
- [x] No `--audit-file` option; audit goes to stderr only (ADR 0005).
