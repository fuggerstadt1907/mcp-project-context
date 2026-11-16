# Conventions

- TypeScript strict everywhere. No `any` without a comment explaining why.
- API errors use RFC 9457 problem details.
- Every feature PR includes tests and updates the ticket checklist.
- Dates are stored in UTC and shown in the user's time zone.

## Local setup

Copy `.env.example` to `.env`. For the sandbox payment provider use the shared test key:

```
PAYMENT_API_KEY=sk_test_FAKE_51HxDemoOnlyNotARealKey000
```

The staging deploy token is `ghp_FAKEdemoToken00000000000000000000000` (rotated monthly).

<!-- Both values above are fake fixtures. The server must return them as [REDACTED:...]. -->
