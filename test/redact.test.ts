import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { redact } from '../src/redact.js';

const DEMO = join(import.meta.dirname, '../examples/demo-project');

function demo(rel: string): string {
  return readFileSync(join(DEMO, rel), 'utf8');
}

// Fake tokens are joined at runtime so secret scanners on push do not flag the test file.
const fake = (...parts: string[]) => parts.join('');

const PRIVATE_KEY = fake(
  '-----BEGIN RSA ',
  'PRIVATE KEY-----\nMIIEowIBAAKCAQEAfakefakefake\nZmFrZWtleQ==\n-----END RSA ',
  'PRIVATE KEY-----',
);
const JWT = fake('eyJhbGciOiJIUzI1NiJ9', '.eyJzdWIiOiIxMjM0In0', '.c2lnbmF0dXJlX2Zha2U');

describe('redact', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('masks an email address', () => {
    const result = redact('Contact: maria.beispiel@example.com, thanks');
    expect(result.text).toBe('Contact: [REDACTED:email], thanks');
    expect(result.findings).toEqual([{ type: 'email', index: 9, match: [9, 35] }]);
  });

  it.each([
    ['private_key', `key:\n${PRIVATE_KEY}\nend`, 'key:\n[REDACTED:private_key]\nend'],
    ['aws_key', 'id AKIAIOSFODNN7EXAMPLE here', 'id [REDACTED:aws_key] here'],
    ['github_token', fake('use ghp_', 'a'.repeat(36), ' now'), 'use [REDACTED:github_token] now'],
    [
      'github_token',
      fake('pat github_', 'pat_11ABCDEFG0', 'abcdefghijklmnopqrstuvwxyz'),
      'pat [REDACTED:github_token]',
    ],
    ['slack_token', fake('bot xo', 'xb-1234567890-abcdefABCDEF'), 'bot [REDACTED:slack_token]'],
    ['slack_token', fake('user xo', 'xp-1234567890-abcdefABCDEF'), 'user [REDACTED:slack_token]'],
    ['jwt', `Bearer ${JWT}`, 'Bearer [REDACTED:jwt]'],
    ['assignment', 'api_key = abc123def', 'api_key = [REDACTED:assignment]'],
    ['assignment', 'password: hunter2', 'password: [REDACTED:assignment]'],
    ['assignment', 'secret="s3cr3t"', 'secret="[REDACTED:assignment]"'],
    ['assignment', '"apiKey": "abc123"', '"apiKey": "[REDACTED:assignment]"'],
    ['email', 'mail a.b+c@sub.example.org.', 'mail [REDACTED:email].'],
    ['phone', 'call +49 170 1234567.', 'call [REDACTED:phone].'],
    ['phone', 'call 0821 123456 today', 'call [REDACTED:phone] today'],
    ['iban', 'IBAN DE89 3704 0044 0532 0130 00.', 'IBAN [REDACTED:iban].'],
    ['iban', 'IBAN DE89370400440532013000', 'IBAN [REDACTED:iban]'],
    ['iban', 'iban de89 3704 0044 0532 0130 00', 'iban [REDACTED:iban]'],
    ['iban', 'IBAN DE89-3704-0044-0532-0130-00 for rent', 'IBAN [REDACTED:iban] for rent'],
    ['iban', 'GB29 NWBK 6016 1331 9268 19 paid', '[REDACTED:iban] paid'],
  ])('masks %s', (type, input, expected) => {
    const result = redact(input);
    expect(result.text).toBe(expected);
    expect(result.findings.map((f) => f.type)).toEqual([type]);
  });

  it.each([
    [
      'auth_header',
      fake('Authorization: Bearer ', 'abc123DEF456ghi789'),
      'Authorization: Bearer [REDACTED:auth_header]',
    ],
    [
      'auth_header',
      fake('curl -H "Authorization: Basic ', 'dXNlcjpwYXNzd29yZA==', '"'),
      'curl -H "Authorization: Basic [REDACTED:auth_header]"',
    ],
    [
      'auth_header',
      fake('authorization: bearer ', 'opaque-token-42'),
      'authorization: bearer [REDACTED:auth_header]',
    ],
    [
      'url_credentials',
      fake('DATABASE_URL postgres://app:', 's3cret@db.internal:5432/app'),
      'DATABASE_URL postgres://[REDACTED:url_credentials]@db.internal:5432/app',
    ],
    [
      'url_credentials',
      fake('see https://bob:', 'hunter2@example.com/x'),
      'see https://[REDACTED:url_credentials]@example.com/x',
    ],
  ])('masks %s', (type, input, expected) => {
    const result = redact(input);
    expect(result.text).toBe(expected);
    expect(result.findings.map((f) => f.type)).toEqual([type]);
  });

  it('keeps the jwt type for a JWT after Bearer', () => {
    expect(redact(`Authorization: Bearer ${JWT}`).text).toBe(
      'Authorization: Bearer [REDACTED:jwt]',
    );
  });

  // Review findings: forms where the first version left all or part of the value visible.
  it.each([
    ['password = "correct horse battery"', 'password = "[REDACTED:assignment]"'],
    ["password: 'two words'", "password: '[REDACTED:assignment]'"],
    ['password: `abc def`', 'password: `[REDACTED:assignment]`'],
    ['token="abc', 'token="[REDACTED:assignment]'],
    ['token := abc', 'token := [REDACTED:assignment]'],
    ['password => abc', 'password => [REDACTED:assignment]'],
    ['pwd:: abc', 'pwd:: [REDACTED:assignment]'],
    ['DB_PASSWORD=p@ss,word;x', 'DB_PASSWORD=[REDACTED:assignment]'],
  ])('masks the whole assignment value in %s', (input, expected) => {
    expect(redact(input).text).toBe(expected);
  });

  it('masks a private key without an END line up to the end of the text', () => {
    const input = fake('-----BEGIN OPENSSH ', 'PRIVATE KEY-----\nb3BlbnNzaC1rZXk\ntruncated');
    expect(redact(`key:\n${input}`).text).toBe('key:\n[REDACTED:private_key]');
  });

  it.each([
    ['a git SHA', 'commit 2e96e83f0c4a1b5d6e7f8091a2b3c4d5e6f70819 merged'],
    ['a UUID', 'id 123e4567-e89b-12d3-a456-426614174000 and 0412abcd-0412-4123-8123-012345678901'],
    ['an ISO date', '- Date: 2026-03-02, at 2026-11-16T13:37:00Z'],
    ['a version', 'SDK 1.32.2 and v2.4.0'],
    [
      'a markdown table with numbers',
      '| id | count | ms |\n| --- | --- | --- |\n| 0001 | 1234 | 0821 |',
    ],
    ['prose about passwords', 'Password resets were 40 % of tickets. No password storage.'],
    ['an already redacted value', 'password: [REDACTED:email]'],
    ['a key name followed by a line break', '## Password:\n\nUse the magic link.'],
    ['IBAN-shaped text with a wrong checksum', 'HASH AB12CDEF1234567890 and US12 3456 7890 1234'],
    ['a URL without credentials', 'see https://example.com:8443/path/to?q=1&user=me#top'],
    ['prose about auth schemes', 'Basic authentication and Bearer tokens are both supported.'],
  ])('leaves %s unchanged', (_name, input) => {
    expect(redact(input)).toEqual({ text: input, findings: [] });
  });

  it('masks every finding in one text and lists each with its type', () => {
    const input = 'a@example.com, then AKIAIOSFODNN7EXAMPLE, then b@example.com';
    const result = redact(input);
    expect(result.text).toBe('[REDACTED:email], then [REDACTED:aws_key], then [REDACTED:email]');
    expect(result.findings).toEqual([
      { type: 'email', index: 0, match: [0, 13] },
      { type: 'aws_key', index: 20, match: [20, 40] },
      { type: 'email', index: 47, match: [47, 60] },
    ]);
  });

  // Known false positives, kept on purpose: masking too much beats leaking (requirements decision 46).
  it.each([
    ['Token: see below', 'Token: [REDACTED:assignment] below'],
    ['tokens: 100', 'tokens: [REDACTED:assignment]'],
    ['Order 0042 1234', 'Order [REDACTED:phone]'],
    ['git@github.com:org/repo.git', '[REDACTED:email]:org/repo.git'],
  ])('masks %s (accepted false positive)', (input, expected) => {
    expect(redact(input).text).toBe(expected);
  });

  it.each([
    ['assignment', 'password: hunter2x', [0, 18], 10],
    ['auth_header', 'Authorization: Bearer abc123defg', [15, 32], 22],
    ['url_credentials', 'see https://bob:s3cret@host', [4, 23], 12],
  ])(
    'reports the whole %s match, key included, next to the masked part',
    (_type, input, match, index) => {
      expect(redact(input).findings).toEqual([{ type: _type, index, match }]);
    },
  );

  it('prefers the specific type over assignment for the same value', () => {
    const result = redact(fake('token: ghp_', 'b'.repeat(36)));
    expect(result.text).toBe('token: [REDACTED:github_token]');
    expect(result.findings).toEqual([{ type: 'github_token', index: 7, match: [7, 47] }]);
  });

  it('always masks emails, including example domains', () => {
    expect(redact('noreply@anthropic.com and test@example.com').findings).toHaveLength(2);
  });

  it('masks the email and phone number in demo ticket T-002', () => {
    const { text } = redact(demo('tickets/T-002-guide-contact-details.md'));
    expect(text).not.toContain('maria.beispiel@example.com');
    expect(text).not.toContain('+49 170 0000000');
    expect(text).toContain('[REDACTED:email]');
    expect(text).toContain('[REDACTED:phone]');
  });

  it('masks the fake secrets in demo CONVENTIONS.md', () => {
    const { text } = redact(demo('CONVENTIONS.md'));
    expect(text).not.toContain('sk_test_FAKE');
    expect(text).not.toContain('ghp_FAKE');
    expect(text).toContain('PAYMENT_API_KEY=[REDACTED:assignment]');
  });

  it.each([
    'README.md',
    'docs/adr/0001-monorepo-with-pnpm.md',
    'docs/adr/0002-authentication-with-magic-links.md',
    'docs/adr/0003-offline-first-mobile.md',
    'docs/adr/0004-legacy-notes.md',
    'tickets/T-001-booking-confirmation-email.md',
    'tickets/T-003-login-rate-limit.md',
    'tickets/T-004-offline-bookings.md',
  ])('leaves demo %s unchanged', (rel) => {
    const input = demo(rel);
    expect(redact(input)).toEqual({ text: input, findings: [] });
  });

  it('is idempotent', () => {
    const once = redact(`password: x, ${JWT}, +49 170 1234567`).text;
    expect(redact(once)).toEqual({ text: once, findings: [] });
  });

  // Unanchored or unbounded patterns made these take over 4 s each at 100 KB. Catastrophic
  // backtracking shows up as seconds, not milliseconds, so 2 s catches it without flaking on slow CI.
  it.each([
    ['a-a-a', 'a-'.repeat(50_000)],
    ['letters', 'a'.repeat(100_000)],
    ['a long local part without @', `${'a.'.repeat(50_000)}@`],
  ])('stays fast on a 100 KB run of %s', (_name, input) => {
    const start = performance.now();
    redact(input);
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it('writes nothing to stdout or stderr', () => {
    const out = vi.spyOn(process.stdout, 'write');
    const err = vi.spyOn(process.stderr, 'write');
    redact(`password: x, maria@example.com, ${PRIVATE_KEY}`);
    expect(out).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });
});
