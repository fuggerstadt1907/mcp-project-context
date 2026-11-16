// Masks secrets and personal data in text that leaves the server (ADR 0003).
// Deliberately imports no logger: matched values must never be written anywhere.

export type Finding = { type: string; index: number };

type Pattern = {
  type: string;
  regex: RegExp;
  // Capture group to mask instead of the whole match (e.g. only the value of `api_key = …`).
  group?: number;
};

// Order matters: when matches overlap, the earlier pattern wins.
const PATTERNS: Pattern[] = [
  { type: 'email', regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
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
