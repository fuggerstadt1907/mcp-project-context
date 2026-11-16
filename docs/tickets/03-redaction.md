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

Replacement: `[REDACTED:<type>]`. `index` is the offset in the original text. When matches overlap,
the specific type wins over `assignment`, and `redact()` is idempotent. The forms each type
catches, the false positives kept on purpose and the runtime bounds are in requirements decisions
37 to 39 and 41 to 49. Decision 49 adds `auth_header` and `url_credentials`.

## Acceptance criteria

- [x] One positive test per type.
- [x] False-positive tests stay unchanged: a 40-char git SHA, a UUID, an ISO date, a version
      `1.32.2`, a markdown table with numbers.
- [x] Multiple findings in one text are all masked; `findings` lists each with its type.
- [x] Emails are always redacted; there is no allow-list (requirements decision 3).
- [x] The function never logs matched values.
