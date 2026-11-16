# 03 Redaction

Labels: security, privacy

## Goal

`redact(text)` masks secrets and personal data so they never reach the model provider.

## Scope

`src/redact.ts`:

```ts
type Finding = { type: string; index: number };
function redact(text: string): { text: string; findings: Finding[] };
```

Pattern table (one entry per type, easy to extend):

| Type | Examples to catch |
| --- | --- |
| `private_key` | `-----BEGIN ... PRIVATE KEY-----` blocks |
| `aws_key` | `AKIA` + 16 chars |
| `github_token` | `ghp_…`, `github_pat_…` |
| `slack_token` | `xoxb-…`, `xoxp-…` |
| `jwt` | three base64url parts starting with `eyJ` |
| `assignment` | `api_key = …`, `password: …`, `secret=…` (mask the value only) |
| `email` | `name@example.com` |
| `phone` | `+49 170 1234567`, `0821 123456` |
| `iban` | `DE89 3704 0044 0532 0130 00` |

Replacement: `[REDACTED:<type>]`.

## Acceptance criteria

- [ ] One positive test per type.
- [ ] False-positive tests stay unchanged: a 40-char git SHA, a UUID, an ISO date, a version
      `1.32.2`, a markdown table with numbers.
- [ ] Multiple findings in one text are all masked; `findings` lists each with its type.
- [ ] Emails are always redacted; there is no allow-list (requirements decision 3).
- [ ] The function never logs matched values.
