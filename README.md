# mcp-project-context

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
| `get_conventions` | Return CONVENTIONS.md, CONTRIBUTING.md, CLAUDE.md, AGENTS.md |
| `search_context` | Keyword search across all of the above, with snippets |
| `create_adr_draft` | Write a new ADR draft (only with `--allow-write`) |

ADRs and tickets are also exposed as resources: `adr://{id}`, `ticket://{id}`.

## Quickstart

Add the server to Claude Code from your project directory:

```bash
claude mcp add project-context -- npx -y mcp-project-context --root .
```

Requires Node 22 or later. Writing stays off until you add `--allow-write` yourself.

## Demo

Three commands start Claude Code on the bundled demo project, a fictional booking app with four
ADRs and four tickets:

```bash
git clone https://github.com/fuggerstadt1907/mcp-project-context
cd mcp-project-context/examples/demo-project
claude
```

The demo project ships a `.mcp.json`, so Claude Code offers to enable the server on start. Then ask:
_"Implement ticket T-003, check the relevant ADR first."_ The agent reads the ticket and its four
acceptance criteria, searches for the authentication ADR and reads ADR 0002 before writing code.

![Claude Code calling get_ticket, search_context and get_adr on the demo project](docs/assets/demo.gif)

Some fixtures in the demo project hold fake secrets and contact details. Ask the agent for ticket
T-002 or the conventions to see them come back as `[REDACTED:<type>]`.

## Configuration

| Flag | Default | Meaning |
| --- | --- | --- |
| `--root <dir>` | required | Project root. Nothing outside it is readable. |
| `--adr-dir <dir>` | `docs/adr` | Where ADRs live, relative to root |
| `--tickets-dir <dir>` | `tickets` | Where ticket markdown files live, searched recursively |
| `--max-file-kb <n>` | `256` | Larger files are refused |
| `--allow-write` | off | Registers `create_adr_draft` |

The server exits with code 2 on any invalid option: a missing or unknown flag, a root that is not
a directory, a bad `--max-file-kb`, or a source directory that resolves outside root.
A source directory that does not exist is fine: the matching list tool returns an empty list and
names the flag to set.

### Audit log

Every tool call and resource read that reaches the server's handlers writes one JSON line to
stderr, with no arguments, ids or file content ([ADR 0005](docs/adr/0005-audit-to-stderr-only.md)):

```json
{"time":"2026-11-19T08:19:07.109Z","level":"info","msg":"audit","event":"tool_call","tool":"get_ticket","ok":true,"ms":9,"bytes":990,"redactions":4}
```

Calls the MCP SDK rejects before that (invalid input, an unknown tool or resource scheme) get no
audit line. MCP clients capture a server's stderr; Claude Code keeps it in its MCP logs. The server
never writes a log file. To keep one, redirect stderr to a path outside the project:

```bash
claude mcp add project-context -- sh -c 'npx -y mcp-project-context --root . 2>>"$HOME/project-context.log"'
```

## File formats

### Tickets

Every `*.md` file under `--tickets-dir` is a ticket, except `README.md` files. A ticket starts with
frontmatter and lists its acceptance criteria as a checklist:

```markdown
---
id: T-003
title: Rate-limit magic link requests
status: todo
labels: [api, security]
---

Attackers can flood a user's inbox by requesting magic links repeatedly.

## Acceptance criteria

- [ ] Max 5 link requests per email per hour
- [x] Limits are configurable via environment variables
```

- `id` is required and may contain only `A-Z a-z 0-9 . _ -`. If it differs from the file name, the
  frontmatter wins. If two tickets share an id, the first by path wins. Both cases log a warning.
- The frontmatter is a strict subset of YAML, parsed without a YAML library. Each line is
  `key: value`, where the value is a plain string, a string in single or double quotes, or an
  inline list such as `[api, "a, b"]`. Blank lines and lines starting with `#` are allowed.
- Quote a value that contains `: ` or ` #`: `title: "Fix: login"`. Block lists (`- api` on the
  next line), nesting, multi-line values, comments after a value and duplicate keys are outside
  the subset. A ticket that uses them, has no frontmatter or no `id` is skipped with a
  warning on stderr.
- Status and label filters match exactly but ignore case: `todo` finds `TODO`, `progress` does not
  find `in-progress`.

### ADRs

ADRs are `NNNN-slug.md` files directly in `--adr-dir`. Three common formats are read:

| Format | Status and date | Sections |
| --- | --- | --- |
| Bullet (this repo, the demo) | `- Status: Accepted`, `- Date: 2026-04-14` | `## Context`, `## Decision`, `## Consequences` |
| Nygard / adr-tools | `## Status` section, `Date:` line | same |
| MADR 3 | frontmatter `status:` and `date:` | `## Context and Problem Statement`, `## Decision Outcome` with `### Consequences` |

- Status comes from the frontmatter, then the `- Status:` bullet, then the first line of the
  `## Status` section. Date comes from the frontmatter, then the `- Date:` bullet, then a `Date:`
  line. Bullets and the `Date:` line count only before the first `##` section.
- A status like `Superseded by [5. Use X](0005-use-x.md)` becomes `Superseded` (same for
  `Amended by …`), so the status filter finds it. The link itself is only visible through the `adr://` resource.
- A file that starts with a `---` line and has a later `---` line is read as frontmatter, even if
  the first `---` was meant as a horizontal rule.
- An ADR that follows none of these is still listed: the title comes from the first `#` heading
  or else the file name, the status is `Unknown` and the body below the title is returned as
  `context`.
- Drafts in `<adr-dir>/drafts/` are not listed or searched. `create_adr_draft` writes there and
  numbers the draft after the highest number in `<adr-dir>` and `drafts/`.

## How this was built

Requirements and tickets came first. Claude Code then implemented the tickets, one pull request
each, and every ticket went through the same loop: the agent listed its open questions before
writing code, a human answered them, the agent built the ticket with tests, and a fresh subagent
that had not written the code reviewed the diff against the ticket. Every decision went into the
decision log in [`docs/requirements.md`](docs/requirements.md), which each new session read
before it started.

The numbers, from [`docs/WORKLOG.md`](docs/WORKLOG.md):

| | |
| --- | --- |
| Time, from requirements to release | 8.75 h |
| Tickets | 11, each one pull request |
| Questions the agent asked before writing code | 60 |
| Mistakes caught in review before merging | 69 |
| Tests | 1,124 vitest tests, 94.9 % statement coverage |

An example from ticket 09: the end-to-end test collects every string the server returns in a
full session and checks that none of the four fake secrets from the demo project appears. It
passed from the start. The review found that one entry in its secret list had 26 zeros where the
fixture has 23, so the check for that full token could never fail and only a shorter fragment of
it was tested. A second test now first proves that every listed secret is in the fixtures. Since
then every "this never appears" test in the project comes with a check that the thing is there to
begin with.

Requirements: [`docs/requirements.md`](docs/requirements.md) ·
Architecture: [`docs/architecture.md`](docs/architecture.md) ·
Decisions: [`docs/adr/`](docs/adr) · Log: [`docs/WORKLOG.md`](docs/WORKLOG.md)

## Limitations

- **Redaction is pattern-based.** It catches the common formats listed in the
  [changelog](CHANGELOG.md), not every secret. Known misses: `sk_live_…` keys and AWS `ASIA…` keys
  (unless they follow a secret-looking key such as `api_key =`), `Bearer` or `Basic` credentials
  without a digit, a user name alone in a URL (`https://token@host` is masked as an email instead),
  and phone numbers in parentheses or without separators (`(0821) 123456`, `01701234567`). Some
  patterns mask too much on purpose, so they fail closed: `Token: see below`, `tokens: 100`, numbers
  with a leading zero such as `0042 1234`, and `git@github.com:…`.
- **Search is plain keyword matching**, case-insensitive, with a bonus for title hits. No stemming,
  no semantic search. Snippets keep the line breaks of the source.
- **stdio only.** No HTTP transport, no authentication, one project root per server process.
- **Local files only.** No GitHub Issues, Jira or Linear.
- **Two edge cases in the root check are documented, not caught.** A hard link inside root to a
  file outside it is read, because it is a regular file. A symlink swapped in between the check and
  the open is followed. Both need someone who can already write to the repository.
- **Drafts from two server processes can collide.** Calls within one server are serialised, but
  two servers with `--allow-write` on the same repository can give two drafts the same number.
  Neither overwrites the other. A failed write can leave an empty `drafts/` directory, or on a full
  disk a truncated draft.
- **No cache.** Every call reads from disk, so edits show up at once. A project with 500 markdown
  files answers in about 100 ms ([ADR 0004](docs/adr/0004-read-on-every-call.md)).

## Development

```bash
pnpm install
pnpm dev     # serves examples/demo-project over stdio
pnpm check   # lint, typecheck, tests
pnpm build   # bundles dist/cli.js
```

Agent instructions for this repository are in [`CLAUDE.md`](CLAUDE.md).

## License

MIT
