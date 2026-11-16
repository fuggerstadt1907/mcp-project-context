# 09 Integration tests and stdio smoke test

Labels: quality

## Goal

Prove the whole server works end to end, the way an agent will use it.

## Scope

- `test/e2e.test.ts`: one client session against `examples/demo-project` that lists tools,
  searches, reads an ADR, reads a ticket, lists resources, reads `adr://0002`.
- `test/stdio.test.ts`: build, spawn `node dist/cli.js --root examples/demo-project`, send an
  initialize request over stdin, assert a valid response on stdout and only JSON lines on stderr.
- Leak test: collect every string returned in the e2e session and assert that none of the demo
  fixture secrets appear (list them in one constant).

## Acceptance criteria

- [ ] All three tests run in CI.
- [ ] Coverage report shows ≥ 85 % for `src/fs`, `src/redact.ts`, `src/tools`.
- [ ] Record the coverage number in `docs/WORKLOG.md`.
