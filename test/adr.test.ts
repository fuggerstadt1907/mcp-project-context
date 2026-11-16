import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { type CallToolResult, InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import { createServer } from '../src/server.js';

const DEMO = realpathSync(join(import.meta.dirname, '../examples/demo-project'));
const EMAIL = ['jane.doe', '@', 'example.com'].join('');

let stderr: string[];
let stdout: ReturnType<typeof vi.spyOn>;
let tempRoots: string[] = [];

beforeEach(() => {
  stderr = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  stdout = vi.spyOn(process.stdout, 'write');
});

afterEach(() => {
  expect(stdout).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  tempRoots = [];
});

function logLines(): Record<string, unknown>[] {
  return stderr
    .join('')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function tempRoot(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'adr-test-')));
  tempRoots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

async function connect(root: string, overrides: Partial<Config> = {}): Promise<Client> {
  const config: Config = {
    root,
    adrDir: 'docs/adr',
    ticketsDir: 'tickets',
    maxFileKb: 256,
    allowWrite: false,
    ...overrides,
  };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(config).connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

async function call(
  root: string,
  name: string,
  args: Record<string, unknown> = {},
  overrides: Partial<Config> = {},
): Promise<CallToolResult> {
  const client = await connect(root, overrides);
  try {
    return (await client.callTool({ name, arguments: args })) as CallToolResult;
  } finally {
    await client.close();
  }
}

function text(result: CallToolResult): string {
  return (result.content[0] as { text: string }).text;
}

const adr = (title: string, status: string, decision = 'We do it.') =>
  `# ${title}\n\n- Status: ${status}\n- Date: 2026-01-01\n\n## Context\n\nWhy.\n\n` +
  `## Decision\n\n${decision}\n\n## Consequences\n\n- Some.\n`;

describe('tool list', () => {
  it('lists list_adrs and get_adr as read-only tools with an output schema', async () => {
    const client = await connect(DEMO);
    const { tools } = await client.listTools();
    await client.close();

    for (const name of ['list_adrs', 'get_adr']) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool?.annotations?.readOnlyHint).toBe(true);
      expect(tool?.outputSchema).toBeDefined();
      expect(tool?.description).toMatch(/"\d{4}"/);
    }
  });
});

describe('list_adrs', () => {
  it('lists all demo ADRs sorted by id', async () => {
    const result = await call(DEMO, 'list_adrs');

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      adrs: [
        {
          id: '0001',
          title: 'Monorepo with pnpm workspaces',
          status: 'Accepted',
          date: '2026-03-02',
        },
        {
          id: '0002',
          title: 'Authentication with magic links',
          status: 'Accepted',
          date: '2026-04-14',
        },
        {
          id: '0003',
          title: 'Offline-first mobile bookings list',
          status: 'Proposed',
          date: '2026-09-21',
        },
        { id: '0004', title: 'Notes from the old wiki', status: 'Unknown', date: '' },
      ],
    });
    expect(text(result)).toContain('0001  Monorepo with pnpm workspaces  (Accepted, 2026-03-02)');
    expect(text(result)).toContain('0004  Notes from the old wiki  (Unknown)');
  });

  it.each(['accepted', 'ACCEPTED', ' Accepted '])(
    'filters status %j case-insensitively (AC3)',
    async (status) => {
      const result = await call(DEMO, 'list_adrs', { status });
      const ids = (result.structuredContent as { adrs: { id: string }[] }).adrs.map((a) => a.id);
      expect(ids).toEqual(['0001', '0002']);
    },
  );

  it('matches the status exactly, not as a substring', async () => {
    const result = await call(DEMO, 'list_adrs', { status: 'accept' });

    expect(result.structuredContent).toEqual({ adrs: [] });
    expect(text(result)).toBe('No ADRs with status "accept".');
  });

  it('filters on status Unknown for malformed ADRs', async () => {
    const result = await call(DEMO, 'list_adrs', { status: 'unknown' });
    const ids = (result.structuredContent as { adrs: { id: string }[] }).adrs.map((a) => a.id);
    expect(ids).toEqual(['0004']);
  });

  it('ignores drafts/, subdirectories and files without a number prefix', async () => {
    const root = tempRoot({
      'docs/adr/0001-one.md': adr('0001: One', 'Accepted'),
      'docs/adr/README.md': '# ADRs\n',
      'docs/adr/template.md': adr('NNNN: Title', 'Proposed'),
      'docs/adr/drafts/0002-draft.md': adr('0002: Draft', 'Draft'),
      'docs/adr/old/0003-old.md': adr('0003: Old', 'Superseded'),
      'docs/adr/0004-notes.txt': 'not markdown',
    });

    const result = await call(root, 'list_adrs');

    const ids = (result.structuredContent as { adrs: { id: string }[] }).adrs.map((a) => a.id);
    expect(ids).toEqual(['0001']);
  });

  it('sorts by number, also past 9999', async () => {
    const root = tempRoot({
      'docs/adr/10000-big.md': adr('10000: Big', 'Accepted'),
      'docs/adr/0002-two.md': adr('0002: Two', 'Accepted'),
      'docs/adr/0010-ten.md': adr('0010: Ten', 'Accepted'),
    });

    const result = await call(root, 'list_adrs');

    const ids = (result.structuredContent as { adrs: { id: string }[] }).adrs.map((a) => a.id);
    expect(ids).toEqual(['0002', '0010', '10000']);
  });

  it('keeps the first file for a duplicate number and warns with both paths', async () => {
    const root = tempRoot({
      'docs/adr/0001-a.md': adr('0001: A', 'Accepted'),
      'docs/adr/1-b.md': adr('0001: B', 'Accepted'),
    });

    const result = await call(root, 'list_adrs');

    expect(result.structuredContent).toEqual({
      adrs: [expect.objectContaining({ id: '0001', title: 'A' })],
    });
    expect(logLines()).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        msg: 'duplicate ADR id, keeping the first file',
        files: ['docs/adr/0001-a.md', 'docs/adr/1-b.md'],
      }),
    );
  });

  it('leaves out a file over --max-file-kb and says so (FR-15)', async () => {
    const root = tempRoot({
      'docs/adr/0001-small.md': adr('0001: Small', 'Accepted'),
      'docs/adr/0002-big.md': adr('0002: Big', 'Accepted', 'x'.repeat(2048)),
    });

    const result = await call(root, 'list_adrs', {}, { maxFileKb: 1 });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      adrs: [expect.objectContaining({ id: '0001' })],
    });
    expect(text(result)).toBe('0001  Small  (Accepted, 2026-01-01)\n\n1 file skipped (too large).');
    expect(text(result)).not.toContain('xxxx');
    expect(logLines()).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        msg: 'ADR skipped',
        path: 'docs/adr/0002-big.md',
        reason: 'too_large',
      }),
    );
  });

  it('returns an empty list with a hint when the ADR directory is missing (FR-16)', async () => {
    const root = tempRoot({ 'README.md': '# x\n' });

    const result = await call(root, 'list_adrs');

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ adrs: [] });
    expect(text(result)).toBe(
      'ADR directory not found: docs/adr. Set --adr-dir if your ADRs live elsewhere.',
    );
  });

  it('says so when the directory has no ADRs', async () => {
    const root = tempRoot({ 'docs/adr/README.md': '# ADRs\n' });
    const result = await call(root, 'list_adrs');
    expect(text(result)).toBe('No ADRs found in docs/adr.');
  });

  it('works with --adr-dir .', async () => {
    const root = tempRoot({ '0001-root.md': adr('0001: Root', 'Accepted'), 'x/0002-n.md': '# N' });
    const result = await call(root, 'list_adrs', {}, { adrDir: '.' });
    const ids = (result.structuredContent as { adrs: { id: string }[] }).adrs.map((a) => a.id);
    expect(ids).toEqual(['0001']);
  });

  it('writes one audit line without arguments', async () => {
    await call(DEMO, 'list_adrs', { status: 'needle-status' });

    const audit = logLines().filter((line) => line.msg === 'audit');
    expect(audit).toEqual([
      expect.objectContaining({ event: 'tool_call', tool: 'list_adrs', ok: true }),
    ]);
    expect(stderr.join('')).not.toContain('needle-status');
  });
});

describe('get_adr', () => {
  it.each(['2', '02', '0002', ' 2 '])('returns ADR 0002 for %j (AC4)', async (id) => {
    const result = await call(DEMO, 'get_adr', { id });

    expect(result.isError).toBeFalsy();
    const adrResult = result.structuredContent as Record<string, string>;
    expect(adrResult).toMatchObject({
      id: '0002',
      title: 'Authentication with magic links',
      status: 'Accepted',
      date: '2026-04-14',
    });
    expect(adrResult.context).toMatch(/^Most users book once/);
    expect(adrResult.decision).toMatch(/^Passwordless authentication with email magic links\./);
    expect(adrResult.consequences).toMatch(/^- No password storage/);
    expect(text(result)).toMatch(
      /^# 0002: Authentication with magic links\n\nStatus: Accepted · Date: 2026-04-14\n\n## Context\n\nMost users/,
    );
  });

  it('returns demo 0004 with the body in context (AC18)', async () => {
    const result = await call(DEMO, 'get_adr', { id: '0004' });

    const adrResult = result.structuredContent as Record<string, string>;
    expect(adrResult).toMatchObject({
      id: '0004',
      title: 'Notes from the old wiki',
      status: 'Unknown',
      date: '',
      decision: '',
      consequences: '',
    });
    expect(adrResult.context).toMatch(/^This file does not follow the ADR template/);
    expect(adrResult.context).toContain('We once used Firebase Auth.');
    expect(text(result)).toContain('## Decision\n\n(empty)');
    expect(logLines()).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        msg: 'ADR does not follow the template',
        path: 'docs/adr/0004-legacy-notes.md',
        missing: ['status', 'context', 'decision', 'consequences'],
      }),
    );
  });

  it.each(['99', 'abc', 'ADR-2', '', '2.0'])(
    'returns a tool error listing the ids for %j (AC13)',
    async (id) => {
      const result = await call(DEMO, 'get_adr', { id });

      expect(result.isError).toBe(true);
      expect(text(result)).toBe(
        `ADR "${id}" not found. Available ids: 0001, 0002, 0003, 0004. Call list_adrs for titles.`,
      );
    },
  );

  it('returns a tool error with the reason for a skipped file', async () => {
    const root = tempRoot({
      'docs/adr/0001-small.md': adr('0001: Small', 'Accepted'),
      'docs/adr/0002-big.md': adr('0002: Big', 'Accepted', 'x'.repeat(2048)),
    });

    const result = await call(root, 'get_adr', { id: '2' }, { maxFileKb: 1 });

    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      'ADR 2 cannot be read: the file is larger than --max-file-kb (1 KB).',
    );
  });

  it('returns a tool error when there are no ADRs', async () => {
    const root = tempRoot({ 'README.md': '# x\n' });
    const result = await call(root, 'get_adr', { id: '1' });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('ADR "1" not found. There are no ADRs in docs/adr.');
  });

  it('redacts content in text and structuredContent', async () => {
    const root = tempRoot({
      'docs/adr/0001-contact.md': adr('0001: Contact', 'Accepted', `Ask ${EMAIL}.`),
    });

    const result = await call(root, 'get_adr', { id: '1' });

    expect(JSON.stringify(result)).not.toContain(EMAIL);
    expect((result.structuredContent as { decision: string }).decision).toBe(
      'Ask [REDACTED:email].',
    );
  });
});

describe('ADR parsing', () => {
  async function getAdr(markdown: string, file = 'docs/adr/0007-some-slug.md') {
    const root = tempRoot({ [file]: markdown });
    const result = await call(root, 'get_adr', { id: '7' });
    expect(result.isError).toBeFalsy();
    return result.structuredContent as Record<string, string>;
  }

  it('uses the filename slug when there is no # heading', async () => {
    const parsed = await getAdr('Just some text.\n');
    expect(parsed).toMatchObject({
      title: 'some-slug',
      status: 'Unknown',
      context: 'Just some text.',
    });
  });

  it('keeps a title without a number prefix', async () => {
    const parsed = await getAdr('# Use Postgres\n\n- Status: Accepted\n');
    expect(parsed.title).toBe('Use Postgres');
  });

  it('reads bold status bullets and CRLF line endings', async () => {
    const parsed = await getAdr(
      '# 0007: X\r\n\r\n* **Status**: Superseded\r\n* **Date:** 2026-02-02\r\n\r\n## Decision\r\n\r\nYes.\r\n',
    );
    expect(parsed).toMatchObject({ status: 'Superseded', date: '2026-02-02', decision: 'Yes.' });
  });

  it('keeps found sections and leaves missing ones empty', async () => {
    const parsed = await getAdr('# 0007: X\n\n- Status: Accepted\n\n## Decision\n\nOnly this.\n');
    expect(parsed).toMatchObject({ context: '', decision: 'Only this.', consequences: '' });
  });

  it('keeps ### subheadings inside a section and stops at the next ## heading', async () => {
    const parsed = await getAdr(
      '# 0007: X\n\n- Status: Accepted\n\n## Context\n\nA.\n\n### Detail\n\nB.\n\n## Alternatives\n\nC.\n',
    );
    expect(parsed.context).toBe('A.\n\n### Detail\n\nB.');
  });

  it('ignores headings inside code fences', async () => {
    const parsed = await getAdr(
      '# 0007: X\n\n- Status: Accepted\n\n## Context\n\n```md\n## Decision\nfake\n```\n\n## Decision\n\nReal.\n',
    );
    expect(parsed.context).toBe('```md\n## Decision\nfake\n```');
    expect(parsed.decision).toBe('Real.');
  });

  it('does not take a Status bullet from a later section', async () => {
    const parsed = await getAdr('# 0007: X\n\n## Consequences\n\n- Status: shown in the UI\n');
    expect(parsed.status).toBe('Unknown');
  });

  it('treats an empty Status bullet as Unknown', async () => {
    const parsed = await getAdr('# 0007: X\n\n- Status:\n\n## Decision\n\nYes.\n');
    expect(parsed.status).toBe('Unknown');
  });
});

describe('adr:// resource', () => {
  async function withClient<T>(root: string, run: (client: Client) => Promise<T>, maxFileKb = 256) {
    const client = await connect(root, { maxFileKb });
    try {
      return await run(client);
    } finally {
      await client.close();
    }
  }

  it('returns the raw markdown of demo ADR 0002 (AC10)', async () => {
    const result = await withClient(DEMO, (client) => client.readResource({ uri: 'adr://0002' }));

    const raw = readFileSync(
      join(DEMO, 'docs/adr/0002-authentication-with-magic-links.md'),
      'utf8',
    );
    expect(result.contents).toEqual([{ uri: 'adr://0002', mimeType: 'text/markdown', text: raw }]);
  });

  it('accepts a short id', async () => {
    const result = await withClient(DEMO, (client) => client.readResource({ uri: 'adr://2' }));
    expect((result.contents[0] as { text: string }).text).toMatch(/^# 0002:/);
  });

  it('redacts the raw markdown and writes an audit line with the scheme only', async () => {
    const root = tempRoot({
      'docs/adr/0001-contact.md': adr('0001: Contact', 'Accepted', `Ask ${EMAIL}.`),
    });

    const result = await withClient(root, (client) => client.readResource({ uri: 'adr://0001' }));

    expect(JSON.stringify(result)).not.toContain(EMAIL);
    expect((result.contents[0] as { text: string }).text).toContain('Ask [REDACTED:email].');
    const audit = logLines().filter((line) => line.msg === 'audit');
    expect(audit).toEqual([
      expect.objectContaining({ event: 'resource_read', scheme: 'adr', ok: true, redactions: 1 }),
    ]);
    expect(JSON.stringify(audit)).not.toContain('0001');
  });

  it.each(['adr://0099', 'adr://abc'])('rejects %s as not found', async (uri) => {
    await expect(withClient(DEMO, (client) => client.readResource({ uri }))).rejects.toThrow(uri);
  });

  it('rejects a skipped file with the reason', async () => {
    const root = tempRoot({
      'docs/adr/0002-big.md': adr('0002: Big', 'Accepted', 'x'.repeat(2048)),
    });
    await expect(
      withClient(root, (client) => client.readResource({ uri: 'adr://0002' }), 1),
    ).rejects.toThrow('File is larger than 1 KB: docs/adr/0002-big.md');
  });

  it('lists every readable ADR with its title', async () => {
    const { resources } = await withClient(DEMO, (client) => client.listResources());

    expect(resources.map((resource) => resource.uri)).toEqual([
      'adr://0001',
      'adr://0002',
      'adr://0003',
      'adr://0004',
    ]);
    // The SDK adds the template's description to every entry.
    expect(resources[1]).toMatchObject({
      uri: 'adr://0002',
      name: 'ADR 0002',
      title: 'Authentication with magic links',
      mimeType: 'text/markdown',
    });
  });

  it('redacts titles in the resource list', async () => {
    const root = tempRoot({ 'docs/adr/0001-x.md': adr(`0001: Ask ${EMAIL}`, 'Accepted') });

    const { resources } = await withClient(root, (client) => client.listResources());

    expect(JSON.stringify(resources)).not.toContain(EMAIL);
    expect(resources[0]?.title).toBe('Ask [REDACTED:email]');
  });
});
