# Worklog

One entry per ticket. This log is the evidence for "How this was built" in the README.
Be honest: mistakes caught in review are the most valuable part.

## Summary

| Metric | Value |
| --- | --- |
| Tickets done | 0 / 10 |
| Total time | 0.75 h |
| Questions the agent asked before coding | 24 |
| Agent mistakes caught in review | 0 |
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
