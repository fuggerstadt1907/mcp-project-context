// Masks secrets and personal data in text that leaves the server (ADR 0003).
// Deliberately imports no logger: matched values must never be written anywhere.

export type Finding = { type: string; index: number };

type Pattern = {
  type: string;
  regex: RegExp;
  // Capture group to mask instead of the whole match (e.g. only the value of `api_key = …`).
  group?: number;
};

// Key names whose value is a secret: api_key, PAYMENT_API_KEY, apiKey, password, client_secret, …
// The lookbehind starts a match only at the start of a name; with the length bounds this keeps
// the scan linear on long runs like `a-a-a-…`. The email pattern is anchored the same way.
const SECRET_KEY =
  '(?<![A-Za-z0-9_.-])[A-Za-z0-9_.-]{0,64}' +
  '(?:api[_-]?key|access[_-]?key|secret|passw(?:or)?d|pwd|token)' +
  '[A-Za-z0-9_-]{0,64}';

// Order matters: when matches overlap, the earlier pattern wins. Specific types come first,
// iban before phone (its digit groups look like a phone number), assignment last.
const PATTERNS: Pattern[] = [
  {
    type: 'private_key',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { type: 'aws_key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: 'github_token', regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_\w{22,})\b/g },
  { type: 'slack_token', regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { type: 'jwt', regex: /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g },
  {
    type: 'email',
    regex: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}\b/g,
  },
  { type: 'iban', regex: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g },
  {
    type: 'phone',
    // International (+49 170 1234567) or national with a leading 0 (0821 123456). Not inside
    // words, UUIDs or dates: no word character, `-` or `+` directly before or after.
    regex: /(?<![\w+-])(?:\+\d{1,3}(?:[ /-]?\d{2,8}){2,5}|0\d{2,4}[ /-]\d{4,8})(?![\w-])/g,
  },
  {
    type: 'assignment',
    // `key = value`, `key: value`, `"key": "value"`. Masks the value only and skips values that
    // are already redacted, so redact() is idempotent.
    regex: new RegExp(
      String.raw`${SECRET_KEY}["']?\s*[:=]\s*(["'\x60]?)(?!\[REDACTED:)([^\s"'\x60,;]+)\1`,
      'gid',
    ),
    group: 2,
  },
];

type Range = { start: number; end: number; type: string };

/** Replaces every match with `[REDACTED:<type>]`. `index` is the offset in the original text. */
export function redact(text: string): { text: string; findings: Finding[] } {
  const ranges: Range[] = [];

  for (const { type, regex, group } of PATTERNS) {
    for (const match of text.matchAll(regex)) {
      const span = group === undefined ? match.indices?.[0] : match.indices?.[group];
      const [start, end] = span ?? [match.index, match.index + match[0].length];
      if (ranges.some((r) => start < r.end && r.start < end)) continue;
      ranges.push({ start, end, type });
    }
  }

  ranges.sort((a, b) => a.start - b.start);

  let out = '';
  let cursor = 0;
  for (const { start, end, type } of ranges) {
    out += `${text.slice(cursor, start)}[REDACTED:${type}]`;
    cursor = end;
  }
  out += text.slice(cursor);

  return { text: out, findings: ranges.map(({ type, start }) => ({ type, index: start })) };
}
