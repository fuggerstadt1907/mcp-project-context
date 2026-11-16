# 05 ADR tools and resource

Labels: feature

## Goal

The agent can find and read architecture decisions.

## Scope

- `src/sources/adr.ts`: read `<adrDir>/NNNN-slug.md`. Parse title (first `#` heading, strip the
  `NNNN:` prefix), `Status` and `Date` from the bullet list, and the sections Context, Decision,
  Consequences. Ignore `drafts/`.
- Tool `list_adrs` — input `{ status?: string }`, output
  `{ adrs: { id, title, status, date }[] }`, sorted by id. The status filter matches
  case-insensitively and exactly (FR-11).
- Files skipped while listing (too large, unreadable) are left out; the text content states how
  many and why, and a warning goes to stderr (FR-15).
- Tool `get_adr` — input `{ id: string }` (accept `"3"` and `"0003"`), output
  `{ id, title, status, date, context, decision, consequences }`.
- Resource template `adr://{id}` returning the raw (redacted) markdown, with a `list` callback.
- Tool descriptions written for an agent: say when to use the tool, with an example id.

## Acceptance criteria

- [ ] Works on `examples/demo-project`.
- [ ] Unknown id returns a tool error listing the available ids.
- [ ] A malformed ADR is still listed (requirements decision 4): title from the first heading or
      the filename slug, status `Unknown` when there is no `Status` bullet, missing sections empty.
      If no section is found, the whole body goes into `context`. Demo 0004 returns title
      "Notes from the old wiki", status `Unknown`, body in `context`.
- [ ] `list_adrs({ status: "accepted" })` returns 0001 and 0002 on the demo project.
- [ ] `get_adr` on the id of a skipped file returns a tool error with the reason.
- [ ] Both tools have `readOnlyHint: true` and an `outputSchema`.
- [ ] Tests via `InMemoryTransport` + `Client`.
