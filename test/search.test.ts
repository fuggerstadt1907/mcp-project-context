import { describe, expect, it } from 'vitest';
import { redact } from '../src/redact.js';
import { snippetAround } from '../src/search.js';
import { call, captureIo, connect, DEMO, tempRoot, text } from './support.js';

// Fake secrets are joined at runtime so secret scanning on push does not flag this file.
const fake = (...parts: string[]) => parts.join('');

const { logLines } = captureIo();

type Result = { kind: string; id: string; title: string; score: number; snippet: string };

function results(result: { structuredContent?: unknown }): Result[] {
  return (result.structuredContent as { results: Result[] }).results;
}

function keys(result: { structuredContent?: unknown }): string[] {
  return results(result).map((entry) => `${entry.kind}:${entry.id}`);
}

const ticket = (id: string, title: string, body: string, labels = '[]') =>
  `---\nid: ${id}\ntitle: ${title}\nstatus: todo\nlabels: ${labels}\n---\n\n${body}`;

const adr = (title: string, decision: string) =>
  `# ${title}\n\n- Status: Accepted\n- Date: 2026-01-01\n\n## Context\n\nSome context.\n\n` +
  `## Decision\n\n${decision}\n\n## Consequences\n\nNone.\n`;

describe('search_context tool', () => {
  it('is listed as a read-only tool with an output schema', async () => {
    const client = await connect(DEMO);
    const { tools } = await client.listTools();
    await client.close();

    const tool = tools.find((candidate) => candidate.name === 'search_context');
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.outputSchema).toBeDefined();
    expect(tool?.description).toContain('"authentication"');
  });

  it('returns ADR 0002 first for "authentication" on the demo project (AC8)', async () => {
    const result = await call(DEMO, 'search_context', { query: 'authentication' });

    expect(result.isError).toBeFalsy();
    expect(keys(result)[0]).toBe('adr:0002');
    expect(keys(result)).toContain('ticket:T-003');
    const [first] = results(result);
    expect(first).toMatchObject({ title: 'Authentication with magic links' });
    expect(first?.snippet).toContain('authentication');
    expect(text(result)).toMatch(
      /^1\. adr 0002 {2}Authentication with magic links {2}\(score \d+\)\n {3}\S/,
    );
  });

  it('finds a ticket whose only match is in an acceptance criterion (AC9)', async () => {
    const root = tempRoot({
      'tickets/T-001.md': ticket(
        'T-001',
        'Rate limit',
        'Limit requests.\n\n## Acceptance criteria\n\n- [ ] Too many requests return 429\n',
      ),
      'tickets/T-002.md': ticket('T-002', 'Other', 'Nothing here.\n'),
    });

    const result = await call(root, 'search_context', { query: '429' });

    expect(keys(result)).toEqual(['ticket:T-001']);
    expect(results(result)[0]?.snippet).toContain('return 429');
  });

  it('finds the demo ticket T-003 by its acceptance criterion "429"', async () => {
    const result = await call(DEMO, 'search_context', { query: '429' });
    expect(keys(result)).toEqual(['ticket:T-003']);
  });

  it('searches ticket labels', async () => {
    const root = tempRoot({ 'tickets/T-001.md': ticket('T-001', 'One', 'Body.\n', '[payments]') });
    const result = await call(root, 'search_context', { query: 'payments' });
    expect(keys(result)).toEqual(['ticket:T-001']);
  });

  it.each(['', '   ', '\n\t'])('returns a tool error for the empty query %j', async (query) => {
    const result = await call(DEMO, 'search_context', { query });

    expect(result.isError).toBe(true);
    expect(text(result)).toBe('The query is empty. Pass one or more words, e.g. "authentication".');
    expect(logLines()).toContainEqual(
      expect.objectContaining({ event: 'tool_call', tool: 'search_context', ok: false }),
    );
  });

  it('ranks a title match above body matches', async () => {
    const root = tempRoot({
      'docs/adr/0001-a.md': adr('Caching', 'We talk about logging, logging and logging.'),
      'docs/adr/0002-b.md': adr('Logging', 'Use structured lines.'),
    });

    const result = await call(root, 'search_context', { query: 'logging' });

    expect(keys(result)).toEqual(['adr:0002', 'adr:0001']);
    expect(results(result).map((entry) => entry.score)).toEqual([5, 3]);
  });

  it('counts every word of the query, case-insensitively', async () => {
    const root = tempRoot({
      'docs/adr/0001-a.md': adr('One', 'Use REDIS for the queue.'),
      'docs/adr/0002-b.md': adr('Two', 'Use redis for the session cache.'),
      'docs/adr/0003-c.md': adr('Three', 'Nothing related.'),
    });

    const result = await call(root, 'search_context', { query: 'Redis  CACHE redis' });

    expect(keys(result)).toEqual(['adr:0002', 'adr:0001']);
    expect(results(result).map((entry) => entry.score)).toEqual([2, 1]);
  });

  it('treats the query as text, not as a pattern', async () => {
    const root = tempRoot({ 'docs/adr/0001-a.md': adr('One', 'Matches a.b only.') });
    expect(keys(await call(root, 'search_context', { query: 'a.b' }))).toEqual(['adr:0001']);
    expect(keys(await call(root, 'search_context', { query: 'a*' }))).toEqual([]);
  });

  it('breaks ties by kind, then by id with numbers by value', async () => {
    const root = tempRoot({
      'CONVENTIONS.md': 'Use zebra.\n',
      'tickets/T-10.md': ticket('T-10', 'Ten', 'Use zebra.\n'),
      'tickets/T-2.md': ticket('T-2', 'Two', 'Use zebra.\n'),
      'docs/adr/0001-a.md': adr('One', 'Use zebra.'),
    });

    const result = await call(root, 'search_context', { query: 'zebra' });

    expect(keys(result)).toEqual([
      'adr:0001',
      'ticket:T-2',
      'ticket:T-10',
      'convention:CONVENTIONS.md',
    ]);
  });

  it('filters by kinds; an empty list means all kinds', async () => {
    const demoKinds = async (kinds: string[]) =>
      keys(await call(DEMO, 'search_context', { query: 'magic', kinds }));

    expect(await demoKinds(['ticket'])).toEqual(['ticket:T-003']);
    expect((await demoKinds(['adr'])).every((key) => key.startsWith('adr:'))).toBe(true);
    expect(await demoKinds([])).toEqual(
      keys(await call(DEMO, 'search_context', { query: 'magic' })),
    );
  });

  it('returns at most limit results, 10 by default', async () => {
    const files: Record<string, string> = {};
    for (let n = 1; n <= 12; n++) files[`tickets/T-${n}.md`] = ticket(`T-${n}`, 'X', 'apple\n');
    const root = tempRoot(files);

    expect(results(await call(root, 'search_context', { query: 'apple' }))).toHaveLength(10);
    expect(results(await call(root, 'search_context', { query: 'apple', limit: 3 }))).toHaveLength(
      3,
    );
  });

  it.each([0, 51, 2.5])('rejects limit %s', async (limit) => {
    const result = await call(DEMO, 'search_context', { query: 'magic', limit });
    expect(result.isError).toBe(true);
  });

  it('does not search ADR drafts', async () => {
    const root = tempRoot({
      'docs/adr/0001-a.md': adr('One', 'Nothing.'),
      'docs/adr/drafts/0002-draft.md': adr('Draft', 'Use unicorns.'),
    });
    expect(keys(await call(root, 'search_context', { query: 'unicorns' }))).toEqual([]);
  });

  it('says so when nothing matches', async () => {
    const result = await call(DEMO, 'search_context', { query: ' xyzzy ' });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ results: [] });
    expect(text(result)).toBe('No matches for "xyzzy".');
  });

  it('leaves out files over --max-file-kb and counts them (FR-15)', async () => {
    const root = tempRoot({
      'tickets/T-001.md': ticket('T-001', 'Small', 'apple\n'),
      'tickets/T-002.md': ticket('T-002', 'Big', `apple ${'x'.repeat(2048)}\n`),
      'CONVENTIONS.md': `apple ${'x'.repeat(2048)}\n`,
    });

    const result = await call(root, 'search_context', { query: 'apple' }, { maxFileKb: 1 });

    expect(keys(result)).toEqual(['ticket:T-001']);
    expect(text(result)).toContain('2 files skipped (too large).');
  });

  it('only counts skipped files of the kinds searched', async () => {
    const root = tempRoot({
      'tickets/T-001.md': ticket('T-001', 'Small', 'apple\n'),
      'CONVENTIONS.md': `apple ${'x'.repeat(2048)}\n`,
    });
    const result = await call(
      root,
      'search_context',
      { query: 'apple', kinds: ['ticket'] },
      { maxFileKb: 1 },
    );
    expect(text(result)).not.toContain('skipped');
  });

  it.each(['sk_test', 'FAKE', 'PAYMENT_API_KEY', 'staging deploy token'])(
    'never returns the demo fake secrets, query %j',
    async (query) => {
      const result = await call(DEMO, 'search_context', { query, kinds: ['convention'] });
      const output = JSON.stringify(result);

      expect(keys(result)).toEqual(['convention:CONVENTIONS.md']);
      expect(output).not.toContain('sk_test_FAKE');
      expect(output).not.toContain('ghp_FAKE');
      expect(output).not.toContain('NotARealKey');
      expect(output).not.toContain('FAKEdemoToken');
      expect(output).toContain('[REDACTED:');
    },
  );

  it('finds a ticket by a term that is redacted in the snippet (ADR 0003)', async () => {
    const result = await call(DEMO, 'search_context', { query: 'example.com', kinds: ['ticket'] });
    const output = JSON.stringify(result);

    expect(keys(result)).toContain('ticket:T-002');
    expect(output).not.toMatch(/[A-Za-z0-9._%+-]+@example\.com/);
    expect(output).toContain('[REDACTED:email]');
  });
});

describe('snippetAround', () => {
  it('shows about 200 characters around the match, cut at whitespace, on one line', () => {
    const words = Array.from({ length: 100 }, (_, n) => `word${n}`);
    const textIn = `${words.slice(0, 50).join(' ')}\n\nNEEDLE\n${words.slice(50).join(' ')}`;

    const snippet = snippetAround(textIn, textIn.indexOf('NEEDLE'));

    expect(snippet).toContain('NEEDLE');
    expect(snippet.startsWith('…word')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).not.toContain('\n');
    expect(snippet.length).toBeGreaterThan(180);
    expect(snippet.length).toBeLessThan(240);
  });

  it('starts at the beginning of a short text without an ellipsis', () => {
    expect(snippetAround('Short text with NEEDLE.', 16)).toBe('Short text with NEEDLE.');
  });

  // Requirements decision 80: a cut through the key or the value of a secret leaves text that no
  // longer matches its pattern, so redact() at the output boundary would let part of it through.
  const filler = '|'.repeat(150);
  const secrets = {
    assignment: fake('DB_PASS', 'WORD=Zq7Wv3Kp9Lm2'),
    authHeader: fake('Authorization: Bear', 'er Yr8Xu4Jn6Hb1'),
    urlCredentials: fake('https://bob:', 'Tc5Sd2Fg7Qw3@db.internal'),
    githubToken: fake('ghp_', 'Kd9Pq2Rs5Tu8Vw1Xy4Za7Bc0De3Fg6Hi9Jk2'),
    privateKey: fake(
      '-----BEGIN RSA PRIV',
      'ATE KEY-----\nMIIEowIBAAKCAQEAuV3nT9qR\nGh5Lp0Wm8Xc2Nb7==\n-----END RSA PRIVATE KEY-----',
    ),
  };
  const values = ['Zq7Wv3Kp9Lm2', 'Yr8Xu4Jn6Hb1', 'Tc5Sd2Fg7Qw3', 'Kd9Pq2Rs5Tu8', 'uV3nT9qR'];

  it.each(Object.entries(secrets))(
    'never cuts the %s secret, wherever the window falls',
    (_name, secret) => {
      // Long enough on both sides that each window edge lands on every character of the secret.
      const textIn = `${filler}${filler}${secret}${filler}${filler}`;
      expect(redact(textIn).findings).toHaveLength(1);

      for (let at = 0; at <= textIn.length; at++) {
        const shown = redact(snippetAround(textIn, at)).text;
        for (const value of values) {
          for (let i = 0; i + 4 <= value.length; i++) {
            expect(shown, `at ${at}`).not.toContain(value.slice(i, i + 4));
          }
        }
      }
    },
  );

  it('moves the start back to the key when the window would begin inside it', () => {
    const textIn = `${filler}${secrets.assignment}${filler}${filler}`;
    const keyStart = textIn.indexOf('DB_');
    // A window starting 4 characters into the key would show "PASSWORD=…" without "DB_" (still a
    // match) and 8 in would show "WORD=…", which no pattern matches.
    for (const offset of [4, 8]) {
      const snippet = snippetAround(textIn, keyStart + offset + 60);
      expect(snippet.startsWith(fake('…DB_PASS', 'WORD='))).toBe(true);
    }
  });

  it('moves the start back over "Bearer" and the URL scheme', () => {
    for (const secret of [secrets.authHeader, secrets.urlCredentials]) {
      const textIn = `${filler}${secret}${filler}${filler}`;
      const matchStart = redact(textIn).findings[0]?.match[0] as number;
      const snippet = snippetAround(textIn, matchStart + 3 + 60);
      expect(snippet.slice(1).startsWith(textIn.slice(matchStart, matchStart + 6))).toBe(true);
    }
  });

  it('moves the end forward when the window would stop inside a secret', () => {
    const textIn = `${'|'.repeat(150)}${secrets.githubToken}${filler}`;
    const snippet = snippetAround(textIn, 10);
    expect(snippet).toContain(secrets.githubToken);
    expect(redact(snippet).text).toContain('[REDACTED:github_token]');
  });
});
