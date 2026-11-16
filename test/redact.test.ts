import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { redact } from '../src/redact.js';

const DEMO = join(import.meta.dirname, '../examples/demo-project');

function demo(rel: string): string {
  return readFileSync(join(DEMO, rel), 'utf8');
}

describe('redact', () => {
  it('masks an email address', () => {
    const result = redact('Contact: maria.beispiel@example.com, thanks');
    expect(result.text).toBe('Contact: [REDACTED:email], thanks');
    expect(result.findings).toEqual([{ type: 'email', index: 9 }]);
  });

  it('masks the email in demo ticket T-002', () => {
    const { text } = redact(demo('tickets/T-002-guide-contact-details.md'));
    expect(text).not.toContain('maria.beispiel@example.com');
    expect(text).toContain('[REDACTED:email]');
  });
});
