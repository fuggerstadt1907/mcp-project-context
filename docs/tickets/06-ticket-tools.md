# 06 Ticket tools and resource

Labels: feature

## Goal

The agent can find the ticket it works on and read its acceptance criteria.

## Scope

- `src/sources/tickets.ts`: read `<ticketsDir>/*.md` with YAML frontmatter
  (`id`, `title`, `status`, `labels`). Body: description; checklist items under
  `## Acceptance criteria` become `acceptanceCriteria: { text, done }[]`.
- Id: the frontmatter `id` (requirements decision 1). On mismatch with the filename prefix the
  frontmatter wins and a warning is logged. Duplicate ids: first by relative path wins, warning
  names both files.
- Tool `list_tickets` — input `{ status?: string, label?: string }`. Filters match
  case-insensitively and exactly (FR-11). Skipped files are counted in the text content (FR-15).
- Tool `get_ticket` — input `{ id: string }`, output incl. `acceptanceCriteria`.
- Resource template `ticket://{id}`.
- Parse frontmatter with our own parser, no YAML dependency. The subset is defined in
  `docs/requirements.md` (Data & schema): `key: value` lines with plain, double- or single-quoted
  strings, and inline arrays whose items are plain or quoted. Block lists, nesting and multi-line
  values are outside the subset. `id` is required; `title`/`status` default to `""`, `labels` to
  `[]`; unknown keys are ignored.

## Acceptance criteria

- [ ] Filters combine (status AND label); `status: "TODO", label: "api"` returns only T-003.
- [ ] A ticket without frontmatter, without `id`, or with frontmatter outside the subset is
      skipped and logged as a warning, not a crash.
- [ ] All four demo tickets parse without warnings.
- [ ] Tests for filename/id mismatch and duplicate ids.
- [ ] Parser tests: quoted values with `:` and `,`, `[]`, a block list (skipped).
- [ ] Personal data in the demo tickets (email, phone) comes back redacted.
- [ ] Tests via `InMemoryTransport` + `Client`.
