# 05 ADR tools and resource

Labels: feature

## Goal

The agent can find and read architecture decisions.

## Scope

- `src/sources/adr.ts`: read `<adrDir>/NNNN-slug.md`. Parse title (first `#` heading, strip the
  `NNNN:` prefix), `Status` and `Date` from the bullet list, and the sections Context, Decision,
  Consequences. Ignore `drafts/`.
- Tool `list_adrs` — input `{ status?: string }`, output
  `{ adrs: { id, title, status, date }[] }`, sorted by id.
- Tool `get_adr` — input `{ id: string }` (accept `"3"` and `"0003"`), output
  `{ id, title, status, date, context, decision, consequences }`.
- Resource template `adr://{id}` returning the raw (redacted) markdown, with a `list` callback.
- Tool descriptions written for an agent: say when to use the tool, with an example id.

## Acceptance criteria

- [ ] Works on `examples/demo-project`.
- [ ] Unknown id returns a tool error listing the available ids.
- [ ] A malformed ADR (missing sections) is still listed; missing fields are empty strings.
      Resolve open question 4 first.
- [ ] Both tools have `readOnlyHint: true` and an `outputSchema`.
- [ ] Tests via `InMemoryTransport` + `Client`.
