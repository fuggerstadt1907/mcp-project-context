# 06 Ticket tools and resource

Labels: feature

## Goal

The agent can find the ticket it works on and read its acceptance criteria.

## Scope

- `src/sources/tickets.ts`: read `<ticketsDir>/*.md` with YAML frontmatter
  (`id`, `title`, `status`, `labels`). Body: description; checklist items under
  `## Acceptance criteria` become `acceptanceCriteria: { text, done }[]`.
- Tool `list_tickets` — input `{ status?: string, label?: string }`.
- Tool `get_ticket` — input `{ id: string }`, output incl. `acceptanceCriteria`.
- Resource template `ticket://{id}`.
- Parse frontmatter without adding a YAML dependency if the subset is small; otherwise write an ADR
  for the dependency (see CLAUDE.md).

## Acceptance criteria

- [ ] Resolve open question 1 (id from file name vs frontmatter) before coding.
- [ ] Filters combine (status AND label).
- [ ] A ticket without frontmatter is skipped and logged as a warning, not a crash.
- [ ] Personal data in the demo tickets (email, phone) comes back redacted.
- [ ] Tests via `InMemoryTransport` + `Client`.
