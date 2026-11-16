# 0002: Authentication with magic links

- Status: Accepted
- Date: 2026-04-14

## Context

Most users book once or twice a year and forget passwords. Password resets were 40 % of support
requests in the pilot. Social login was rejected by two partner agencies for privacy reasons.

## Decision

Passwordless authentication with email magic links. Links expire after 15 minutes and are
single use. Sessions last 30 days and are stored as HTTP-only cookies.

## Consequences

- No password storage, no reset flow.
- Login depends on email delivery; we monitor bounce rates.
- The mobile app opens links via universal links / app links.
