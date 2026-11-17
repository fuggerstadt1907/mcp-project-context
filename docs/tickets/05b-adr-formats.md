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
- Status values of the form `X by …` are cut to `X` (`Superseded by [2. Use X](…)` → `Superseded`).
- MADR sections: `## Context and Problem Statement` → context, `## Decision Outcome` → decision,
  `### Consequences` inside Decision Outcome → consequences.
- Frontmatter outside the subset: the ADR is still listed, the frontmatter is ignored, a warning
  names path, line and problem.

## Decisions

Resolved in grilling, recorded as requirements decisions 73–77 (FR-17 and the edge-case rows are
updated): source order frontmatter → bullet → `## Status` without a conflict warning (73), the
`X by …` cut (74), frontmatter outside the subset (75), MADR section mapping (76), parsing details
(77). README documentation of the formats moves to ticket 10. During implementation:
MADR consequences details and the case-sensitive `Date:` line (78), comment lines in frontmatter (79).

## Acceptance criteria

- [x] A bullet-style ADR (`- Status: Accepted`) still returns `Accepted` (no regression on the demo).
- [x] A Nygard ADR (`# 1. Record …`, `Date:` line, `## Status` section with `Accepted`) returns
      title `Record …`, status `Accepted` and the date.
- [x] A MADR 3 ADR with frontmatter `status: accepted` returns status `accepted`, the frontmatter
      date, and no frontmatter in any field.
- [x] `list_adrs({ status: "accepted" })` finds ADRs of all three formats.
- [x] No template warning for any of the three formats when all their parts are present.
- [x] A Nygard ADR with `Superseded by [2. Use X](0002-use-x.md)` returns status `Superseded` and
      is found by `list_adrs({ status: "superseded" })`.
- [x] A MADR ADR returns its `Context and Problem Statement` as context, `Decision Outcome` as
      decision without the `### Consequences` part, and that part as consequences.
- [x] An ADR with frontmatter outside the subset is listed, takes status and date from a bullet or
      `## Status` section, and logs a warning with line and problem but no content.
- [x] A `# 1.5 release` title is not stripped.
- [x] Tests via `InMemoryTransport` + `Client`, one temp-dir fixture per format.
