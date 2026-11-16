# 07 Conventions and search

Labels: feature

## Goal

The agent can read the team's rules and search across all project knowledge.

## Scope

- `src/sources/conventions.ts`: load `CONVENTIONS.md`, `CLAUDE.md`, `CONTRIBUTING.md` from root
  if they exist.
- Tool `get_conventions` — output `{ files: { path, content }[] }`.
- `src/search.ts` + tool `search_context` — input `{ query: string, kinds?: ('adr'|'ticket'|'convention')[], limit?: number (default 10, max 50) }`.
  Output `{ results: { kind, id, title, score, snippet }[] }`.
- Scoring: simple and explainable, e.g. term frequency with a bonus for title matches.
  Snippet: ~200 chars around the first match.

## Acceptance criteria

- [ ] Resolve open question 2 before coding.
- [ ] Query "authentication" on the demo project returns ADR 0002 first.
- [ ] Empty query returns a tool error.
- [ ] Snippets are redacted; the demo `CONVENTIONS.md` fake token never appears.
- [ ] Performance check: generate 500 markdown files in a temp dir, search answers in < 300 ms (NFR-7).
