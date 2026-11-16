# 0005: Audit log on stderr only

- Status: Accepted
- Date: 2026-11-16

## Context

NFR-6 requires one audit line per tool call. An `--audit-file` option was considered so a team
lead could keep the log. A file needs a second write path next to `create_adr_draft`. If the file
sits inside root, the agent might read it back, and the server would have to decide where it may
live. MCP clients already capture a server's stderr (Claude Code writes it to its MCP logs), and
shell redirection covers anyone who wants a file.

## Decision

Audit lines go to stderr only, through `src/log.ts`. There is no `--audit-file` option. Resource
reads get an audit line too, with `event: "resource_read"` and the URI scheme, never the id.

## Consequences

- The only file the server can write is an ADR draft behind `--allow-write`.
- Keeping the log is the client's or the shell's job. The README says how.
- Adding a file sink later needs a new ADR that covers its location and permissions.
