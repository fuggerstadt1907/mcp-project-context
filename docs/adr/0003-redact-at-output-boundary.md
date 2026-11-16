# 0003: Redact once, at the output boundary

- Status: Accepted
- Date: 2026-11-16

## Context

Project docs sometimes contain secrets (pasted tokens, example credentials) and personal data
(emails, phone numbers in tickets). Anything a tool returns is sent to a model provider.
Redacting inside each source is easy to forget for new sources.

## Decision

All text leaving the server passes through a single `redact()` call in the result helper
(`src/tools/result.ts`) and in resource handlers. Sources and search work on raw text.
Matches are replaced with `[REDACTED:<type>]`. The number of findings goes to the audit log,
never the matched values.

## Consequences

- One place to test and extend. New tools are safe if they use the result helper.
- Search can still find a document by a term that is later redacted in the snippet. Acceptable.
- Redaction is pattern-based and will miss unusual secrets. The README states this limitation.
- False positives (git SHAs, UUIDs) must be covered by tests so output stays useful.
