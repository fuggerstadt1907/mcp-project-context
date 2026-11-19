# 10 README, demo, release

Labels: docs

## Goal

A reviewer understands the project in two minutes and sees how it was built.

## Scope

- Fill the TODO sections in `README.md`: Demo, How this was built, Limitations.
- Record a short GIF or video: Claude Code in the demo project, asking
  "Implement ticket T-003, check the relevant ADR first." Show the tool calls.
- "How this was built": numbers from `docs/WORKLOG.md` (total hours, tickets, questions the agent
  asked before coding, mistakes caught in review) plus one concrete example of a caught mistake.
- Tag `v0.1.0`, GitHub release with changelog.
- `npm publish` as `mcp-project-context` (requirements NFR-9; the name was free on 2026-11-16).
  `dist/cli.js` needs a `#!/usr/bin/env node` shebang (tsup `banner`).
- README: document the frontmatter subset and that the audit log goes to stderr (ADR 0005).
- README: document the supported ADR formats (bullet, Nygard, MADR 3), the source order and the
  `X by …` status cut (requirements decisions 73–77).

## Decisions

Recorded as requirements decisions 100–104: `.mcp.json` in the demo project for three commands
(100), publishing from CI with provenance and a tarball check (101), the GIF recorded from the local
build before the merge (102), the counting rule for the WORKLOG numbers (103), the shebang in
`src/cli.ts` instead of a tsup banner and `npx -y` (104).

## Acceptance criteria

- [ ] A stranger can run the demo with three commands from the README.
- [ ] `npx mcp-project-context --root examples/demo-project` starts the published server.
- [x] Limitations section names at least: pattern-based redaction, keyword search, stdio only.
- [ ] Repo description, topics (`mcp`, `claude-code`, `typescript`) and social preview set on GitHub.

## After the merge

Not part of the PR; done in this order.

- [ ] User: record `docs/assets/demo.gif` from the local build before the merge (decision 102).
- [ ] User: create the `NPM_TOKEN` repository secret (granular token, publish rights).
- [ ] User: tag `v0.1.0` on `main` and push it; `release.yml` publishes to npm with provenance.
- [ ] Agent, after the user's OK: GitHub release `v0.1.0` with the 0.1.0 section of
      `CHANGELOG.md`, repo description and topics via `gh`.
- [ ] User: upload the social preview image (no API for it).
- [ ] User: `npx mcp-project-context --root examples/demo-project` against the published package
      (AC28), and the three demo commands in a fresh clone.
- [ ] User: set up npm Trusted Publishing and remove `NPM_TOKEN` (open points).
