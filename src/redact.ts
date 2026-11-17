// Masks secrets and personal data in text that leaves the server (ADR 0003).
// Deliberately imports no logger: matched values must never be written anywhere.

// `index` is where the masked part starts. `match` is the whole pattern match, which can be wider:
// the key of an assignment, `Bearer`, `scheme://`. A snippet must not cut into it (decision 80).
export type Finding = { type: string; index: number; match: Span };

export type Span = [start: number, end: number];

type Pattern = {
  type: string;
  regex: RegExp;
  // Narrows a match to the part to mask, or rejects it with `undefined`. Default: the whole match.
  span?: (match: RegExpExecArray) => Span | undefined;
};

// Key names whose value is a secret: api_key, PAYMENT_API_KEY, apiKey, password, client_secret, …
// The lookbehind starts a match only at the start of a name; with the length bounds this keeps
// the scan linear on long runs like `a-a-a-…`. The email pattern is anchored the same way.
const SECRET_KEY =
  '(?<![A-Za-z0-9_.-])[A-Za-z0-9_.-]{0,64}' +
  '(?:api[_-]?key|access[_-]?key|secret|passw(?:or)?d|pwd|token)' +
  '[A-Za-z0-9_-]{0,64}';

// After the key: optional closing quote, an operator on the same line, then the value. A quoted
// value runs to its closing quote or the end of the line (group 2); an unquoted one to the next
// whitespace (group 3). Values that are already redacted are skipped, so redact() is idempotent.
const ASSIGNMENT =
  `${SECRET_KEY}["']?[ \t]*(?::=|=>|::|[:=])[ \t]*` +
  '(?:(["\'`])(?!\\[REDACTED:)((?:(?!\\1)[^\\n])+)\\1?|(?!\\[REDACTED:)([^\\s"\'`]+))';

// The shortest IBAN (Norway) has 15 characters.
const IBAN_MIN = 15;

// ISO 13616 check: move the first four characters to the end, letters to 10..35, mod 97 is 1.
function ibanChecksumOk(candidate: string): boolean {
  const iban = candidate.replace(/[ -]/g, '').toUpperCase();
  if (iban.length < IBAN_MIN) return false;
  let rest = 0;
  for (const char of iban.slice(4) + iban.slice(0, 4)) {
    const value = Number.parseInt(char, 36);
    rest = (value > 9 ? rest * 100 + value : rest * 10 + value) % 97;
  }
  return rest === 1;
}

// The regex may run into the next word ("… 0130 00 for"), so drop trailing groups until the
// checksum holds. Cutting only at group ends keeps a chance hit from leaving digits visible.
function ibanSpan(match: RegExpExecArray): Span | undefined {
  const value = match[0];
  for (let end = value.length; end >= IBAN_MIN; end--) {
    const atGroupEnd = end === value.length || /[ -]/.test(value.charAt(end));
    if (atGroupEnd && ibanChecksumOk(value.slice(0, end))) {
      return [match.index, match.index + end];
    }
  }
  return undefined;
}

// Order matters: when matches overlap, the earlier pattern wins. Specific types come first,
// iban before phone (its digit groups look like a phone number), assignment last.
const PATTERNS: Pattern[] = [
  {
    type: 'private_key',
    // A pasted fragment without the END line is masked to the end of the text.
    regex:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|[\s\S]*$)/g,
  },
  { type: 'aws_key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: 'github_token', regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_\w{22,})\b/g },
  { type: 'slack_token', regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { type: 'jwt', regex: /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g },
  {
    type: 'auth_header',
    // The credential after `Bearer` or `Basic`, with at least one digit so prose like
    // "Basic authentication" stays. A JWT keeps its own type (jwt runs first).
    regex: /\b(?:[Bb]earer|[Bb]asic)[ \t]+((?=[\w.~+/-]{0,512}\d)[\w.~+/-]{8,512}=*)/dg,
    span: (match) => match.indices?.[1],
  },
  {
    type: 'url_credentials',
    // `user:password` in `scheme://user:password@host`. Runs before email, which would match
    // `password@host`.
    regex: /\b[A-Za-z][A-Za-z0-9+.-]{0,20}:\/\/([^\s:/@]{1,256}:[^\s/@]{1,256})@/dg,
    span: (match) => match.indices?.[1],
  },
  {
    type: 'email',
    regex: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}\b/g,
  },
  {
    type: 'iban',
    // Any case, grouped by spaces or dashes or compact. The checksum rejects look-alikes.
    regex: /\b[A-Za-z]{2}\d{2}(?:[ -]?[A-Za-z0-9]{4}){2,7}(?:[ -]?[A-Za-z0-9]{1,3})?\b/g,
    span: ibanSpan,
  },
  {
    type: 'phone',
    // International (+49 170 1234567) or national with a leading 0 (0821 123456). Not inside
    // words, UUIDs or dates: no word character, `-` or `+` directly before or after.
    regex: /(?<![\w+-])(?:\+\d{1,3}(?:[ /-]?\d{2,8}){2,5}|0\d{2,4}[ /-]\d{4,8})(?![\w-])/g,
  },
  {
    type: 'assignment',
    // `key = value`, `key: value`, `"key": "value"`, `key := value`. Masks the value only.
    regex: new RegExp(ASSIGNMENT, 'gid'),
    span: (match) => match.indices?.[2] ?? match.indices?.[3],
  },
];

type Range = { start: number; end: number; type: string; match: Span };

/** Replaces every match with `[REDACTED:<type>]`. `index` is the offset in the original text. */
export function redact(text: string): { text: string; findings: Finding[] } {
  const ranges: Range[] = [];

  for (const { type, regex, span } of PATTERNS) {
    for (const match of text.matchAll(regex)) {
      const found: Span | undefined = span
        ? span(match)
        : [match.index, match.index + match[0].length];
      if (!found) continue;
      const [start, end] = found;
      if (ranges.some((r) => start < r.end && r.start < end)) continue;
      ranges.push({ start, end, type, match: [match.index, match.index + match[0].length] });
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

  return {
    text: out,
    findings: ranges.map(({ type, start, match }) => ({ type, index: start, match })),
  };
}
