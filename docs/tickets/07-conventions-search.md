# 07 Conventions and search

Labels: feature

## Goal

The agent can read the team's rules and search across all project knowledge.

## Scope

- `src/sources/conventions.ts`: load `CONVENTIONS.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `AGENTS.md`
  from root in that fixed order: team rules first, agent-specific rules after (requirements
  decisions 18 and 21). Missing files are skipped.
- Tool `get_conventions` — output `{ files: { path, content }[] }`.
- `src/search.ts` + tool `search_context` — input `{ query: string, kinds?: ('adr'|'ticket'|'convention')[], limit?: number (default 10, max 50) }`.
  Output `{ results: { kind, id, title, score, snippet }[] }`.
- Scoring: simple and explainable, e.g. term frequency with a bonus for title matches.
  Snippet: ~200 chars around the first match.
- Tickets are searched as a whole: title, labels, description and acceptance criteria
  (requirements decision 2). ADR drafts are not searched.
- No cache: every call reads from disk (ADR 0004).

## Decisions

Recorded as requirements decisions 80–86: snippets never cut a secret and keep line breaks
(80), overlapping matches are merged in `redact()` (81), text content (82), search
details (83), convention files (84), running the performance test on its own (85), the overlap invariant
for `redact()` (86).

## Acceptance criteria

- [x] `get_conventions` on a root with `AGENTS.md`, `CLAUDE.md` and `CONVENTIONS.md` (no
      `CONTRIBUTING.md`) returns `CONVENTIONS.md`, `CLAUDE.md`, `AGENTS.md` in that order.
- [x] A ticket matching only in an acceptance criterion (e.g. "429") is found.
- [x] Query "authentication" on the demo project returns ADR 0002 first.
- [x] Empty query returns a tool error.
- [x] Snippets are redacted; the demo `CONVENTIONS.md` fake token never appears.
- [x] Performance check: generate 500 markdown files in a temp dir, search answers in < 300 ms (NFR-7).
      If it fails, propose a cache in a new ADR that supersedes ADR 0004.
