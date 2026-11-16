# 11 Stretch: GitHub Issues as ticket source

Labels: feature, stretch

## Goal

Teams that keep tickets in GitHub Issues get the same `list_tickets` / `get_ticket` experience.

## Scope

- Source interface `TicketSource` with implementations `LocalTicketSource` and
  `GitHubTicketSource`.
- Flag `--github-repo owner/name`. Token from `GITHUB_TOKEN` env var only, never from flags,
  never logged.
- Map issue state, labels and task-list checkboxes to the existing schema.
- This adds network access: write ADR 0004 covering opt-in, rate limits and what data leaves.

## Acceptance criteria

- [ ] Default config still has no network access (test that `fetch` is never called).
- [ ] Tests use recorded fixtures, no live API calls in CI.
- [ ] Token appears in no log line and no tool output (leak test).
