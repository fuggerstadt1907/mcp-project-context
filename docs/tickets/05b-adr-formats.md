# 05b ADR format variants

Labels: feature

## Goal

ADRs written in the common formats are read correctly, not only the demo template. Today an
adr-tools (Nygard) or MADR 3 ADR is listed with status `Unknown` (requirements decision 65).

## Scope

- `src/sources/adr.ts`: read the status from any of three places:
  - a `- Status: Accepted` bullet before the first section (current behaviour),
  - a `## Status` section (Nygard / adr-tools), for example:

    ```markdown
    # 1. Record architecture decisions

    Date: 2026-01-01

    ## Status

    Accepted
    ```

  - frontmatter `status:` (MADR 3), parsed with the frontmatter subset from ticket 06:

    ```markdown
    ---
    status: accepted
    date: 2026-01-01
    ---
    # Use Postgres
    ```

- Read the date from the same places: `- Date:` bullet, a plain `Date:` line before the first
  section (Nygard), frontmatter `date:` (MADR).
- Title: strip a `1.` prefix (Nygard) as well as the `NNNN:` prefix.
- A `## Status` section and the frontmatter block do not end up in `context` when no other section
  is found.
- Fixtures for each format are written to a temp dir in the tests. The demo project stays as it is.
- Out of scope: mapping MADR section names (`Context and Problem Statement`, `Decision Outcome`)
  to `context`/`decision`/`consequences`. Decide that during grilling if it is wanted.

## Open questions (resolve before implementing)

- Precedence when a file has more than one status source (proposal: frontmatter, then bullet,
  then `## Status` section).
- Nygard status lines like `Superseded by [2. Use X](0002-use-x.md)`: return the whole line or
  only the first word? The status filter matches exactly (FR-11).
- Frontmatter outside the subset: fall back to the other sources with a warning, or treat the ADR
  as malformed?

## Acceptance criteria

- [ ] A bullet-style ADR (`- Status: Accepted`) still returns `Accepted` (no regression on the demo).
- [ ] A Nygard ADR (`# 1. Record …`, `Date:` line, `## Status` section with `Accepted`) returns
      title `Record …`, status `Accepted` and the date.
- [ ] A MADR 3 ADR with frontmatter `status: accepted` returns status `accepted`, the frontmatter
      date, and no frontmatter in any field.
- [ ] `list_adrs({ status: "accepted" })` finds ADRs of all three formats.
- [ ] No template warning for any of the three formats when all their parts are present.
- [ ] Tests via `InMemoryTransport` + `Client`, one temp-dir fixture per format.
