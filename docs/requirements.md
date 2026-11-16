# Requirements: mcp-project-context

Version 0.1 · Owner: Alessandro Orlandi

## 1. Problem

Coding agents work best with project context: why the architecture looks the way it does,
what a ticket really asks for, which conventions the team follows. Today that context is either
missing (the agent guesses) or pasted manually into prompts (tedious, and it leaks whatever is in
those files, including secrets).

## 2. Goal

A local MCP server that lets a coding agent **look up project knowledge on its own**, without
being able to read outside the project, change files unintentionally, or receive secrets.

Success for v0.1:

- Claude Code can answer "Which ADR covers authentication, and what did we decide?" using only
  this server, on the demo project.
- Claude Code can implement a ticket from `tickets/` and cite its acceptance criteria.
- No test fixture secret ever appears in a tool or resource result.

## 3. Users

- **Primary:** a developer running Claude Code (or another MCP client) in their own repository.
- **Secondary:** a team lead who wants to roll the same setup out to a team and needs to trust it.

## 4. Scope

### In scope (v0.1)

- stdio transport, one project root per server process.
- Sources: ADR markdown files, local ticket markdown files with YAML frontmatter,
  convention files (`CONVENTIONS.md`, `CLAUDE.md`, `CONTRIBUTING.md`).
- Read tools, resources for ADRs and tickets, keyword search.
- One optional write tool: create an ADR draft.
- Redaction of secrets and personal data in every returned text.
- Audit logging to stderr.

### Out of scope (v0.1)

- HTTP transport, authentication, multi-user setups.
- Remote sources (GitHub Issues, Jira, Linear). GitHub Issues is a stretch ticket.
- Semantic or vector search.
- Editing or deleting existing files.

## 5. Functional requirements

| ID | Requirement |
| --- | --- |
| FR-1 | The server starts via CLI with a required `--root` and serves MCP over stdio. |
| FR-2 | `list_adrs` returns id, title, status and date for every ADR; optional status filter. |
| FR-3 | `get_adr` returns one ADR split into title, status, date, context, decision, consequences. |
| FR-4 | `list_tickets` returns id, title, status, labels; optional status and label filters. |
| FR-5 | `get_ticket` returns one ticket including description and acceptance criteria. |
| FR-6 | `get_conventions` returns the content of each convention file that exists. |
| FR-7 | `search_context` returns ranked matches with a short snippet and source reference. |
| FR-8 | ADRs and tickets are available as resources `adr://{id}` and `ticket://{id}`. |
| FR-9 | With `--allow-write`, `create_adr_draft` writes a new file to `<adr-dir>/drafts/` and never overwrites. |
| FR-10 | Unknown ids and invalid input return a tool error the agent can act on, not a crash. |

## 6. Non-functional requirements

| ID | Requirement |
| --- | --- |
| NFR-1 Security | No file outside `--root` is readable, including via `..`, absolute paths or symlinks. |
| NFR-2 Security | `.env*`, `.git/`, `node_modules/` and files over `--max-file-kb` are never read. |
| NFR-3 Privacy | Every text returned to the client passes through redaction. Masked as `[REDACTED:<type>]`. |
| NFR-4 Safety | Without `--allow-write`, no write tool is registered or listed. |
| NFR-5 Protocol | Nothing except protocol messages is written to stdout. |
| NFR-6 Observability | One structured audit line per tool call on stderr: tool, duration, result size, redaction count. No content. |
| NFR-7 Performance | Any tool answers in under 300 ms for a project with 500 markdown files. |
| NFR-8 Quality | `pnpm check` passes on every commit. Security rules have negative tests. |

## 7. Open questions

Resolve these before or during the matching ticket. Record answers here or in an ADR.

1. Ticket ids: from the file name (`T-012-login.md`) or from frontmatter `id`? What if both disagree?
2. Should `search_context` search ticket comments or only title and description?
3. Redaction of email addresses: always, or keep addresses on an allow-list (e.g. team domains)?
4. What happens when an ADR file does not follow the expected section headings?
5. Should the audit log optionally go to a file (`--audit-file`), and is that file then inside root?
6. ADR draft numbering: next free number in `drafts/` only, or across all ADRs?
