# Requirements: mcp-project-context

> Status: ready · Ticket: docs/requirements.md (v0.1 draft) · Stand: 2026-11-17

Version 0.2 · Owner: Alessandro Orlandi

## Summary

A local MCP server over stdio that lets a coding agent look up a repository's ADRs, tickets and
conventions on its own. It cannot read outside the project root, it changes no files unless
writing is explicitly enabled, and it masks secrets and personal data in everything it returns.

## Problem & goal

Coding agents work best with project context: why the architecture looks the way it does,
what a ticket really asks for, which conventions the team follows. Today that context is either
missing (the agent guesses) or pasted manually into prompts. Pasting is tedious, and it leaks
whatever is in those files, including secrets.

Success for v0.1:

- Claude Code can answer "Which ADR covers authentication, and what did we decide?" using only
  this server, on the demo project.
- Claude Code can implement a ticket from `tickets/` and cite its acceptance criteria.
- No test fixture secret ever appears in a tool or resource result.

The end-to-end test (ticket 09) checks the tool calls behind each criterion. The demo recording
(ticket 10) shows Claude Code doing it in a real session. Both results go into `docs/WORKLOG.md`.

## Actors & roles

| Actor | What they do |
| --- | --- |
| Developer (primary) | Runs Claude Code or another MCP client in their own repository and starts the server against it. |
| Team lead (secondary) | Rolls the same setup out to a team. Needs to trust that installing it cannot leak secrets or change files. |
| Coding agent | Calls tools and reads resources. Can read only what the server exposes and write only when `--allow-write` is set. |

There are no roles or accounts. One server process serves one project root for one local user.

## Requirements

### Functional

| ID | Requirement |
| --- | --- |
| FR-1 | The server starts via CLI with a required `--root` and serves MCP over stdio. `--adr-dir` and `--tickets-dir` must resolve inside root after `realpath`; otherwise the server exits with code 2. |
| FR-2 | `list_adrs` returns id, title, status and date for every ADR, sorted by id; optional status filter. |
| FR-3 | `get_adr` returns one ADR split into title, status, date, context, decision, consequences. It accepts `"3"` and `"0003"`. |
| FR-4 | `list_tickets` returns id, title, status, labels; optional status and label filters, combined with AND. |
| FR-5 | `get_ticket` returns one ticket including description and acceptance criteria. |
| FR-6 | `get_conventions` returns the content of each of `CONVENTIONS.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `AGENTS.md` that exists in root, in that fixed order. Missing files are skipped. |
| FR-7 | `search_context` returns ranked matches with a short snippet and source reference. It searches the whole ticket (title, labels, description, acceptance criteria) with a bonus for title matches. ADR drafts are not searched. |
| FR-8 | ADRs and tickets are available as resources `adr://{id}` and `ticket://{id}`. |
| FR-9 | With `--allow-write`, `create_adr_draft` writes a new file to `<adr-dir>/drafts/` and never overwrites. The number is the highest number across `<adr-dir>` and `<adr-dir>/drafts/` plus one. |
| FR-10 | Unknown ids and invalid input return a tool error the agent can act on, not a crash. |
| FR-11 | Status and label filters match case-insensitively and exactly (`accepted` matches `Accepted`, `progress` does not match `in-progress`). |
| FR-12 | A ticket's id is the frontmatter `id`. If it differs from the filename prefix, the frontmatter wins and a warning is logged. If two tickets share an id, the first by relative path wins and a warning names both files. |
| FR-13 | Ticket frontmatter is parsed with the subset defined under Data & schema, without a YAML dependency. A ticket outside the subset, without frontmatter or without `id` is skipped with a warning. |
| FR-14 | An ADR that does not follow the template is still listed (see Edge cases). |
| FR-15 | Files skipped during listing or search (over `--max-file-kb`, unparseable) are left out of the result. A warning with path and reason goes to stderr, and the text content states how many files were skipped and why (for example "1 file skipped (too large)"). `get_adr`/`get_ticket` on such an id return a tool error with the reason. |
| FR-16 | If `--adr-dir` or `--tickets-dir` does not exist, the server still starts and logs a warning. The matching list tools return an empty list, and the text content names the missing directory and the flag to set. |
| FR-17 | An ADR's status and date are read from frontmatter `status:`/`date:` (MADR 3), a `- Status:`/`- Date:` bullet, or a `## Status` section and a `Date:` line (Nygard, title `# 1. …`), in that order. A status of the form `X by …` is returned as `X`. MADR sections `Context and Problem Statement` and `Decision Outcome` count as context and decision; a `### Consequences` inside Decision Outcome counts as consequences. |

### Non-functional

| ID | Requirement |
| --- | --- |
| NFR-1 Security | No file outside `--root` is readable, including via `..`, absolute paths or symlinks. |
| NFR-2 Security | `.env*`, `.git/`, `node_modules/` and files over `--max-file-kb` are never read. |
| NFR-3 Privacy | Every text returned to the client passes through redaction, masked as `[REDACTED:<type>]`. Email addresses are always redacted; there is no allow-list. |
| NFR-4 Safety | Without `--allow-write`, no write tool is registered or listed. |
| NFR-5 Protocol | Nothing except protocol messages is written to stdout. |
| NFR-6 Observability | One structured audit line per tool call on stderr: tool, ok, duration, result size, redaction count. Resource reads get the same kind of line with `event: "resource_read"` and the URI scheme, not the id. No arguments, no content. Audit goes to stderr only (ADR 0005). |
| NFR-7 Performance | Any tool answers in under 300 ms for a project with 500 markdown files. Sources read files on every call, without a cache (ADR 0004). |
| NFR-8 Quality | `pnpm check` passes on every commit. Security rules have negative tests. |
| NFR-9 Distribution | v0.1.0 is published to npm as `mcp-project-context`, so `npx mcp-project-context --root .` works as the README shows. `dist/cli.js` starts with a Node shebang. |

### Acceptance criteria

- **AC1 (FR-1)** Given no `--root`, a missing path or a file as root, when the CLI starts, then it exits with code 2 and a readable message on stderr.
- **AC2 (FR-1)** Given `--tickets-dir ../other` or a symlinked tickets directory pointing outside root, when the CLI starts, then it exits with code 2.
- **AC3 (FR-2, FR-11)** Given the demo project, when `list_adrs` is called with `status: "accepted"`, then it returns ADRs 0001 and 0002.
- **AC4 (FR-3)** Given the demo project, when `get_adr` is called with `"2"`, then it returns ADR 0002 with the decision about magic links.
- **AC5 (FR-4, FR-11)** Given the demo project, when `list_tickets` is called with `status: "TODO"` and `label: "api"`, then it returns only T-003.
- **AC6 (FR-5)** Given the demo project, when `get_ticket` is called with `"T-003"`, then it returns four acceptance criteria, all with `done: false`.
- **AC7 (FR-6)** Given a root with `AGENTS.md`, `CLAUDE.md` and `CONVENTIONS.md` but no `CONTRIBUTING.md`, when `get_conventions` is called, then it returns `CONVENTIONS.md`, `CLAUDE.md`, `AGENTS.md` in that order.
- **AC8 (FR-7)** Given the demo project, when `search_context` is called with `"authentication"`, then ADR 0002 is the first result.
- **AC9 (FR-7)** Given a ticket whose only match for `"429"` is in an acceptance criterion, when `search_context` is called with `"429"`, then that ticket is in the results.
- **AC10 (FR-8)** Given the demo project, when `adr://0002` is read, then the raw markdown comes back redacted.
- **AC11 (FR-9)** Given ADRs 0001 to 0004 and a draft 0005, when `create_adr_draft` is called, then it writes `drafts/0006-<slug>.md`.
- **AC12 (FR-9)** Given an existing entry at the target name, when `create_adr_draft` is called, then it returns a tool error and the entry is unchanged. Given 10 parallel calls in one server, then all succeed with consecutive numbers (decision 87).
- **AC13 (FR-10)** Given an unknown ADR id, when `get_adr` is called, then it returns a tool error listing the available ids.
- **AC14 (FR-12)** Given `T-012-login.md` with frontmatter `id: T-013`, when tickets are listed, then the ticket has id `T-013` and a warning is logged.
- **AC15 (FR-12)** Given `a/x.md` and `b/y.md` both with `id: T-003`, when `get_ticket("T-003")` is called, then it returns the ticket from `a/x.md` and a warning names both files.
- **AC16 (FR-13)** Given the four demo tickets, when they are parsed, then all four parse without warnings.
- **AC17 (FR-13)** Given a ticket with a block list (`labels:` followed by `- api`), nesting or a multi-line value, when tickets are listed, then it is skipped and a warning is logged.
- **AC18 (FR-14)** Given demo ADR 0004, when `get_adr("0004")` is called, then it returns title "Notes from the old wiki", status `Unknown`, the body in `context`, and empty `decision` and `consequences`.
- **AC19 (FR-15)** Given one ticket larger than `--max-file-kb`, when `list_tickets` is called, then the other tickets are returned and the text says one file was skipped as too large.
- **AC20 (FR-16)** Given a root without `tickets/`, when the server starts and `list_tickets` is called, then the server runs, the list is empty and the text names `tickets/` and `--tickets-dir`.
- **AC21 (NFR-1, NFR-2)** Negative tests for `../secret.md`, `/etc/passwd`, a symlink escaping root, `.env`, `.git/config`, `node_modules/x/readme.md`, a `.ts` file and an oversized file each fail with the matching `SafeFsError` reason.
- **AC22 (NFR-3)** Given demo T-002, when it is returned by any tool or resource, then the email and phone number are masked.
- **AC23 (NFR-3)** Given a 40-char git SHA, a UUID, an ISO date, a version `1.32.2` and a markdown table with numbers, when they are redacted, then they are unchanged.
- **AC24 (NFR-4)** Given no `--allow-write`, when the client calls `listTools()`, then `create_adr_draft` is absent.
- **AC25 (NFR-5)** Given the built CLI spawned against the demo project, when an initialize request is sent, then stdout carries only a valid JSON-RPC response and stderr only JSON lines.
- **AC26 (NFR-6)** Given a tool call and a resource read, when stderr is captured, then each produced one audit line without arguments, ids or content.
- **AC27 (NFR-7)** Given 500 generated markdown files in a temp dir, when `search_context` is called, then it answers in under 300 ms.
- **AC28 (NFR-9)** Given the published package, when `npx mcp-project-context --root examples/demo-project` runs, then the server starts.
- **AC29 (Goal)** Given the e2e session against the demo project, when every returned string is collected, then none of the fixture secrets appear.

## Edge cases & errors

| Case | Behaviour |
| --- | --- |
| ADR without the expected headings | Listed. Id from the `NNNN-` filename prefix. Title from the first `#` heading with any `NNNN:` or `1.` prefix stripped, else the filename slug. Status `Unknown` if none of the FR-17 sources gives one, date empty. Missing sections are empty strings; if none of Context, Decision, Consequences is found, the body goes into `context`, without frontmatter and without a `## Status` section. A warning is logged. |
| ADR frontmatter outside the subset | Listed. The frontmatter is ignored, status and date come from the other FR-17 sources. Warning with path, line and problem, never content (decision 75). |
| Ticket id differs from filename | Frontmatter wins, warning (FR-12). |
| Duplicate ticket id | First by relative path wins, warning naming both files (FR-12). |
| Frontmatter outside the subset, missing or without `id` | Ticket skipped, warning (FR-13). |
| File over `--max-file-kb` or unparseable during listing/search | Left out, warning, skip count in the text content (FR-15). |
| `get_*` on a skipped file's id | Tool error with the reason. |
| Source directory missing | Server starts, empty list, hint naming the directory and flag (FR-16). |
| Source directory outside root | Exit code 2 at startup (FR-1). |
| Filter value with different casing | Matches (FR-11). |
| Draft target exists | Exclusive create fails, tool error, nothing overwritten (FR-9). |
| Two drafts in parallel | Serialised in the server; consecutive numbers (decision 87). Two server processes on one repo are not serialised; exclusive create still prevents overwriting. |
| Draft title like `../../evil` | Slug is sanitised; the file lands inside `drafts/`. |
| Search term that is later redacted | The document is still found; the snippet shows `[REDACTED:<type>]` (ADR 0003). |
| Empty search query | Tool error. |

## UX & texts

The product surface is the MCP tool list and the text the agent reads.

- Tool descriptions are written for an agent: when to use the tool, with an example id.
- Error messages say what the agent can do next: list the available ids for an unknown id, name the
  flag for a missing directory, give the reason for a skipped file.
- List and search results mention skipped files as a count with reasons, never with file content.
- The text content and `structuredContent` carry the same data.

## Data & schema

No database. The data model is the parsed markdown.

**ADR** (`<adr-dir>/NNNN-slug.md`, `drafts/` ignored by readers):

```ts
{ id: string; title: string; status: string; date: string;
  context: string; decision: string; consequences: string }
```

**Ticket** (`<tickets-dir>/**/*.md`, `README.md` ignored, id `[A-Za-z0-9._-]+`):

```ts
{ id: string; title: string; status: string; labels: string[];
  description: string; acceptanceCriteria: { text: string; done: boolean }[] }
```

Checklist items under `## Acceptance criteria` become `acceptanceCriteria`.

**Frontmatter subset.** Frontmatter is the block between a `---` line at the very top of the file and
the next `---` line. Blank lines and lines starting with `#` (comments) are skipped. Every other
line must have the form `key: value`, where the value is one of:

- a plain string, trimmed: `status: todo`
- a quoted string in double or single quotes: `title: "Rate-limit: magic links"`, `title: 'x'`
- an inline array of items, each plain or quoted by the same rules: `labels: [api, "a, b"]`;
  `[]` is an empty list

Everything else is outside the subset: block lists (`- item`), nesting, multi-line values, a
comment after a value and any other YAML syntax. A ticket with such frontmatter is skipped with a warning. `id` is required.
`title` and `status` default to an empty string and `labels` to an empty list. Unknown keys that
fit the syntax are ignored. All four demo tickets must parse.

**Freshness.** Sources read from disk on every call; there is no cache or index (ADR 0004).

## Security & privacy

- All file access goes through the safe file module: root check after `realpath`, deny list
  (`.git`, `node_modules`, `.env*`), extension allow-list, size limit.
- The source directories are validated against root at startup (FR-1).
- Redaction runs once, at the output boundary, on tool results and resource contents (ADR 0003).
  Emails are always masked.
- The audit log goes to stderr only, so there is no second write path and no file inside root the
  agent could read back (ADR 0005). It records counts, never matched values, arguments or ids.
- The only write path is `create_adr_draft`, registered only with `--allow-write` (ADR 0002).
  Draft content is written unredacted, because it is the user's own input; the returned text is
  redacted.
- No network access in the default configuration.

## Dependencies

- Runtime: `@modelcontextprotocol/server` 2.4.0 (pinned) and `zod`. No new runtime dependency;
  the frontmatter parser is our own code.
- ADRs 0001 to 0005 must be in place. ADR 0006 is reserved for network access in the GitHub
  Issues stretch ticket.
- An npm account that can publish `mcp-project-context`. The name was free on 2026-11-16.

## Target picture (solution)

The module layout in `docs/architecture.md` stays as it is. Decisions on top of it:

- **Read on every call.** Sources hold no state. The agent may tick a checkbox or add an ADR during
  the session and should see it at once. Rejected: an index built at startup (stale) and an mtime
  cache (more code and edge cases before there is a measured need). Ticket 07's perf test reopens
  this if it fails.
- **Frontmatter is the ticket's identity.** The GitHub source in ticket 11 has no filenames, so
  the id has to live in the data. Rejected: filename prefix.
- **Own frontmatter parser for a fixed subset.** The demo format needs only scalars and inline
  arrays. Rejected: the `yaml` package, which would need an ADR and adds a runtime dependency.
- **Draft numbers count across accepted ADRs and drafts.** A draft keeps its number when promoted.
  Rejected: a separate draft sequence that collides with accepted numbers.
- **Malformed ADRs stay visible.** The agent can still read legacy notes through `get_adr`.
  Rejected: skipping them, or returning only empty fields.
- **Audit on stderr only, including resource reads.** MCP clients already capture stderr.
  Rejected: an `--audit-file` option, which would add a second write path.
- **Lenient startup, strict boundaries.** A missing source directory is allowed so one config fits
  repos with only some sources. A directory outside root is a hard error.

### Stages

The tickets in `docs/tickets/` are the stages, one PR each, in the order of `docs/tickets/README.md`.
Each ticket is testable on its own with `InMemoryTransport`.

| Ticket | Covers | Status |
| --- | --- | --- |
| 01 Server skeleton | FR-1, FR-16 (startup part), NFR-5 | done · 2026-11-16 · ticket-01-server-skeleton |
| 02 Safe file access | NFR-1, NFR-2 | done · 2026-11-16 · ticket-02-safe-file-access |
| 03 Redaction | NFR-3 | done · 2026-11-16 · ticket-03-redaction |
| 04 Result helper and audit | FR-10, NFR-6 | done · 2026-11-16 · ticket-04-result-helper-audit |
| 05 ADR tools | FR-2, FR-3, FR-8 (adr), FR-11, FR-14, FR-15 | done · 2026-11-16 · ticket-05-adr-tools |
| 06 Ticket tools | FR-4, FR-5, FR-8 (ticket), FR-11, FR-12, FR-13, FR-15 | done · 2026-11-16 · ticket-06-ticket-tools |
| 05b ADR format variants (#16) | FR-14, FR-17 | done · 2026-11-17 · ticket-05b-adr-formats |
| 07 Conventions and search | FR-6, FR-7, NFR-7 | done · 2026-11-17 · ticket-07-conventions-search |
| 08 Write tool | FR-9, NFR-4 | done · 2026-11-17 · ticket-08-write-tool |
| 09 Integration tests | Goal, AC25, AC29 | open |
| 10 README, demo, release | NFR-9, Goal (demo) | open |
| 11 Stretch: GitHub Issues | Out of v0.1 scope | open |

## Rollout & release

- Tag `v0.1.0`, publish a GitHub release with a changelog, and publish to npm.
- Users add the server with `claude mcp add project-context -- npx mcp-project-context --root .`.
  Writing stays off until they add `--allow-write` themselves.
- No migration; there is no stored state.

## Non-goals

- HTTP transport, authentication, multi-user setups.
- Remote sources (GitHub Issues, Jira, Linear). GitHub Issues is a stretch ticket.
- Semantic or vector search.
- Editing or deleting existing files.
- Caching or indexing (ADR 0004).
- An audit file (ADR 0005).
- An email allow-list.
- Full YAML frontmatter.
- Convention files outside root or configurable convention file names.

## Docs & help

- README: Demo, How this was built and Limitations (ticket 10). Limitations names at least
  pattern-based redaction, keyword search and stdio only. Document the frontmatter subset.
- ADR 0004 (read on every call) and ADR 0005 (audit on stderr only).
- Tickets 01, 03 to 08, 10 and 11 reference the decisions below.
- `docs/WORKLOG.md` gets the coverage number and the e2e/demo results.

## Decision log

| # | Question | Decision | Reason |
| --- | --- | --- | --- |
| 1 | Ticket id from file name or frontmatter? | Frontmatter `id`; on mismatch the frontmatter wins and a warning is logged. | Remote sources have no filenames. |
| 2 | Search ticket comments? | Local tickets have no comments. Search the whole ticket with a title bonus. Comments are for ticket 11 to decide. | Finds acceptance criteria too; simple. |
| 3 | Email allow-list? | No. Always redact. | Safest default, nothing to configure or test. |
| 4 | ADR without expected headings? | List it; status `Unknown`; whole body in `context` if no section is found; warning. | The agent can still read legacy notes. |
| 5 | `--audit-file`? | No. stderr only. | No second write path; clients capture stderr. ADR 0005. |
| 6 | Draft numbering? | Highest number across ADRs and drafts, plus one. | No collision on promotion. |
| 7 | Cache or re-read? | Re-read on every call. | Always fresh; perf test decides if a cache is needed. ADR 0004. |
| 8 | Duplicate ticket ids? | First by relative path wins; warning names both. | Deterministic; agent still gets an answer. |
| 9 | npm publish in v0.1? | Yes. | The README Quickstart uses `npx`. |
| 10 | YAML dependency? | No. Own parser for a fixed subset. | No new runtime dependency. |
| 11 | Frontmatter subset | Plain, double- or single-quoted strings; inline arrays with plain or quoted items. Anything else skips the ticket. | Covers the demo; easy to test. |
| 12 | Required frontmatter keys | `id` required; others optional with empty defaults; unknown keys ignored. | Tickets without labels stay usable. |
| 13 | Audit resource reads? | Yes, with the URI scheme only. | Every response leaving the server is accounted for. |
| 14 | Filter matching | Case-insensitive, exact. | Agents guess casing. |
| 15 | Missing source directory | Start, empty lists, hint. | One config for repos with only some sources. |
| 16 | Source directory outside root | Exit code 2 at startup. | Fail early on misconfiguration. |
| 17 | Skipped files | Omitted, warning on stderr, count with reason in the text; `get_*` on that id gives a tool error. | The agent knows the result is incomplete. |
| 18 | AGENTS.md | Included as a fourth convention file. | Common place for agent rules. |
| 19 | Verifying the success criteria | Scripted e2e test plus a recorded demo. | Repeatable check plus a real-session proof. |
| 20 | Separate ADRs for decisions | ADR 0004 (no cache) and 0005 (stderr audit). Ticket 11's ADR becomes 0006. | These close off features someone will propose again. |
| 21 | Convention file order | Fixed: `CONVENTIONS.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `AGENTS.md`. Missing files are skipped. | Team rules first, agent-specific rules after. |
| 22 | Where do `--help` and `--version` print? | stderr, like everything else. | The "never stdout" rule stays absolute; Biome only allows `console.error`. |
| 23 | Commits per stage | Several small commits, each passing `pnpm check`. | CLAUDE.md asks for small commits; it wins over the one-commit default of the implement skill. |
| 24 | File access in `config.ts` before safe-fs exists | `config.ts` uses `node:fs` directly for startup validation (exception in CLAUDE.md). Ticket 02 extracts the inside-root check into safe-fs and `config.ts` reuses it. | safe-fs needs a validated root first. One implementation of the root check in the end. |
| 25 | Source dir that cannot be checked (broken symlink, ENOTDIR, EACCES) | Exit code 2 with a message naming the flag. | Treated like a dir outside root: we cannot prove it is inside. |
| 26 | Source dir equal to root (`--tickets-dir .`) | Allowed. | It is inside root; safe-fs deny rules still apply to what is read. |
| 27 | Base for ticket 02 while PR #12 was open | Wait for the merge, then branch from `main`. No stacked PRs. | Each ticket PR stays reviewable against `main`. |
| 28 | Symlinks and the deny/extension rules | Both rules run on the requested path and on the symlink target. | A link cannot turn `.env` into `notes.md` or a `.ts` file into a `.md` file. |
| 29 | `listFiles` behaviour | Recursive, sorted, paths relative to root. Never enters symlinked directories. A symlinked file is kept only if its target passes every rule. Files over the size limit are listed. | No cycles, no escapes. FR-15 needs the oversized files to count them as skipped. |
| 30 | Reasons for edge cases | Missing file or broken symlink inside root: `not_found`. Missing path outside root: `outside_root`. Missing `.env*`: `denied` (rules run before the existence check). NUL byte: `denied`. Root itself: `not_found`. `exists()` is false only for `not_found` and throws otherwise. It ignores the size limit. | The answer for a denied path does not reveal whether it exists. `exists()` cannot be used to probe denied paths. |
| 31 | Letter case in the deny list | Compared case-insensitively. | macOS and Windows file systems treat `.GIT` as `.git`. Found in review. |
| 32 | `.env*` as a directory name | Any path segment starting with `.env` is denied. | A Python venv named `.env/` stays closed. |
| 33 | EACCES and other I/O errors | New reason `unreadable`, with a message that contains no host path. `listFiles` skips unreadable entries. | Node's messages contain absolute paths. The agent should see what happened. |
| 34 | Hard links to files outside root | Not caught, documented as a limitation. | Planting one needs write access to the repo, the same threat as a symlink, and realpath cannot see it. Rejecting `nlink > 1` would hit legitimate files. |
| 35 | Race between check and read | The size limit is checked on the open handle and the read is capped. A symlink swapped in between check and open is documented, not caught. | The size part is cheap. Closing the symlink race needs `O_NOFOLLOW` per path segment and a local attacker writing at that moment. |
| 36 | "No other module imports `node:fs`" | Enforced by `test/architecture.test.ts` (`safe-fs.ts` and `config.ts` allowed). | The test runs on every commit; a review check is easy to miss. |
| 37 | What `Finding.index` refers to | The offset of the match in the original text. | Stable, independent of replacement lengths. Only the count is used so far (audit). |
| 38 | Stripe-style keys like `PAYMENT_API_KEY=sk_test_…` | No extra type. `assignment` matches any key name that contains `api_key`, `access_key`, `secret`, `password`, `passwd`, `pwd` or `token`, with any prefix, case-insensitive, `=` or `:`. Only the value is masked. | Keeps the ticket's type table. Covers the demo fixture and `.env`-style lines. |
| 39 | Overlapping matches (`token: ghp_…`) | Patterns run in a fixed order and the first one wins. Specific types come first and `assignment` comes last. A value that is already `[REDACTED:…]` is not masked again. | One finding per secret, with the more precise type. `redact()` is idempotent. |
| 40 | Agent decisions vs. questions | CLAUDE.md rule 7: the agent decides implementation details and records them here. It asks only about scope, public output, security behaviour, conflicts with docs or ADRs, or decisions that are hard to undo. At most one round of questions per stage. | Ticket 03 raised too many low-level questions. |
| 41 | Phone vs. IBAN, UUID, date | `iban` runs before `phone`. `phone` needs `+` and a country code, or a leading `0` and a separator, and must not touch a word character, `-` or `+`. | IBAN digit groups and UUID/date segments otherwise look like phone numbers. |
| 42 | Regex runtime | Patterns with open-ended runs start only at the beginning of a run (lookbehind) and have bounded lengths (email local part ≤ 64). A test runs 100 KB adversarial inputs. | The first version took 4–13 s on 100 KB runs like `a-a-a…`. Files can be up to `--max-file-kb`. |
| 43 | Fake tokens in tests | Joined from parts at runtime. | Secret scanning on push would otherwise flag the test file. |
| 44 | AC22 "returned by any tool or resource" | Ticket 03 tests `redact()` on the T-002 fixture. The path through tools and resources is covered by ticket 04 (result helper) and ticket 09 (leak test). | ADR 0003: `redact()` is called in the result helper, which does not exist yet. |
| 45 | Forms of an `assignment` value | Operators `=`, `:`, `:=`, `=>`, `::`, and the value must be on the same line. A quoted value runs to its closing quote, or to the end of the line if the quote is never closed. An unquoted value runs to the next whitespace, so `,` and `;` belong to it. | Found in review: quoted values with spaces, `token := x` and `p@ss,word` leaked whole or in part. |
| 46 | False positives of the broad patterns | Kept, so the patterns fail closed (confirmed by the user): `Token: see below`, `tokens: 100`, numbers with a leading 0 like `0042 1234`, and `git@github.com:…` are masked. Tests pin this behaviour. | Masking too much costs readability. A leak costs a secret. Narrowing the key match (e.g. skipping digit values) would let `password: 123456` through. |
| 47 | IBAN matching | Any letter case, groups split by spaces or dashes, or compact. Valid only if the mod-97 checksum holds. If the match runs into the next word, trailing groups are dropped until it holds, cutting only at group ends. | Found in review: a lowercase IBAN leaked as a partial phone match, and `US12 3456 7890 1234` was masked. A cut inside a group left one digit visible. |
| 48 | Private key without an END line | Masked from `BEGIN` to the end of the text. | Pasted or truncated fragments must not leak. Found in review. |
| 49 | `Authorization` headers and credentials in URLs | Two new types. `auth_header` masks the credential after `Bearer`/`Basic` (either case) if it is at least 8 characters with a digit. A JWT there keeps the `jwt` type. `url_credentials` masks `user:password` in `scheme://user:password@host` and runs before `email`. A URL without credentials stays unchanged. | Asked for by the user after the review. The digit rule keeps prose like "Basic authentication" readable. |
| 50 | Limit of the regex timing tests | 2 s per 100 KB input (actual: a few ms). | Catastrophic backtracking shows up as seconds, not milliseconds. 2 s catches it without flaking on slow CI runners. |
| 51 | Signature of the result helpers | `ok(structured, text)` and `fail(message)` without a tool name, as in `docs/architecture.md`. `withAudit(tool, handler)` gets the redaction count from a module `WeakMap`. A handler result that `ok()` or `fail()` did not build becomes an internal tool error. | `withAudit` already knows the name. The `WeakMap` keeps the result shape clean, and the check catches a tool that returns raw text. |
| 52 | Exceptions in a tool handler | `withAudit` catches all of them. A `SafeFsError` becomes `fail()` with its redacted message. Anything else becomes `Internal error in <tool>. Try again or report it.` and a `log.error` line with the error name and the redacted message. Confirmed by the user. | Otherwise the SDK sends `error.message` to the client unredacted, possibly with host paths. |
| 53 | Errors and contents in resource reads | Resources have no `isError`, so `withResourceAudit` writes `ok: false` and rethrows. A `ResourceNotFoundError` passes through. A `SafeFsError` `not_found` becomes `ResourceNotFoundError(uri)`, which the client sees as -32602 with the URI and without the file path. Other `SafeFsError`s keep their redacted message, and anything else gets a generic message. Entries are rebuilt from `uri`, `mimeType` and `text`, so `_meta` is dropped. Binary contents are an error. | Same rules as for tools. Nothing unredacted reaches the client. |
| 54 | Audit line fields | `{ time, level: 'info', msg: 'audit', event, … }` through `log.audit()`. `ms` is a rounded integer. `bytes` is the UTF-8 length of the JSON result after redaction, and 0 for a failed resource read. `redactions` counts every replacement in the result, so one secret in both `content` and `structuredContent` counts twice. | Same shape as every other log line. The count is what was masked, not how many distinct secrets there were. |
| 55 | Object keys and changes after `ok()` | Keys in `structuredContent` are redacted too. `ok()` and `fail()` return frozen objects. | Found in review: a key built from content (counts per assignee) leaked, and a handler could put raw text back after `ok()`. |
| 56 | Output schemas and redaction | Text fields in an `outputSchema` are plain `z.string()`, with no `.email()`, `.url()`, `.regex()` or enum on text that comes from files. Checked in the review of tickets 05 and 06. | The SDK validates `structuredContent` after redaction. A format check then fails, the agent gets an output validation error, and the audit line still says `ok: true`. Found in review; decided by the agent under rule 7. |
| 57 | Calls the SDK rejects before the handler | Invalid input, unknown tools and resource URIs that match no template produce no audit line. Accepted for v0.1. | The SDK answers them before `withAudit` runs. Overriding SDK internals is fragile. The zod messages seen do not echo input values. |
| 58 | Text content of the ADR tools | Compact markdown. `list_adrs`: one line `0001  Title  (Status, Date)` per ADR, then the skip line. `get_adr`: `# id: title`, `Status: … · Date: …`, then the three sections, `(empty)` for an empty one. Confirmed by the user. | Readable for agent and human, same data as `structuredContent`. |
| 59 | Which files are ADRs | Only `NNNN-*.md` directly in `--adr-dir`. `README.md`, templates, `drafts/` and other subdirectories are ignored silently and not counted as skipped. Confirmed by the user. | They are not ADRs. Counting them as skipped would mislead the agent. |
| 60 | Accepted id forms | Digits only, trimmed: `"3"`, `"03"`, `"0003"` become `"0003"`. Ids above 9999 keep their digits. Anything else (`"ADR-3"`) is an unknown id with the list of ids. The same rule applies to `adr://{id}`. Confirmed by the user. | Exactly what FR-3 asks for. |
| 61 | Duplicate ADR numbers (`0001-a.md`, `1-b.md`) | The first by path wins and a warning names both files. | Same rule as duplicate ticket ids (FR-12). |
| 62 | Where the skip and missing-dir hints go | Text content only. `structuredContent` of `list_adrs` stays `{ adrs }` as in the ticket. `get_adr` names `--adr-dir` when the directory is missing. An empty `status` is no filter. | FR-15 and FR-16 ask for the text. An agent that sends optional fields as `""` still gets all ADRs (found in review). |
| 63 | Status, date and sections | `Status`/`Date` bullets (`-`, `*`, `+`, bold allowed) count only before the first `##` heading, and an empty value counts as missing. A section runs to the next heading of level 1 or 2, so `###` stays inside it. Headings in code fences are ignored. Warnings fire on every call that reads the file. | A bullet in Consequences is not the ADR's status. Logging once per process would need state the sources must not hold (ADR 0004). |
| 64 | Resource list | `adr://{id}` lists readable ADRs with name `ADR 0002` and the title. `withResourceList` in `result.ts` redacts uri, name and title and rethrows errors with a redacted message. It writes no audit line. | Titles come from file content and would otherwise reach the client unredacted. A listing is not a read (NFR-6). |
| 65 | ADRs in other formats | Supported: status and date from a bullet, a Nygard `## Status` section or MADR 3 frontmatter, and a `1.` title prefix is stripped. New stage 05b after ticket 06, which brings the frontmatter parser. Decided by the user after the ticket 05 review. | Common real-world ADRs would otherwise all show status `Unknown`. |
| 66 | Text content of the ticket tools | Compact markdown like decision 58. `list_tickets`: one line `T-003  Title  (status · label, label)` per ticket, then the skip line. `get_ticket`: `# id: title`, `Status: … · Labels: …`, the description, then `## Acceptance criteria` as a `- [ ]`/`- [x]` list, `(none)` if empty. Confirmed by the user. | Same style as the ADR tools, same data as `structuredContent`. |
| 67 | Which files are tickets | Every `.md` under `--tickets-dir`, recursively (AC15 uses `a/x.md`). Files named `README.md` (any case) are ignored silently. Any other file that cannot be used is counted as skipped: `no frontmatter`, `invalid frontmatter`, `missing id`, `invalid id`, or a safe-fs reason. Confirmed by the user. | A README is not a ticket. Any other file there was probably meant to be one, so the agent should know it was left out. |
| 68 | `get_ticket` on a skipped file | The id of a skipped file is unknown, so the filename id (`T-012` from `T-012-login.md`) stands in. `get_ticket` with that id returns a tool error with the reason, and the id appears in "Available ids". A parsed ticket with the same id wins. `ticket://` on a parse-skipped file is not found; a file that cannot be read keeps its SafeFsError. Confirmed by the user. | FR-15 asks for the reason, and the frontmatter of a too-large file cannot be read. |
| 69 | Allowed ticket id characters | `[A-Za-z0-9._-]+`. Any other id skips the ticket as `invalid id` with a warning. Decided by the user after the review. | The SDK does not decode `%`-escapes in template variables, so `id: a/b` or `id: T 2` produced `ticket://` URIs that could not be read back. Found in review. |
| 70 | Matching, sorting and the mismatch warning | Ids and filters are compared case-insensitively after trimming. The list is sorted by id with digit runs compared by value (`T-2` before `T-10`). The filename warning fires only if the filename starts with an id-like prefix (`[A-Za-z]+-\d+`) that differs from the frontmatter id. Duplicates are warned about but not counted as skipped (as for ADRs). An empty filter is no filter (decision 62). Decided by the agent under rule 7. | Agents guess casing. Files named `login.md` would otherwise warn on every call. |
| 71 | Frontmatter details | `labels: api` (a plain value) becomes one label, `labels:` none. An array for `id`, `title` or `status` is invalid. Double quotes unescape `\"` and `\\` only; single quotes unescape `''`. Blank lines are allowed; comments, duplicate keys, trailing commas, ` #` and an unquoted `: ` in a plain value are outside the subset. A `__proto__` key is an ordinary key. Warnings give the line number and a fixed problem text, never content. Decided by the agent under rule 7. | Stays a strict subset of YAML: anything YAML would read differently is rejected. stderr is not redacted. |
| 72 | Acceptance criteria and description | The first `## Acceptance criteria` heading (any case, outside code fences) opens the section; it runs to the next heading of level 1 or 2. Only `- [ ]`/`- [x]` items count (`*`, `+` and `[X]` too). Indented lines below an item continue it, so a plain sub-bullet is appended to its parent. Items inside a code fence are ignored. The description is the body without that section. Decided by the agent under rule 7; the fence rule was found in review. | Matches the demo tickets and the template. Fenced examples are not criteria. |
| 73 | Precedence of the ADR status and date sources | Frontmatter, then bullet, then `## Status` section (date: `Date:` line). No warning when sources disagree. Confirmed by the user. | A real file uses one format. The rule is deterministic, and a conflict warning would mostly be noise. |
| 74 | Statuses like `Superseded by [2. Use X](0002-use-x.md)` | For every source, a value of the form `X by …` is cut to `X` (`Superseded`, `Amended`). Other values such as `In progress` stay as written. Confirmed by the user. | FR-11 matches exactly, so `list_adrs({ status: "superseded" })` must find these ADRs. The successor stays readable through `adr://`. |
| 75 | ADR frontmatter outside the subset | The ADR is listed, the frontmatter is ignored and status and date come from the other sources (else `Unknown`). A warning gives path, line and problem, never content. The block up to the closing `---` stays out of every field; without a closing line the file is read as if it had no frontmatter. Confirmed by the user. | FR-14: an ADR off the template is still listed. Skipping it like a ticket would hide an ADR because of one comment line. |
| 76 | MADR section names | Mapped: `## Context and Problem Statement` → context, `## Decision Outcome` → decision. A `### Consequences` inside Decision Outcome becomes consequences and is removed from decision. Other MADR sections (`Considered Options`, `Pros and Cons …`) are not returned by `get_adr`. When `Decision Outcome` is present, a missing consequences section is not warned about. Confirmed by the user. | Without the mapping every MADR ADR would warn and put its whole body into `context`. Consequences are optional in MADR. |
| 77 | ADR format parsing details | The `## Status` section gives its first non-empty line; later lines (`Supersedes …`) are ignored, an empty section counts as missing. A plain `Date:` line (bold allowed) counts only before the first `##` heading. The cut of decision 74 is case-insensitive and needs text after `by`. Title prefixes stripped: `^\d+\s*:\s*` and `^\d+\.\s+` (so `1.5 release` stays). From the frontmatter only `status` and `date` are read; other keys are ignored, and an array value counts as missing. Sections, title and the context fallback are read from the body after the frontmatter. The template warning counts status as present from any source. Decided by the agent under rule 7. | Matches adr-tools output, where the status line comes first. A title like `1.5 release` is not a numbered heading. |
| 78 | MADR consequences and other 05b details | A `### Consequences` inside Decision Outcome runs to the next heading of level 3 or higher, so `### Confirmation` stays in decision. If the file also has a `## Consequences` section, that one wins and Decision Outcome stays whole. The `Date:` line is matched case-sensitively (bold allowed). A file that starts with a thematic break `---` and has a later `---` is read as invalid frontmatter: the lines in between are dropped and a warning is logged. Decided by the agent under rule 7; the last two came from the review. | Matches the MADR 3 layout. A lowercase `date:` line from an unclosed frontmatter block would otherwise become the date. Decision 75 asks for the thematic-break behaviour as written, and a test pins it. |
| 79 | Comment lines in frontmatter | Lines whose first character is `#` are skipped, for tickets and ADRs. A comment after a value (` #`) and an indented comment stay outside the subset. This changes decision 71. Decided by the user after the 05b review. | The stock MADR 3 template starts its frontmatter with a comment line. Without this change such ADRs showed status `Unknown`. YAML reads full-line comments the same way, so the subset stays strict. |
| 80 | Snippets and secrets | A snippet never cuts into a secret. `redact()` reports the whole pattern match of each finding (`Finding.match`, including the key of an assignment, `Bearer` and the URL scheme), and `search.ts` widens the window until no match is cut. Line breaks stay in the snippet, because some patterns end at them; only runs of spaces and tabs and blank lines are collapsed. The text stays raw until the result helper redacts it. Decided by the user (widening, including the key) and after the review (line breaks). | A cut secret no longer matches its pattern and would leak. Joining lines let an unclosed quoted value run into the next line, so the boundary saw different text than the file. |
| 81 | Overlapping matches | A match that overlaps an earlier one is merged with it: the union is masked and the earliest pattern names it. Changes decision 39, which dropped the later match. First only for `assignment`, then for all types after the invariant test (decision 86). Decided by the user after the ticket 07 review. | `password = "hunter2 AKIA…"` left `hunter2` visible, and `https://bob:AKIA…@host` left `bob:`. |
| 82 | Text content of `get_conventions` and `search_context` | `get_conventions`: one `## <path>` block per file; with no file `No convention files in root. Looked for …`. `search_context`: `1. adr 0002  Title  (score N)` per result, the snippet indented by three spaces on every line, then the skip line; with no hit `No matches for "x".`. Confirmed by the user. | Same style as decisions 58 and 66, same data as `structuredContent`. |
| 83 | Search details | The query is split on whitespace; each distinct word is matched case-insensitively as plain text (no pattern), and a document is a hit if any word matches. Score = matches in the body + 5 × matches in the title. Ties: kind (adr, ticket, convention), then id with numbers by value. ADRs: title, context, decision, consequences (what `get_adr` returns; drafts never). Tickets: title, description, criterion texts, label values, without added words like `Labels:` or `- [x]`. Conventions: the raw file, id and title are the path. The snippet starts about 60 characters before the first match in the body, or at the start for a title-only hit. `kinds: []` means all kinds, `limit` is an integer 1–50 (default 10), `query` at most 500 characters. A blank query is a `fail()` in the handler, so it gets an audit line. The skip line counts skipped files of the searched kinds only; a missing source directory is silent. Decided by the agent under rule 7. | Simple and explainable, as the ticket asks. Added words matched every ticket (found in review). |
| 84 | Convention file details | Read through `safeFs.readTextFile`. A missing file is left out silently; a file that cannot be read (too large, unreadable) is left out, logged and counted in the skip line. Decided by the agent under rule 7. | FR-6 and FR-15. |
| 85 | Running the NFR-7 test | `pnpm test` runs `test/perf.test.ts` on its own after the other tests (`pnpm test:perf`). It measures the first call, without warm-up: about 100 ms for 500 files. No cache is needed; ADR 0004 stands. Decided by the agent under rule 7. | In the parallel run other workers shared the CPU and the call took up to 447 ms (found in review). |
| 86 | Invariant for overlapping patterns | Every character that a single pattern masks on its own is masked in the combined output. `test/redact-overlap.test.ts` checks it for all 11 types side by side, on two lines, after a comma, inside the value of an assignment, a `Bearer` header or URL credentials, and nested two deep. The email pattern no longer matches the password in `scheme://user:password@host`, so the host stays visible (decision 49). Asked for by the user before the ticket 07 PR. | The test failed in 120 of 595 cases before the fix. Most of them were the email pattern reading a URL password as an email; the rest were real leaks of dropped matches. |
| 87 | Parallel `create_adr_draft` calls | Calls are serialised in the server process (promise queue) on top of exclusive create. Parallel calls all succeed with consecutive numbers; a tool error comes only from an entry that already exists at the target name. Two server processes on one repository are not serialised. Changes AC12, which asked for a tool error on a race. Decided by the user. | `wx` alone only catches the same file name; two titles racing for 0006 would both get it. One server serves one client, so an in-process queue covers the real case. |
| 88 | `create_adr_draft` with a missing `<adr-dir>` | Tool error naming the directory and `--adr-dir`; nothing is written. `drafts/` itself is created when missing. Decided by the user. | A typo in `--adr-dir` must not silently create directories. Same hint as FR-16. |
| 89 | Output of `create_adr_draft` | `structuredContent` `{ id, title, status, date, path }`, text `Created ADR draft 0006 "Title" at <path> (Proposed, <date>). Drafts are not listed by list_adrs; move it to <adr-dir>/ to accept it.` (`the project root` for `--adr-dir .`). Redacted through `ok()`. Decided by the user. | Echoing the title makes the redaction visible; the hint tells the agent why `list_adrs` will not show the draft. |
| 90 | Slug of a draft | The title is redacted first, then NFKD-normalised, accents dropped, `ß` → `ss`, lowercased, every run outside `[a-z0-9]` becomes `-`, cut to 60 characters, `untitled` if empty. The heading in the file keeps the raw title. Redacting first was decided by the user after the review. | Lowercasing hid an AWS key from the patterns, so it reached the file name and the returned path (found in review). The slug can never hold `/`, `\`, `.` or NUL, so `../../evil` stays in `drafts/`. |
| 91 | Draft numbering details | Counts the names of `NNNN-*.md` entries directly in `<adr-dir>` and in `drafts/` through the new `safeFs.listNames()`, whatever their type and whether readable or not. A symlinked `drafts/` inside root is followed. Numbers beyond 2^53 are ignored. Decided by the agent under rule 7; the name count came from the review. | Counting only readable files gave a number that was already taken by an unreadable ADR or a draft behind a symlinked `drafts/` (found in review). |
| 92 | Draft file and input details | Same layout as the demo ADRs: `# NNNN: Title`, `- Status: Proposed`, `- Date:` local date, then `## Context`, `## Decision`, `## Consequences`, each body trimmed. The title is trimmed, must not be empty, must be one line and at most 200 characters (a `fail()` in the handler, so it gets an audit line). `writeTextFile` refuses content over `--max-file-kb`, creates missing parents and uses `wx`; a broken symlink at the target counts as existing. New safe-fs reasons `exists` and `unwritable`. Decided by the agent under rule 7. | `get_adr` reads a promoted draft without warnings. The server never writes a file it would refuse to read. `wx` never follows a link at the target. |
| 93 | Unknown input fields of `create_adr_draft` | The input schema is strict (`z.strictObject`): a call with an extra field such as `status: "Accepted"` is rejected by the SDK and writes nothing. The file always says `Status: Proposed`. An architecture test allows file system writes only in `safe-fs.ts`. Asked for by the user before the PR. | zod v4 drops unknown keys silently, so the agent believed it had set a status that never reached the file. |

## Open points

- Ticket 10: README Limitations must name hard links and the check/open symlink race (decisions 34, 35).
- Follow-up (safe-fs): `listFiles` skips directory entries whose type the file system does not report
  (`DT_UNKNOWN` on some network/FUSE mounts). Fall back to `lstat` if that ever matters.
- Follow-up (safe-fs): `--root` given in a different letter case than on disk keeps that spelling, so
  absolute symlinks inside root may be rejected as `outside_root`. Fails closed; `realpathSync.native`
  for root would fix it.
- Ticket 10: README Limitations must name what redaction does not catch: `sk_live_…` and `ASIA…`
  keys, `Bearer`/`Basic` credentials without a digit, a user name alone in a URL
  (`https://token@host` is masked as an email instead), and phone formats with parentheses or
  without separators (`(0821) 123456`, `01701234567`). Also the false positives kept on purpose
  (decision 46).
- Follow-up (ADR parser): an unclosed code fence hides every later section, which the warning then
  reports as missing. This is CommonMark behaviour; kept.
- Ticket 09: AC22 and AC26 end to end through real tools. Decide whether the missing audit line
  for calls the SDK rejects early (decision 57) needs a fix.
- Ticket 10: README documents the frontmatter subset, the allowed ticket id characters
  (decision 69) and that `README.md` files under `--tickets-dir` are ignored.
- Ticket 10: README documents the supported ADR formats (bullet, Nygard, MADR 3) with the source
  order and the `X by …` cut (decisions 73–79), and that a leading `---` thematic break is read as
  frontmatter.
- v0.2 idea (ADR parser): expose the links of the Status section (`Superseded by` / `Amended by`
  targets) as a `links` field. Found in a real-world check against the adr-tools repository.
- Ticket 10: README Limitations must say that the targets of `Superseded by` / `Amended by` are
  not returned; the status is cut to `Superseded` (decision 74) and only `adr://` shows the link.
- Follow-up (ADR parser): the first non-empty line of a `## Status` section is taken as written, so
  `### Accepted` or a code fence there becomes the status. adr-tools never writes that. Strip
  heading markers if a real ADR needs it.
- Follow-up (redact): the overlap check is O(findings²). It takes about 100 ms for 14,000 findings,
  which is fine at the current file sizes. Use a sorted interval list if `--max-file-kb` grows a lot.
- Follow-up (search): a title that ends in a key name and a colon (`Rotate password:`) makes
  `redact()` mask `(score N)` in the text line. Over-masking only; the structured result is fine.
- Follow-up (search): a snippet has no upper length. A private key without an END line pulls in the
  rest of the file. It is redacted to one `[REDACTED:private_key]`, so nothing leaks.
- Ticket 10: README Limitations must say that search is plain keyword matching (decision 83) and
  that snippets keep line breaks.
- Ticket 10: README Limitations must say that two server processes with `--allow-write` on the
  same repository can give two drafts the same number (decision 87), and that a failed write can
  leave an empty `drafts/` directory or, on a full disk, a truncated draft.
- Follow-up (create_adr_draft): the audit `ms` of a queued call includes the time spent waiting
  for earlier calls (decision 87). Fine for drafts; split it if audit timings are ever analysed.
- Follow-up (tools): the read-only tools still use `z.object`, which drops unknown input fields
  silently. Make them strict too if an agent ever relies on a field that does not exist.
