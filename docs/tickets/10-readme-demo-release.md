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

## Acceptance criteria

- [ ] A stranger can run the demo with three commands from the README.
- [ ] `npx mcp-project-context --root examples/demo-project` starts the published server.
- [ ] Limitations section names at least: pattern-based redaction, keyword search, stdio only.
- [ ] Repo description, topics (`mcp`, `claude-code`, `typescript`) and social preview set on GitHub.
