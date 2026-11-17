// NFR-7 / AC27: search answers in under 300 ms on 500 markdown files, reading from disk on every
// call (ADR 0004). If this fails, a cache comes back as a new ADR that supersedes ADR 0004.
// `pnpm test` runs this file on its own after the other tests, so parallel workers do not skew it.
import { describe, expect, it } from 'vitest';
import { captureIo, tempRoot, withClient } from './support.js';

captureIo();

const PARAGRAPH =
  'The booking service sends a confirmation after payment. Guides see their schedule offline ' +
  'and sync when the network is back. Errors use problem details with a clear title.\n\n';

function generate(): Record<string, string> {
  const files: Record<string, string> = {};
  for (let n = 1; n <= 250; n++) {
    const id = String(n).padStart(4, '0');
    files[`docs/adr/${id}-decision-${n}.md`] =
      `# ${id}: Decision ${n}\n\n- Status: Accepted\n- Date: 2026-01-01\n\n` +
      `## Context\n\n${PARAGRAPH.repeat(4)}## Decision\n\n${PARAGRAPH.repeat(3)}` +
      `## Consequences\n\n${PARAGRAPH.repeat(2)}`;
    files[`tickets/area-${n % 10}/T-${n}.md`] =
      `---\nid: T-${n}\ntitle: Ticket ${n}\nstatus: todo\nlabels: [api, web]\n---\n\n` +
      `${PARAGRAPH.repeat(4)}## Acceptance criteria\n\n` +
      '- [ ] The schedule loads offline\n- [x] Payment errors return 402\n';
  }
  return files;
}

describe('performance (NFR-7)', () => {
  it('answers search_context in under 300 ms on 500 markdown files (AC27)', async () => {
    const root = tempRoot(generate());

    await withClient(root, async (client) => {
      const start = performance.now();
      const result = await client.callTool({
        name: 'search_context',
        arguments: { query: 'offline payment', limit: 50 },
      });
      const ms = performance.now() - start;

      expect(result.isError).toBeFalsy();
      expect((result.structuredContent as { results: unknown[] }).results).toHaveLength(50);
      expect(ms).toBeLessThan(300);
    });
  });
});
