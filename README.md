# mcp-project-context

> Status: work in progress. Built ticket by ticket with an agentic workflow, see [How this was built](#how-this-was-built).

An [MCP](https://modelcontextprotocol.io) server that gives coding agents such as Claude Code
**safe, read-only access to a repository's project knowledge**: architecture decision records (ADRs),
tickets and team conventions.

## Why

Coding agents guess when they lack context. They re-open settled decisions, ignore conventions
and miss acceptance criteria. Pasting docs into every prompt is tedious and leaks whatever happens
to be in them.

This server lets the agent look things up itself, with guardrails:

- **Read-only by default.** Write tools exist only when explicitly enabled.
- **Stays inside the project root.** Path traversal and symlink escapes are blocked.
- **Redacts before it returns.** Secrets and personal data are masked at the output boundary.
- **Logs to stderr only**, with an audit line per call and no file contents.

## Tools

| Tool | What it does |
| --- | --- |
| `list_adrs` | List ADRs, optionally filtered by status |
| `get_adr` | Read one ADR as structured sections |
| `list_tickets` | List local tickets, filter by status or label |
| `get_ticket` | Read one ticket with its acceptance criteria |
| `get_conventions` | Return CONVENTIONS.md, CLAUDE.md, CONTRIBUTING.md |
| `search_context` | Keyword search across all of the above, with snippets |
| `create_adr_draft` | Write a new ADR draft (only with `--allow-write`) |

ADRs and tickets are also exposed as resources: `adr://{id}`, `ticket://{id}`.

## Quickstart

```bash
pnpm install
pnpm dev   # serves examples/demo-project over stdio
```

Use it in Claude Code (from your project directory):

```bash
claude mcp add project-context -- npx mcp-project-context --root .
```

## Configuration

| Flag | Default | Meaning |
| --- | --- | --- |
| `--root <dir>` | required | Project root. Nothing outside it is readable. |
| `--adr-dir <dir>` | `docs/adr` | Where ADRs live, relative to root |
| `--tickets-dir <dir>` | `tickets` | Where ticket markdown files live |
| `--max-file-kb <n>` | `256` | Larger files are refused |
| `--allow-write` | off | Registers `create_adr_draft` |

## Demo

_TODO (ticket 10): GIF of Claude Code using the server on the demo project._

## How this was built

_TODO (ticket 10): Short summary of the workflow and numbers from `docs/WORKLOG.md`:
total time, number of tickets, questions the agent asked, mistakes caught in review._

Requirements: [`docs/requirements.md`](docs/requirements.md) ·
Architecture: [`docs/architecture.md`](docs/architecture.md) ·
Decisions: [`docs/adr/`](docs/adr) · Log: [`docs/WORKLOG.md`](docs/WORKLOG.md)

## Limitations

_TODO: be honest here. For example: redaction is pattern-based and will miss some secrets;
search is keyword-based, not semantic._

## License

MIT
