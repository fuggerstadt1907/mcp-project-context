# CLAUDE.md

Instructions for coding agents working in this repository.

## What this is

An MCP server (stdio) that exposes a repository's ADRs, tickets and conventions to coding agents.
Read `docs/requirements.md` and `docs/architecture.md` before any change. Decisions live in `docs/adr/`.

## Workflow

1. Work one ticket at a time from `docs/tickets/` (or the matching GitHub issue).
2. Before writing code, list open questions and assumptions. Ask instead of guessing.
3. Write a short plan, then implement in small commits that each pass `pnpm check`.
4. Every new behavior gets a test. Security behavior (path guard, redaction, write flag) gets negative tests.
5. Open a PR that references the ticket. The PR description states what was tested and what was not.
6. At the end of every ticket or requirements session, draft the WORKLOG entry yourself. Leave "Time" as TODO. The human reviews and confirms it before commit.

## Hard rules

- **Never write to stdout.** stdout carries the MCP protocol. Log only via `src/log.ts` (stderr).
- **All file access goes through `src/fs/safe-fs.ts`.** No direct `fs` calls in tools or sources.
- **All text returned to the client goes through `redact()`** at the output boundary, never earlier.
- **Write tools are only registered when `--allow-write` is set.** Not registered means not listed.
- No network access in the default configuration.
- No new runtime dependency without an ADR.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the server against `examples/demo-project` |
| `pnpm check` | Lint, typecheck, test (run before every commit) |
| `pnpm build` | Bundle to `dist/cli.js` |

## Conventions

- TypeScript strict, ESM, Node 22. Formatting and lint: Biome.
- SDK: `@modelcontextprotocol/server` v2. Schemas with `zod/v4`.
- Tools return `content` (text) **and** `structuredContent` matching an `outputSchema`.
- Read-only tools set `annotations: { readOnlyHint: true }`.
- Errors the agent can act on are returned as `{ isError: true, content: [...] }` with a clear message,
  not thrown.
- File names: kebab-case. One tool per file in `src/tools/`.
