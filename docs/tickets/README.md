# Tickets

Work them in order. Each ticket is one PR. Create them as GitHub issues with
`scripts/create-issues.sh` so PRs can close them (`Closes #3`).

| # | Ticket | Depends on | Size |
| --- | --- | --- | --- |
| 01 | [Server skeleton and CLI](01-server-skeleton.md) | – | S |
| 02 | [Safe file access](02-safe-file-access.md) | 01 | M |
| 03 | [Redaction](03-redaction.md) | 01 | M |
| 04 | [Result helper and audit log](04-result-helper-audit.md) | 02, 03 | S |
| 05 | [ADR tools and resource](05-adr-tools.md) | 04 | M |
| 06 | [Ticket tools and resource](06-ticket-tools.md) | 04 | M |
| 07 | [Conventions and search](07-conventions-search.md) | 05, 06 | M |
| 08 | [Write tool behind flag](08-write-tool.md) | 05 | S |
| 09 | [Integration tests and stdio smoke test](09-integration-tests.md) | 07, 08 | S |
| 10 | [README, demo, release](10-readme-demo-release.md) | 09 | S |
| 11 | [Stretch: GitHub Issues source](11-stretch-github-issues.md) | 06 | M |

Size: S ≈ 1–2 h, M ≈ 2–4 h with an agent, including review.

Tickets 01–04 are the foundation. 05 and 06 can run in parallel.
Some tickets reference open questions from `docs/requirements.md` §7. Resolve them first.
