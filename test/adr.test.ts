import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import {
  call,
  captureIo,
  connect,
  DEMO,
  tempRoot,
  text,
  withClient as withClientFor,
} from './support.js';

const EMAIL = ['jane.doe', '@', 'example.com'].join('');

const { stderr, logLines } = captureIo();

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

  it.each(['', '  '])('treats status %j as no filter', async (status) => {
    const result = await call(DEMO, 'list_adrs', { status });
    expect((result.structuredContent as { adrs: unknown[] }).adrs).toHaveLength(4);
  });

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
    expect(stderr()).not.toContain('needle-status');
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
      'ADR "2" cannot be read: the file is larger than --max-file-kb (1 KB).',
    );
  });

  it('names --adr-dir when the ADR directory is missing', async () => {
    const root = tempRoot({ 'README.md': '# x\n' });
    const result = await call(root, 'get_adr', { id: '1' });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      'ADR "1" not found. ADR directory not found: docs/adr. Set --adr-dir if your ADRs live elsewhere.',
    );
  });

  it('returns a tool error when there are no ADRs', async () => {
    const root = tempRoot({ 'docs/adr/README.md': '# x\n' });
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

const nygard = (title: string, status: string) =>
  `# ${title}\n\nDate: 2026-01-01\n\n## Status\n\n${status}\n\n## Context\n\nWhy.\n\n` +
  '## Decision\n\nWe do it.\n\n## Consequences\n\nSome.\n';

describe('ADR formats (FR-17)', () => {
  async function getAdr(markdown: string) {
    const root = tempRoot({ 'docs/adr/0007-some-slug.md': markdown });
    const result = await call(root, 'get_adr', { id: '7' });
    expect(result.isError).toBeFalsy();
    return result.structuredContent as Record<string, string>;
  }

  const templateWarnings = () =>
    logLines().filter((line) => line.msg === 'ADR does not follow the template');

  it('keeps the bullet format of the demo', async () => {
    const result = await call(DEMO, 'get_adr', { id: '1' });
    expect(result.structuredContent).toMatchObject({ status: 'Accepted', date: '2026-03-02' });
    expect(templateWarnings()).toEqual([]);
  });

  it('reads a Nygard ADR: numbered title, Date line and Status section', async () => {
    const parsed = await getAdr(nygard('1. Record architecture decisions', 'Accepted'));

    expect(parsed).toEqual({
      id: '0007',
      title: 'Record architecture decisions',
      status: 'Accepted',
      date: '2026-01-01',
      context: 'Why.',
      decision: 'We do it.',
      consequences: 'Some.',
    });
    expect(templateWarnings()).toEqual([]);
  });

  it('takes the first line of the Status section and ignores the rest', async () => {
    const parsed = await getAdr(
      nygard('2. X', 'Accepted\n\nSupersedes [1. Old](0001-old.md)').replace(
        '## Status\n\n',
        '## Status\n\n\n',
      ),
    );
    expect(parsed.status).toBe('Accepted');
  });

  it('treats an empty Status section as Unknown', async () => {
    const parsed = await getAdr('# 1. X\n\n## Status\n\n## Context\n\nWhy.\n');
    expect(parsed.status).toBe('Unknown');
  });

  it.each([
    ['Superseded by [2. Use X](0002-use-x.md)', 'Superseded'],
    ['amended BY 0009', 'amended'],
    ['In progress', 'In progress'],
    ['Superseded by', 'Superseded by'],
    ['Nearby', 'Nearby'],
  ])('reads status %j as %j', async (status, expected) => {
    const parsed = await getAdr(nygard('1. X', status));
    expect(parsed.status).toBe(expected);
  });

  it('cuts `X by …` in a bullet too', async () => {
    const parsed = await getAdr('# X\n\n- Status: Superseded by ADR 0009\n');
    expect(parsed.status).toBe('Superseded');
  });

  it('finds a superseded Nygard ADR by status', async () => {
    const root = tempRoot({
      'docs/adr/0001-old.md': nygard('1. Old', 'Superseded by [2. Use X](0002-use-x.md)'),
      'docs/adr/0002-use-x.md': nygard('2. Use X', 'Accepted'),
    });

    const result = await call(root, 'list_adrs', { status: 'superseded' });

    expect(result.structuredContent).toEqual({
      adrs: [{ id: '0001', title: 'Old', status: 'Superseded', date: '2026-01-01' }],
    });
  });

  it.each([
    ['1.5 release', '1.5 release'],
    ['12. Twelve', 'Twelve'],
    ['0007: Seven', 'Seven'],
    ['3 :  Spaced', 'Spaced'],
  ])('reads title %j as %j', async (heading, title) => {
    const parsed = await getAdr(`# ${heading}\n\n- Status: Accepted\n`);
    expect(parsed.title).toBe(title);
  });

  it('prefers a Status bullet to a Status section and a bullet date to a Date line', async () => {
    const parsed = await getAdr(
      '# X\n\n- Status: Proposed\n- Date: 2026-02-02\n\nDate: 2026-01-01\n\n## Status\n\nAccepted\n',
    );
    expect(parsed).toMatchObject({ status: 'Proposed', date: '2026-02-02' });
  });

  it('reads a bold Date line and ignores one after the first section', async () => {
    expect((await getAdr('# X\n\n**Date:** 2026-03-03\n')).date).toBe('2026-03-03');
    expect((await getAdr('# X\n\n## Context\n\nDate: 2026-03-03\n')).date).toBe('');
  });

  it('reads status and date from MADR frontmatter and keeps it out of every field', async () => {
    const parsed = await getAdr(
      '---\nstatus: accepted\ndate: 2026-01-01\ndeciders: [Jane, Joe]\n---\n# Use Postgres\n\nWe need a DB.\n',
    );

    expect(parsed).toMatchObject({
      title: 'Use Postgres',
      status: 'accepted',
      date: '2026-01-01',
      context: 'We need a DB.',
    });
    expect(JSON.stringify(parsed)).not.toMatch(/deciders|---/);
  });

  it('reads frontmatter that keeps the comment line of the MADR template', async () => {
    const parsed = await getAdr(
      '---\n# These are optional elements. Feel free to remove any of them.\nstatus: accepted\n---\n# X\n',
    );
    expect(parsed.status).toBe('accepted');
    expect(logLines().filter((line) => line.msg === 'ADR frontmatter ignored')).toEqual([]);
  });

  it('prefers frontmatter to a bullet and a Status section', async () => {
    const parsed = await getAdr(
      '---\nstatus: "superseded by ADR-0009"\ndate: 2026-05-05\n---\n# X\n\n- Status: Accepted\n- Date: 2026-01-01\n\n## Status\n\nProposed\n',
    );
    expect(parsed).toMatchObject({ status: 'superseded', date: '2026-05-05' });
  });

  it.each([
    ['status: []', 'Proposed'],
    ['status: [a, b]', 'Proposed'],
    ['status:', 'Proposed'],
    ['date: 2026-01-01', 'Proposed'],
  ])('falls back to the bullet for frontmatter %j', async (line, status) => {
    const parsed = await getAdr(`---\n${line}\n---\n# X\n\n- Status: Proposed\n`);
    expect(parsed.status).toBe(status);
  });

  it('lists an ADR with frontmatter outside the subset and warns without content', async () => {
    const root = tempRoot({
      'docs/adr/0001-x.md':
        '---\nstatus: accepted\ndeciders:\n  - secret-name\n---\n# X\n\nDate: 2026-02-02\n\n## Status\n\nProposed\n\n## Context\n\nWhy.\n',
    });

    const listed = await call(root, 'list_adrs');
    const fetched = await call(root, 'get_adr', { id: '1' });

    expect(listed.structuredContent).toEqual({
      adrs: [{ id: '0001', title: 'X', status: 'Proposed', date: '2026-02-02' }],
    });
    expect(fetched.structuredContent).toMatchObject({ status: 'Proposed', context: 'Why.' });
    expect(JSON.stringify(fetched.structuredContent)).not.toContain('secret-name');
    expect(logLines()).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        msg: 'ADR frontmatter ignored',
        path: 'docs/adr/0001-x.md',
        line: 4,
        problem: 'not a `key: value` line',
      }),
    );
    expect(stderr()).not.toContain('secret-name');
  });

  it('reads a file without a closing --- line as plain markdown', async () => {
    const parsed = await getAdr('---\n# X\n\n- Status: Accepted\n');
    expect(parsed).toMatchObject({ title: 'X', status: 'Accepted' });
    expect(logLines().filter((line) => line.msg === 'ADR frontmatter ignored')).toEqual([]);
  });

  it('takes nothing from the lines of an unclosed frontmatter block', async () => {
    const parsed = await getAdr('---\nstatus: accepted\ndate: 2026-01-04\n# T\n\nBody.\n');
    expect(parsed).toMatchObject({ title: 'T', status: 'Unknown', date: '' });
  });

  it('treats a leading thematic break with a later --- as invalid frontmatter', async () => {
    const parsed = await getAdr(
      '---\n\n# Title\n\n- Status: Accepted\n\n---\n\n## Context\n\nA.\n',
    );
    expect(parsed).toMatchObject({ title: 'some-slug', status: 'Unknown', context: 'A.' });
    expect(logLines()).toContainEqual(
      expect.objectContaining({ msg: 'ADR frontmatter ignored', line: 5 }),
    );
  });

  it('finds ADRs of all three formats by status', async () => {
    const root = tempRoot({
      'docs/adr/0001-bullet.md': adr('0001: Bullet', 'Accepted'),
      'docs/adr/0002-nygard.md': nygard('2. Nygard', 'Accepted'),
      'docs/adr/0003-madr.md': '---\nstatus: accepted\n---\n# MADR\n',
      'docs/adr/0004-other.md': nygard('4. Other', 'Proposed'),
    });

    const result = await call(root, 'list_adrs', { status: 'accepted' });

    const ids = (result.structuredContent as { adrs: { id: string }[] }).adrs.map((a) => a.id);
    expect(ids).toEqual(['0001', '0002', '0003']);
  });

  it('maps the MADR sections and splits off ### Consequences', async () => {
    const parsed = await getAdr(
      '---\nstatus: accepted\ndate: 2026-01-01\n---\n# Use Postgres\n\n' +
        '## Context and Problem Statement\n\nWe need a DB.\n\n' +
        '## Considered Options\n\n* Postgres\n* MySQL\n\n' +
        '## Decision Outcome\n\nChosen option: "Postgres".\n\n' +
        '### Consequences\n\n* Good, because known.\n\n' +
        '### Confirmation\n\nReview.\n\n' +
        '## Pros and Cons of the Options\n\nMany.\n',
    );

    expect(parsed).toEqual({
      id: '0007',
      title: 'Use Postgres',
      status: 'accepted',
      date: '2026-01-01',
      context: 'We need a DB.',
      decision: 'Chosen option: "Postgres".\n\n### Confirmation\n\nReview.',
      consequences: '* Good, because known.',
    });
    expect(templateWarnings()).toEqual([]);
  });

  it('does not warn about missing consequences when Decision Outcome is there', async () => {
    const parsed = await getAdr(
      '---\nstatus: proposed\n---\n# X\n\n## Context and Problem Statement\n\nA.\n\n## Decision Outcome\n\nB.\n',
    );
    expect(parsed).toMatchObject({ context: 'A.', decision: 'B.', consequences: '' });
    expect(templateWarnings()).toEqual([]);
  });

  it('keeps Decision Outcome whole when there is a ## Consequences section', async () => {
    const parsed = await getAdr(
      '# X\n\n- Status: Accepted\n\n## Context\n\nA.\n\n## Decision Outcome\n\nB.\n\n### Consequences\n\nC.\n\n## Consequences\n\nD.\n',
    );
    expect(parsed).toMatchObject({
      decision: 'B.\n\n### Consequences\n\nC.',
      consequences: 'D.',
    });
  });

  it('still warns about a missing consequences section next to ## Decision', async () => {
    await getAdr('# X\n\n- Status: Accepted\n\n## Context\n\nA.\n\n## Decision\n\nB.\n');
    expect(templateWarnings()).toContainEqual(
      expect.objectContaining({ missing: ['consequences'] }),
    );
  });

  it('keeps the Status section out of the context fallback', async () => {
    const parsed = await getAdr(
      '# 1. X\n\nDate: 2026-01-01\n\n## Status\n\nAccepted\n\n## Notes\n\nFree text.\n',
    );
    expect(parsed).toMatchObject({ status: 'Accepted', decision: '', consequences: '' });
    expect(parsed.context).toBe('Date: 2026-01-01\n\n## Notes\n\nFree text.');
    expect(templateWarnings()).toContainEqual(
      expect.objectContaining({ missing: ['context', 'decision', 'consequences'] }),
    );
  });
});

describe('adr:// resource', () => {
  function withClient<T>(root: string, run: (client: Client) => Promise<T>, maxFileKb = 256) {
    return withClientFor(root, run, { maxFileKb });
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

    const uris = resources.map((resource) => resource.uri).filter((uri) => uri.startsWith('adr:'));
    expect(uris).toEqual(['adr://0001', 'adr://0002', 'adr://0003', 'adr://0004']);
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
