---
id: T-003
title: Rate-limit magic link requests
status: todo
labels: [api, security]
---

Attackers can flood a user's inbox by requesting magic links repeatedly. Limit requests per email
address and per IP. Check the authentication ADR before implementing.

## Acceptance criteria

- [ ] Max 5 link requests per email per hour
- [ ] Max 20 requests per IP per hour
- [ ] Exceeding the limit returns a problem details response with status 429
- [ ] Limits are configurable via environment variables
