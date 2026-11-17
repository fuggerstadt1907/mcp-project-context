import { mkdirSync, readdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { slugify } from '../src/tools/create-adr-draft.js';
import { call, captureIo, connect, DEMO, tempRoot, text, withClient } from './support.js';

const { logLines } = captureIo();

const WRITE = { allowWrite: true };
const ADR = '# x\n\n- Status: Accepted\n';
const INPUT = {
  title: 'Use Postgres',
  context: 'We need a database.',
  decision: 'Postgres 17.',
  consequences: 'Ops must run backups.',
};

function draft(args: Partial<typeof INPUT> = {}) {
  return { ...INPUT, ...args };
}

function drafts(root: string, adrDir = 'docs/adr'): string[] {
  return readdirSync(join(root, adrDir, 'drafts')).sort();
}

function structured(result: CallToolResult) {
  return result.structuredContent as {
    id: string;
    title: string;
    status: string;
    date: string;
    path: string;
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('create_adr_draft registration', () => {
  it('is absent from listTools() without --allow-write (AC24)', async () => {
    const client = await connect(DEMO);
    const { tools } = await client.listTools();
    await client.close();
    expect(tools.map((tool) => tool.name)).not.toContain('create_adr_draft');
  });

  it('cannot be called without --allow-write', async () => {
    const root = tempRoot({ 'docs/adr/0001-a.md': ADR });
    await expect(call(root, 'create_adr_draft', draft())).rejects.toThrow(
      'Tool create_adr_draft not found',
    );
    expect(readdirSync(join(root, 'docs/adr'))).toEqual(['0001-a.md']);
  });

  it('is listed with --allow-write as a non-destructive write tool', async () => {
    const client = await connect(DEMO, WRITE);
    const { tools } = await client.listTools();
    await client.close();
    const tool = tools.find((candidate) => candidate.name === 'create_adr_draft');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(tool?.outputSchema).toBeDefined();
  });
});

describe('create_adr_draft', () => {
  it('numbers after the highest ADR or draft (AC11)', async () => {
    const root = tempRoot({
      'docs/adr/0001-a.md': ADR,
      'docs/adr/0002-b.md': ADR,
      'docs/adr/0003-c.md': ADR,
      'docs/adr/0004-d.md': ADR,
      'docs/adr/drafts/0005-e.md': ADR,
    });

    const result = await call(root, 'create_adr_draft', draft(), WRITE);

    expect(result.isError).toBeFalsy();
    expect(structured(result)).toMatchObject({
      id: '0006',
      path: 'docs/adr/drafts/0006-use-postgres.md',
    });
    expect(drafts(root)).toEqual(['0005-e.md', '0006-use-postgres.md']);
  });

  it('counts accepted ADRs above the drafts, gaps and numbers over 9999', async () => {
    const gap = tempRoot({ 'docs/adr/0001-a.md': ADR, 'docs/adr/0007-b.md': ADR });
    expect(structured(await call(gap, 'create_adr_draft', draft(), WRITE)).id).toBe('0008');

    const big = tempRoot({ 'docs/adr/9999-a.md': ADR, 'docs/adr/drafts/0003-b.md': ADR });
    expect(structured(await call(big, 'create_adr_draft', draft(), WRITE)).id).toBe('10000');
  });

  it('starts at 0001 and creates drafts/ in an empty ADR directory', async () => {
    const root = tempRoot({ 'docs/adr/README.md': '# ADRs' });
    const result = await call(root, 'create_adr_draft', draft(), WRITE);
    expect(structured(result).path).toBe('docs/adr/drafts/0001-use-postgres.md');
  });

  it('ignores files that are not ADRs and other subdirectories', async () => {
    const root = tempRoot({
      'docs/adr/0002-a.md': ADR,
      'docs/adr/template.md': ADR,
      'docs/adr/archive/0042-old.md': ADR,
      'docs/adr/drafts/notes.md': ADR,
      'docs/adr/drafts/nested/0050-x.md': ADR,
    });
    expect(structured(await call(root, 'create_adr_draft', draft(), WRITE)).id).toBe('0003');
  });

  it('counts an ADR that is too large to read', async () => {
    const root = tempRoot({ 'docs/adr/0004-big.md': 'x'.repeat(2048) });
    const result = await call(root, 'create_adr_draft', draft(), { ...WRITE, maxFileKb: 1 });
    expect(structured(result).id).toBe('0005');
  });

  it('writes the template with status Proposed and the local date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 17, 23, 30));
    const root = tempRoot({ 'docs/adr/0001-a.md': ADR });

    const result = await call(root, 'create_adr_draft', draft(), WRITE);

    expect(readFileSync(join(root, 'docs/adr/drafts/0002-use-postgres.md'), 'utf8')).toBe(
      [
        '# 0002: Use Postgres',
        '',
        '- Status: Proposed',
        '- Date: 2026-11-17',
        '',
        '## Context',
        '',
        'We need a database.',
        '',
        '## Decision',
        '',
        'Postgres 17.',
        '',
        '## Consequences',
        '',
        'Ops must run backups.',
        '',
      ].join('\n'),
    );
    expect(structured(result)).toEqual({
      id: '0002',
      title: 'Use Postgres',
      status: 'Proposed',
      date: '2026-11-17',
      path: 'docs/adr/drafts/0002-use-postgres.md',
    });
    expect(text(result)).toBe(
      'Created ADR draft 0002 "Use Postgres" at docs/adr/drafts/0002-use-postgres.md ' +
        '(Proposed, 2026-11-17). Drafts are not listed by list_adrs; move it to docs/adr/ to ' +
        'accept it.',
    );
  });

  it('writes a draft that get_adr can read once it is moved into the ADR directory', async () => {
    const root = tempRoot({ 'docs/adr/0001-a.md': ADR });
    await call(root, 'create_adr_draft', draft(), WRITE);
    const content = readFileSync(join(root, 'docs/adr/drafts/0002-use-postgres.md'), 'utf8');
    const promoted = tempRoot({ 'docs/adr/0002-use-postgres.md': content });

    const result = await call(promoted, 'get_adr', { id: '2' });

    expect(result.structuredContent).toMatchObject({
      id: '0002',
      title: 'Use Postgres',
      status: 'Proposed',
      context: 'We need a database.',
      decision: 'Postgres 17.',
      consequences: 'Ops must run backups.',
    });
    expect(logLines().filter((line) => line.level === 'warn')).toEqual([]);
  });

  it('is not listed by list_adrs', async () => {
    const root = tempRoot({ 'docs/adr/0001-a.md': ADR });
    await call(root, 'create_adr_draft', draft(), WRITE);
    const result = await call(root, 'list_adrs');
    expect(result.structuredContent).toMatchObject({ adrs: [{ id: '0001' }] });
  });

  it('gives parallel calls distinct consecutive numbers (AC12)', async () => {
    const root = tempRoot({
      'docs/adr/0004-d.md': ADR,
      'docs/adr/drafts/0005-e.md': ADR,
    });

    const results = await withClient(
      root,
      (client) =>
        Promise.all(
          Array.from(
            { length: 10 },
            (_, i) =>
              client.callTool({
                name: 'create_adr_draft',
                arguments: draft({ title: `Same title ${i % 2}` }),
              }) as Promise<CallToolResult>,
          ),
        ),
      WRITE,
    );

    expect(results.every((result) => !result.isError)).toBe(true);
    const ids = results.map((result) => structured(result).id).sort();
    expect(ids).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 6).padStart(4, '0')));
    expect(drafts(root)).toHaveLength(11);
  });

  it('returns a tool error and leaves an existing entry unchanged (AC12)', async () => {
    const root = tempRoot({ 'docs/adr/0001-a.md': ADR });
    // Not counted for numbering, because it is not a readable file, but it blocks the name.
    mkdirSync(join(root, 'docs/adr/drafts/0002-use-postgres.md'), { recursive: true });
    symlinkSync(join(root, 'nowhere.md'), join(root, 'docs/adr/drafts/0002-other.md'));

    const dir = await call(root, 'create_adr_draft', draft(), WRITE);
    const link = await call(root, 'create_adr_draft', draft({ title: 'Other' }), WRITE);

    for (const result of [dir, link]) {
      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/already exists\. Nothing was written\./);
    }
    expect(text(dir)).toContain('docs/adr/drafts/0002-use-postgres.md');
    expect(drafts(root)).toEqual(['0002-other.md', '0002-use-postgres.md']);
    expect(readdirSync(join(root, 'docs/adr/drafts/0002-use-postgres.md'))).toEqual([]);
    expect(readdirSync(root)).not.toContain('nowhere.md');
  });

  it('keeps a title like ../../evil inside drafts/', async () => {
    const root = tempRoot({ 'docs/adr/0001-a.md': ADR });

    const result = await call(root, 'create_adr_draft', draft({ title: '../../evil' }), WRITE);

    expect(structured(result).path).toBe('docs/adr/drafts/0002-evil.md');
    expect(drafts(root)).toEqual(['0002-evil.md']);
    expect(readdirSync(root).sort()).toEqual(['docs']);
    expect(readdirSync(join(root, 'docs')).sort()).toEqual(['adr']);
  });

  it('writes the content unredacted and redacts the returned text', async () => {
    const root = tempRoot({ 'docs/adr/0001-a.md': ADR });
    const email = ['alice', 'example.com'].join('@');

    const result = await call(
      root,
      'create_adr_draft',
      draft({ title: `Ask ${email}`, context: `Contact ${email}.` }),
      WRITE,
    );

    const path = structured(result).path;
    const content = readFileSync(join(root, path), 'utf8');
    expect(content).toContain(`# 0002: Ask ${email}`);
    expect(content).toContain(`Contact ${email}.`);
    expect(JSON.stringify(result)).not.toContain(email);
    expect(structured(result).title).toBe('Ask [REDACTED:email]');
    expect(text(result)).toContain('"Ask [REDACTED:email]"');
  });

  it('fails with the flag to set when the ADR directory is missing', async () => {
    const root = tempRoot({ 'README.md': '# x' });
    const result = await call(root, 'create_adr_draft', draft(), WRITE);
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      'ADR directory not found: docs/adr. Set --adr-dir if your ADRs live elsewhere. ' +
        'Nothing was written.',
    );
    expect(readdirSync(root)).toEqual(['README.md']);
  });

  it('fails when drafts/ is a symlink that points outside root', async () => {
    const outside = tempRoot({});
    const root = tempRoot({ 'docs/adr/0001-a.md': ADR });
    symlinkSync(outside, join(root, 'docs/adr/drafts'));

    const result = await call(root, 'create_adr_draft', draft(), WRITE);

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('outside the project root');
    expect(text(result)).not.toContain(outside);
    expect(readdirSync(outside)).toEqual([]);
  });

  it.each([
    ['an empty title', { title: '   ' }, 'Title must not be empty.'],
    ['a title with a line break', { title: 'a\nb' }, 'Title must be a single line.'],
    ['a title over 200 characters', { title: 'x'.repeat(201) }, 'Title must be at most 200'],
  ])('fails for %s and writes nothing', async (_, args, message) => {
    const root = tempRoot({ 'docs/adr/0001-a.md': ADR });
    const result = await call(root, 'create_adr_draft', draft(args), WRITE);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(message);
    expect(readdirSync(join(root, 'docs/adr'))).toEqual(['0001-a.md']);
  });

  it('fails when the draft is larger than --max-file-kb', async () => {
    const root = tempRoot({ 'docs/adr/0001-a.md': ADR });
    const result = await call(root, 'create_adr_draft', draft({ context: 'x'.repeat(2048) }), {
      ...WRITE,
      maxFileKb: 1,
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('larger than 1 KB');
    expect(readdirSync(join(root, 'docs/adr'))).toEqual(['0001-a.md']);
  });

  it('writes one audit line without arguments or content', async () => {
    const root = tempRoot({ 'docs/adr/0001-a.md': ADR });
    await call(root, 'create_adr_draft', draft({ title: 'Secret plan' }), WRITE);
    const audit = logLines().filter((line) => line.msg === 'audit');
    expect(audit).toEqual([
      expect.objectContaining({ event: 'tool_call', tool: 'create_adr_draft', ok: true }),
    ]);
    expect(JSON.stringify(audit)).not.toMatch(/Secret plan|secret-plan/);
  });
});

describe('slugify', () => {
  it.each([
    ['Use Postgres', 'use-postgres'],
    ['../../evil', 'evil'],
    ['/etc/passwd', 'etc-passwd'],
    ['C:\\Windows\\x', 'c-windows-x'],
    ['Überall Grüße, café!', 'uberall-grusse-cafe'],
    ['a\0b', 'a-b'],
    ['...', 'untitled'],
    ['日本語', 'untitled'],
    [`${'x'.repeat(30)} ${'y'.repeat(40)}`, `${'x'.repeat(30)}-${'y'.repeat(29)}`],
    [`${'a'.repeat(59)} b`, 'a'.repeat(59)],
  ])('%s → %s', (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });
});
