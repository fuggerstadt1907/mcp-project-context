// NFR-7 / AC27: search answers on 500 markdown files within the limit, reading from disk on every
// call (ADR 0004). If this fails, a cache comes back as a new ADR that supersedes ADR 0004.
// `pnpm test` runs this file on its own after the other tests, so parallel workers do not skew it.
// The median of several first calls on fresh servers decides, so one slow run on a busy machine
// does not fail it. CI gets a wider limit; a real regression (a ReDoS pattern) costs seconds.
import { describe, expect, it } from 'vitest';
import { captureIo, tempRoot, withClient } from './support.js';

captureIo();

const RUNS = 5;
const LOCAL_LIMIT_MS = 300;
const CI_LIMIT_MS = 1000;

/** 1 s when the `CI` variable is set (GitHub Actions sets `CI=true`), else 300 ms. */
function perfLimitMs(env: NodeJS.ProcessEnv): number {
  const ci = env.CI;
  return ci !== undefined && ci !== '' && ci !== 'false' && ci !== '0'
    ? CI_LIMIT_MS
    : LOCAL_LIMIT_MS;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

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

/** Time of the first `search_context` call on a fresh server, as an agent's first request. */
async function firstCallMs(root: string): Promise<number> {
  return withClient(root, async (client) => {
    const start = performance.now();
    const result = await client.callTool({
      name: 'search_context',
      arguments: { query: 'offline payment', limit: 50 },
    });
    const ms = performance.now() - start;
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { results: unknown[] }).results).toHaveLength(50);
    return ms;
  });
}

describe('performance limit', () => {
  it.each([
    [{ CI: 'true' }, CI_LIMIT_MS],
    [{ CI: '1' }, CI_LIMIT_MS],
    [{}, LOCAL_LIMIT_MS],
    [{ CI: '' }, LOCAL_LIMIT_MS],
    [{ CI: 'false' }, LOCAL_LIMIT_MS],
    [{ CI: '0' }, LOCAL_LIMIT_MS],
  ])('uses %o -> %i ms', (env, limit) => {
    expect(perfLimitMs(env)).toBe(limit);
  });

  it('takes the median', () => {
    expect(median([5, 1, 900, 3, 2])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('performance (NFR-7)', () => {
  const limit = perfLimitMs(process.env);

  it(`answers search_context on 500 markdown files, median under ${limit} ms (AC27)`, async () => {
    const root = tempRoot(generate());
    const timings: number[] = [];
    for (let run = 0; run < RUNS; run++) timings.push(await firstCallMs(root));

    const result = median(timings);
    const runs = timings.map((ms) => Math.round(ms)).join(', ');
    expect(
      result,
      `median ${Math.round(result)} ms of [${runs}] ms, limit ${limit} ms`,
    ).toBeLessThan(limit);
  }, 60_000); // Room for five slow runs, so a regression fails on the median, not the 5 s default.
});
