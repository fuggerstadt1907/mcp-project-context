# Worklog

One entry per ticket. This log is the evidence for "How this was built" in the README.
Be honest: mistakes caught in review are the most valuable part.

## Summary

| Metric | Value |
| --- | --- |
| Tickets done | 3 / 10 |
| Total time | 1,25 h |
| Questions the agent asked before coding | 35 |
| Agent mistakes caught in review | 19 |
| Test coverage (src) | – |

## Template

```markdown
### Ticket NN – <title> (YYYY-MM-DD)

- Time: 1.5 h (planning 15 min, implementation 45 min, review and fixes 30 min)
- Skills used: requirements, implement-ticket, pr-review, CodeRabbit
- Questions the agent asked before coding:
  - ...
- Decisions made (and where recorded):
  - ...
- Mistakes caught in review:
  - What the agent did, why it was wrong, how it was fixed.
- PR: #
```

## Entries

### Requirements session – resolve open questions (2026-11-16)

- Time: 0.75 h
- Skills used: grill-ticket, humanizer
- Questions the agent asked before coding: 24, in 7 rounds (19 decisions, 3 frontmatter
  details, 2 on where to record them). The ones that changed the plan:
  - All six open questions from requirements §7 (ticket id source, search scope, email
    allow-list, malformed ADRs, audit file, draft numbering).
  - Cache or re-read on every call for NFR-7.
  - npm publish: the README Quickstart used `npx`, while ticket 10 called publishing optional.
  - Exact frontmatter subset: quoting styles, quoted array items, required keys.
  - Missing source directory vs. directory outside root; skipped files; duplicate ticket ids.
- Decisions made (and where recorded):
  - 20 decisions in the decision log of `docs/requirements.md`; §7 open questions closed.
  - ADR 0004 (read on every call, no cache) and ADR 0005 (audit on stderr only).
  - Tickets 01, 03–08, 10, 11 updated; ticket 11's network ADR renumbered to 0006.
- Mistakes caught in review:
  - The agent's first frontmatter proposal allowed block lists (`- item`). The user narrowed the
    subset to scalars and inline arrays and asked for it to be spelled out in the doc.
  - The agent proposed "status `Unknown`" for malformed ADRs, which contradicts ticket 05
    ("missing fields are empty strings"). It flagged this itself and updated ticket 05.
  - The agent put `AGENTS.md` first in the convention order without asking. Resolved after
    review: fixed order `CONVENTIONS.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `AGENTS.md`
    (requirements decision 21, ticket 07).
- PR: none, docs committed directly to main

### Ticket 01 – Server skeleton and CLI (2026-11-16)

- Time: 10 min
- Skills used: implement-ticket, review subagent
- Questions the agent asked before coding:
  - Where `--help`/`--version` print: stderr, so "never stdout" has no exception.
  - One commit per stage (skill) or small commits (CLAUDE.md): small commits.
  - How `config.ts` checks paths before safe-fs exists: `node:fs` directly, as a documented
    exception in CLAUDE.md; ticket 02 extracts the check.
- Decisions made (and where recorded):
  - Decisions 22 to 26 in `docs/requirements.md`; CLAUDE.md exception; extraction note in ticket 02.
- Mistakes caught in review:
  - The agent's first `listTools()` design would have failed: an `McpServer` without tools does
    not answer `tools/list` unless it declares `capabilities: { tools: {} }`. Caught by reading
    the SDK before writing the test, not in review.
  - The agent caught its own gap: a dangling symlink as source dir passed as "missing, warn".
    It now exits with 2.
  - Review subagent: ENOTDIR/EACCES while checking a source dir crashed with a stack trace and
    exit 1 instead of exit 2. Fixed with a try/catch and a test.
  - Review subagent: the prefix check `root + sep` rejected every source dir for `--root /`.
    Replaced with a `path.relative` check; tests for `/` and a dir named `..tickets`.
  - Review subagent: an empty `--adr-dir` gave zod's generic message. It now names the flag.
- Tested: 34 vitest tests (config with temp dirs and symlinks, CLI spawned via tsx for exit
  codes and stdout silence, `listTools()` via InMemoryTransport). Manually: `node dist/cli.js`
  without `--root` (exit 2), and `initialize` plus `tools/list` piped into the built CLI. stdout
  carried only JSON-RPC, stderr only JSON lines.
- Not tested: CI run (needs a push), Windows paths.
- PR: #12

### Ticket 02 – Safe file access (2026-11-16)

- Time: 20 min
- Skills used: implement-ticket, review subagent
- Questions the agent asked before coding:
  - Base branch while PR #12 was still open: wait for the merge (the user merged it meanwhile).
  - Deny list and extension on the requested path, the symlink target, or both: both.
  - `listFiles` and symlinks/oversized files: never enter symlinked dirs, list oversized files for FR-15.
  - Whether to turn the "no `node:fs` elsewhere" review check into a test: yes.
- Questions after review: EACCES handling (new reason `unreadable`), hard links (document),
  check/read race (cap the read, document the symlink race), `.env*` directories (deny as segment).
- Decisions made (and where recorded):
  - Decisions 27 to 36 in `docs/requirements.md`; follow-ups under Open points; ticket 02 updated.
- Mistakes caught in review:
  - Security: the deny list compared names case-sensitively. On macOS `NODE_MODULES/x/readme.md`,
    `.GIT/info.json` and `.ENV.json` were readable, breaking NFR-2. The ticket's examples were all
    lower case, so no test failed. Fixed with case-insensitive matching and uppercase negative tests.
  - Raw Node errors (EACCES) escaped with absolute host paths in the message, and one unreadable
    subdirectory failed the whole listing. Now `SafeFsError('unreadable')`, entries are skipped.
  - A file growing between `stat` and `readFile` bypassed the size limit. The read is now capped
    on the open handle.
  - `.env*` was denied as a file name but not as a directory, so `.env/lib/x.md` was readable.
  - `readTextFile('.')` reported `extension` instead of `not_found`.
  - `docs/architecture.md` still said `safeFs.ts`.
  - The agent's own mistake while fixing: permission tests restored modes in `onTestFinished`,
    which runs after `afterEach`, so cleanup failed. Moved the restore into `afterEach`.
- Tested: 69 vitest tests, 34 of them for safe-fs with `mkdtemp` fixtures, symlinks, chmod 000
  (skipped when running as root) and uppercase variants. The architecture test was checked against
  a probe file that imports `node:fs`.
- Not tested: the check/read race itself (no reliable test), hard links (documented as a limit),
  Windows paths, CI run (needs a push).
- PR: #13

### Ticket 03 – Redaction (2026-11-16)

- Time: <X> min agent + <Y> min review
- Skills used: implement-ticket, review subagent
- Questions the agent asked before coding (the user chose the recommended option for all four):
  - What `Finding.index` refers to: the offset in the original text.
  - How to catch `PAYMENT_API_KEY=sk_test_…` without a Stripe type: a broad `assignment` key match.
  - Overlap of `token: ghp_…`: the specific type wins, and `assignment` skips redacted values.
  - Plan, test points and branch: confirmed.
- The user added CLAUDE.md rule 7 after these questions: the agent decides implementation details
  and asks at most one round per stage. The review fixes below were decided under that rule.
- Decisions made (and where recorded):
  - Decisions 37 to 50 in `docs/requirements.md`; follow-ups and README limitations under Open
    points; ticket 03 updated.
  - After the report the user confirmed decision 46 (fail closed) and asked for two additions:
    `auth_header` and `url_credentials` (decision 49), and a 2 s timing limit (decision 50).
- Mistakes caught in review:
  - Leak: a quoted value with spaces (`password = "correct horse battery"`) or without a closing
    quote was not masked at all. The value pattern stopped at whitespace and required the closing
    quote. Now a quoted value runs to its quote or the end of the line.
  - Partial leak: `token := abc` masked only `=` and showed `abc`. The same happened for `=>` and
    `::`. These operators are now part of the pattern.
  - Partial leak: `DB_PASSWORD=p@ss,word;x` stopped at the comma. Unquoted values now run to the
    next whitespace.
  - The value could cross a line break, so `## Password:` followed by a paragraph masked its first
    word. The value must now be on the same line.
  - Leak: a lowercase or dash-separated IBAN was missed. Part of it was then masked as a phone
    number, and most digits stayed visible. IBANs now match in any case and with dashes.
  - IBAN look-alikes (`US12 3456 7890 1234`) were masked. A mod-97 checksum now rejects them.
  - Leak: a private key without its END line was not masked. It is now masked to the end of the text.
- Mistakes the agent caught itself:
  - The first email and `assignment` patterns were quadratic: 4–13 s for 100 KB inputs like
    `a-a-a…`. A timing probe before the review found it. The patterns are now anchored and
    bounded, and a test covers it.
  - The first IBAN fix tried every prefix against the checksum. One prefix passed by chance and left
    a digit visible. It now cuts only at group ends.
  - A `git add -A` swept the user's uncommitted WORKLOG note into a feature commit. That commit was
    redone without the note.
- Tested: 151 vitest tests, 68 of them in `test/redact.test.ts`. They cover:
  - every type with positive cases, including Bearer/Basic headers and credentials in URLs,
  - the AC23 false positives plus ADR prose, a newline after a key name, IBAN look-alikes, a plain
    URL and prose about auth schemes,
  - multiple findings with offsets, overlap, idempotency, and the false positives kept on purpose,
  - the demo fixtures: T-002 and CONVENTIONS.md are masked, all other demo files are unchanged,
  - 100 KB timing tests, and a stdout/stderr spy.
- Not tested:
  - The path through tools and resources (AC22 "any tool or resource"), which comes in ticket 04
    and ticket 09.
  - Formats outside the ticket table (`sk_live_`, `ASIA…`, more phone formats), which are listed
    for README Limitations.
  - Coverage, because `@vitest/coverage-v8` is not installed.
  - A CI run, which needs a push.
- PR: TODO

## Skill improvements

### 2026-11-16 · implement-ticket, first real run (ticket 01)
- Observed: skill refused `docs/tickets/01-server-skeleton.md` because it only
  accepts grill-ticket documents with a status line. Correct behaviour, but I
  passed the wrong file.
- Observed: /grill-ticket was missing from the skill list. Skills only load at
  session start; /clear does not reload them.
- Change idea: on refusal, suggest the matching requirements doc + Etappe
  instead of offering only "skip precondition".
- Change idea: map Etappe n → ticket file explicitly in the grill template.

### 2026-11-16  · implement-ticket, redaction (ticket 03)
- implement-ticket asks too many low-level questions (Finding.index, overlap handling).
  Fix: CLAUDE.md rule 7 (agent decides details, asks only on scope/output/security/ADR conflicts).
  Consider moving this rule into the skill itself.
- Never use `git add -A`; stage explicit paths. In ticket 03 it swept the user's uncommitted
  WORKLOG note into a feature commit.
