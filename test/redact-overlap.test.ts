// Invariant for overlapping patterns: every character that any single pattern masks on its own is
// also masked in the combined output. Cases pair all 11 types side by side, put one secret inside
// another's value and nest two values (requirements decision 86).
import { describe, expect, it } from 'vitest';
import { patternMatches, redact } from '../src/redact.js';

// Fake secrets are joined at runtime so secret scanning on push does not flag this file.
const fake = (...parts: string[]) => parts.join('');

const SAMPLES: Record<string, string> = {
  private_key: fake(
    '-----BEGIN RSA PRIV',
    'ATE KEY-----\nMIIEowIBAAKCAQEAuV3nT9qR\n-----END RSA PRIVATE KEY-----',
  ),
  aws_key: fake('AKIA', 'IOSFODNN7EXAMPLE'),
  github_token: fake('ghp_', 'Kd9Pq2Rs5Tu8Vw1Xy4Za7Bc0De3Fg6Hi9Jk2'),
  slack_token: fake('xoxb-', '1234567890-abcdefABCDEF'),
  jwt: fake('eyJhbGciOiJIUzI1NiJ9', '.eyJzdWIiOiIxMjM0In0', '.c2lnbmF0dXJlX2Zha2U'),
  auth_header: fake('Bearer ', 'abc123defgh'),
  url_credentials: fake('https://bob:', 'pw12secret@db.internal'),
  email: fake('jane.doe', '@', 'example.com'),
  iban: 'DE89 3704 0044 0532 0130 00',
  phone: '+49 170 1234567',
  assignment: fake('pass', 'word = hunter2xyz'),
};

// Values that can hold another secret. `$` is the slot.
const CONTAINERS: Record<string, string> = {
  'assignment (quoted)': fake('pass', 'word = "pre $ post"'),
  'assignment (unquoted)': fake('api_', 'key=$'),
  auth_header: 'Authorization: Bearer $',
  url_credentials: 'https://bob:$@db.internal',
};

const fill = (container: string, value: string) => container.replace('$', () => value);

function cases(): [string, string][] {
  const out: [string, string][] = [];
  const types = Object.entries(SAMPLES);
  for (const [a, sa] of types) {
    out.push([`${a} alone`, `x ${sa} y`]);
    for (const [b, sb] of types) {
      out.push([`${a} + ${b} side by side`, `${sa} ${sb}`]);
      out.push([`${a} + ${b} on two lines`, `${sa}\n${sb}`]);
      out.push([`${a} + ${b} after a comma`, `${sa},${sb}`]);
    }
  }
  for (const [c, container] of Object.entries(CONTAINERS)) {
    for (const [b, sb] of types) {
      out.push([`${b} inside ${c}`, fill(container, sb)]);
      for (const [c2, inner] of Object.entries(CONTAINERS)) {
        out.push([`${b} inside ${c2} inside ${c}`, fill(container, fill(inner, sb))]);
      }
    }
  }
  return out;
}

/** Offsets that a single pattern masks on its own but the combined output leaves visible. */
function uncovered(text: string): { type: string; visible: string }[] {
  const masked = new Uint8Array(text.length);
  for (const { index, end } of redact(text).findings) masked.fill(1, index, end);
  const misses: { type: string; visible: string }[] = [];
  for (const { type, span } of patternMatches(text)) {
    const visible = [...text.slice(span[0], span[1])]
      .filter((_, offset) => masked[span[0] + offset] === 0)
      .join('');
    if (visible !== '') misses.push({ type, visible });
  }
  return misses;
}

describe('redact() with overlapping patterns', () => {
  it('has a sample for every pattern type', () => {
    const types = new Set(patternMatches(Object.values(SAMPLES).join('\n')).map((m) => m.type));
    expect([...types].sort()).toEqual(Object.keys(SAMPLES).sort());
  });

  it.each(cases())('masks everything any single pattern masks: %s', (_name, text) => {
    expect(uncovered(text)).toEqual([]);
  });
});
