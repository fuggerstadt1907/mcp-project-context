import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { call, captureIo, connect, DEMO, tempRoot, text, withClient } from './support.js';

const EMAIL = ['jane.doe', '@', 'example.com'].join('');

const { stderr, logLines } = captureIo();

const ticket = (id: string, extra = '', body = 'Do it.\n') =>
  `---\nid: ${id}\ntitle: Ticket ${id}\nstatus: todo\nlabels: [api]\n${extra}---\n\n${body}`;

function ids(result: { structuredContent?: unknown }): string[] {
  return (result.structuredContent as { tickets: { id: string }[] }).tickets.map((t) => t.id);
}

function warnings(): Record<string, unknown>[] {
  return logLines().filter((line) => line.level === 'warn');
}

describe('tool list', () => {
  it('lists list_tickets and get_ticket as read-only tools with an output schema', async () => {
    const client = await connect(DEMO);
    const { tools } = await client.listTools();
    await client.close();

    for (const name of ['list_tickets', 'get_ticket']) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool?.annotations?.readOnlyHint).toBe(true);
      expect(tool?.outputSchema).toBeDefined();
      expect(tool?.description).toContain('"T-003"');
    }
  });
});

describe('list_tickets', () => {
  it('lists all four demo tickets without warnings (AC16)', async () => {
    const result = await call(DEMO, 'list_tickets');

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      tickets: [
        {
          id: 'T-001',
          title: 'Send booking confirmation email',
          status: 'done',
          labels: ['api', 'email'],
        },
        {
          id: 'T-002',
          title: 'Show guide contact details on the booking page',
          status: 'in-progress',
          labels: ['web', 'mobile'],
        },
        {
          id: 'T-003',
          title: 'Rate-limit magic link requests',
          status: 'todo',
          labels: ['api', 'security'],
        },
        {
          id: 'T-004',
          title: 'Offline bookings list for guides',
          status: 'todo',
          labels: ['mobile'],
        },
      ],
    });
    expect(text(result)).toContain('T-003  Rate-limit magic link requests  (todo · api, security)');
    expect(text(result)).not.toContain('skipped');
    expect(warnings()).toEqual([]);
  });

  it('combines status and label with AND, case-insensitively (AC5)', async () => {
    const result = await call(DEMO, 'list_tickets', { status: 'TODO', label: 'api' });
    expect(ids(result)).toEqual(['T-003']);
  });

  it.each([
    [{ status: 'todo' }, ['T-003', 'T-004']],
    [{ label: 'MOBILE' }, ['T-002', 'T-004']],
    [{ status: ' Done ', label: '' }, ['T-001']],
    [{ status: '', label: '  ' }, ['T-001', 'T-002', 'T-003', 'T-004']],
  ])('filters %j', async (args, expected) => {
    expect(ids(await call(DEMO, 'list_tickets', args))).toEqual(expected);
  });

  it('matches filters exactly, not as a substring (FR-11)', async () => {
    const result = await call(DEMO, 'list_tickets', { status: 'progress' });
    expect(ids(result)).toEqual([]);
    expect(text(result)).toBe('No tickets with status "progress".');

    const both = await call(DEMO, 'list_tickets', { status: 'todo', label: 'sec' });
    expect(text(both)).toBe('No tickets with status "todo" and label "sec".');
  });

  it('reads subdirectories and sorts ids by number', async () => {
    const root = tempRoot({
      'tickets/T-10-x.md': ticket('T-10'),
      'tickets/sub/T-2-y.md': ticket('T-2'),
      'tickets/T-1.md': ticket('T-1'),
    });
    expect(ids(await call(root, 'list_tickets'))).toEqual(['T-1', 'T-2', 'T-10']);
  });

  it('uses the frontmatter id when the filename differs and warns (AC14)', async () => {
    const root = tempRoot({ 'tickets/T-012-login.md': ticket('T-013') });

    expect(ids(await call(root, 'list_tickets'))).toEqual(['T-013']);
    expect(warnings()).toContainEqual(
      expect.objectContaining({
        msg: 'ticket id differs from the filename, using the frontmatter id',
        path: 'tickets/T-012-login.md',
      }),
    );
  });

  it('does not warn for a filename without an id prefix or in another case', async () => {
    const root = tempRoot({
      'tickets/login.md': ticket('T-1'),
      'tickets/t-2-x.md': ticket('T-2'),
    });
    expect(ids(await call(root, 'list_tickets'))).toEqual(['T-1', 'T-2']);
    expect(warnings()).toEqual([]);
  });

  it('keeps the first file by path for a duplicate id and names both (AC15)', async () => {
    const root = tempRoot({
      'tickets/b/y.md': ticket('T-003', 'source: b\n'),
      'tickets/a/x.md': ticket('t-003', 'source: a\n', 'From a.\n'),
    });

    const result = await call(root, 'list_tickets');
    expect(ids(result)).toEqual(['t-003']);
    expect(text(result)).not.toContain('skipped');
    expect(warnings()).toContainEqual(
      expect.objectContaining({
        msg: 'duplicate ticket id, keeping the first file',
        files: ['tickets/a/x.md', 'tickets/b/y.md'],
      }),
    );
  });

  it('skips files without frontmatter, without id or outside the subset (AC17)', async () => {
    const root = tempRoot({
      'tickets/T-1.md': ticket('T-1'),
      'tickets/T-2-block.md': '---\nid: T-2\nlabels:\n  - api\n---\n',
      'tickets/T-3-nested.md': '---\nid: T-3\nmeta:\n  owner: x\n---\n',
      'tickets/T-4-multiline.md': '---\nid: T-4\ntitle: first\n  second\n---\n',
      'tickets/T-5-noid.md': '---\ntitle: No id\n---\n',
      'tickets/T-6-empty-id.md': '---\nid: ""\n---\n',
      'tickets/T-7-plain.md': '# Just markdown\n',
      'tickets/T-8-array-id.md': '---\nid: [T-8]\n---\n',
    });

    const result = await call(root, 'list_tickets');

    expect(ids(result)).toEqual(['T-1']);
    expect(text(result)).toBe(
      'T-1  Ticket T-1  (todo · api)\n\n' +
        '7 files skipped (4 invalid frontmatter, 2 missing id, 1 no frontmatter).',
    );
    const skipped = warnings().filter((line) => line.msg === 'ticket skipped');
    expect(skipped).toHaveLength(7);
    expect(skipped).toContainEqual(
      expect.objectContaining({
        path: 'tickets/T-2-block.md',
        reason: 'invalid_frontmatter',
        line: 4,
      }),
    );
  });

  it.each(['a/b', 'T 2', 'T#2', 'T-ä', 'T:2'])(
    'skips a ticket with id %j that cannot be a ticket:// URI',
    async (id) => {
      const root = tempRoot({
        'tickets/T-1.md': ticket('T-1'),
        'tickets/x.md': `---\nid: "${id}"\n---\n`,
      });
      const result = await call(root, 'list_tickets');
      expect(ids(result)).toEqual(['T-1']);
      expect(text(result)).toContain('1 file skipped (invalid id).');
      expect(warnings()).toContainEqual(
        expect.objectContaining({ path: 'tickets/x.md', reason: 'invalid_id' }),
      );
    },
  );

  it('accepts ids with dots and underscores', async () => {
    const root = tempRoot({ 'tickets/x.md': ticket('PROJ_1.2') });
    const result = await withClient(root, (client) =>
      client.readResource({ uri: 'ticket://PROJ_1.2' }),
    );
    expect((result.contents[0] as { text: string }).text).toContain('id: PROJ_1.2');
  });

  it('ignores README.md in the tickets directory', async () => {
    const root = tempRoot({
      'tickets/README.md': '# How we write tickets\n',
      'tickets/sub/readme.md': 'x\n',
      'tickets/T-1.md': ticket('T-1'),
    });
    const result = await call(root, 'list_tickets');
    expect(ids(result)).toEqual(['T-1']);
    expect(text(result)).not.toContain('skipped');
    expect(warnings()).toEqual([]);
  });

  it('leaves out a file over --max-file-kb and says so (AC19)', async () => {
    const root = tempRoot({
      'tickets/T-1.md': ticket('T-1'),
      'tickets/T-2-big.md': ticket('T-2', '', `${'x'.repeat(2048)}\n`),
    });

    const result = await call(root, 'list_tickets', {}, { maxFileKb: 1 });

    expect(ids(result)).toEqual(['T-1']);
    expect(text(result)).toContain('1 file skipped (too large).');
    expect(warnings()).toContainEqual(
      expect.objectContaining({ path: 'tickets/T-2-big.md', reason: 'too_large' }),
    );
  });

  it('returns an empty list with a hint when the tickets directory is missing (AC20)', async () => {
    const root = tempRoot({ 'README.md': '# x\n' });
    const result = await call(root, 'list_tickets');
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ tickets: [] });
    expect(text(result)).toBe(
      'Tickets directory not found: tickets. Set --tickets-dir if your tickets live elsewhere.',
    );
  });

  it('says so when the directory has no tickets', async () => {
    const root = tempRoot({ 'tickets/README.md': '# x\n' });
    expect(text(await call(root, 'list_tickets'))).toBe('No tickets found in tickets.');
  });

  it('works with --tickets-dir pointing elsewhere', async () => {
    const root = tempRoot({ 'work/items/T-1.md': ticket('T-1') });
    expect(ids(await call(root, 'list_tickets', {}, { ticketsDir: 'work/items' }))).toEqual([
      'T-1',
    ]);
  });

  it('shows a ticket without status and labels without empty brackets', async () => {
    const root = tempRoot({ 'tickets/T-1.md': '---\nid: T-1\ntitle: Bare\n---\n' });
    const result = await call(root, 'list_tickets');
    expect(result.structuredContent).toEqual({
      tickets: [{ id: 'T-1', title: 'Bare', status: '', labels: [] }],
    });
    expect(text(result)).toBe('T-1  Bare');
  });

  it('treats a plain labels value as one label', async () => {
    const root = tempRoot({ 'tickets/T-1.md': '---\nid: T-1\nlabels: api\n---\n' });
    expect(ids(await call(root, 'list_tickets', { label: 'api' }))).toEqual(['T-1']);
  });

  it('writes one audit line without arguments', async () => {
    await call(DEMO, 'list_tickets', { status: 'needle-status', label: 'needle-label' });

    const audit = logLines().filter((line) => line.msg === 'audit');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ event: 'tool_call', tool: 'list_tickets', ok: true });
    expect(stderr()).not.toContain('needle');
  });
});

describe('get_ticket', () => {
  it.each(['T-003', 't-003', ' T-003 '])(
    'returns T-003 with four open acceptance criteria for %j (AC6)',
    async (id) => {
      const result = await call(DEMO, 'get_ticket', { id });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({
        id: 'T-003',
        title: 'Rate-limit magic link requests',
        status: 'todo',
        labels: ['api', 'security'],
        description:
          "Attackers can flood a user's inbox by requesting magic links repeatedly. Limit requests per email\n" +
          'address and per IP. Check the authentication ADR before implementing.',
        acceptanceCriteria: [
          { text: 'Max 5 link requests per email per hour', done: false },
          { text: 'Max 20 requests per IP per hour', done: false },
          {
            text: 'Exceeding the limit returns a problem details response with status 429',
            done: false,
          },
          { text: 'Limits are configurable via environment variables', done: false },
        ],
      });
      expect(text(result)).toMatch(
        /^# T-003: Rate-limit magic link requests\n\nStatus: todo · Labels: api, security\n\nAttackers/,
      );
      expect(text(result)).toContain(
        '## Acceptance criteria\n\n- [ ] Max 5 link requests per email per hour\n',
      );
    },
  );

  it('reads done criteria from demo T-001', async () => {
    const result = await call(DEMO, 'get_ticket', { id: 'T-001' });
    const criteria = (result.structuredContent as { acceptanceCriteria: { done: boolean }[] })
      .acceptanceCriteria;
    expect(criteria.map((c) => c.done)).toEqual([true, true, true]);
    expect(text(result)).toContain('- [x] Email is sent within 1 minute of booking');
  });

  it('masks the email and phone number of demo T-002 (AC22)', async () => {
    const result = await call(DEMO, 'get_ticket', { id: 'T-002' });
    const json = JSON.stringify(result);

    expect(json).not.toContain('maria.beispiel@example.com');
    expect(json).not.toContain('+49 170 0000000');
    expect((result.structuredContent as { description: string }).description).toContain(
      'Maria Beispiel, [REDACTED:email], [REDACTED:phone].',
    );
    expect(text(result)).toContain('[REDACTED:email], [REDACTED:phone]');
  });

  it('returns the first file for a duplicate id (AC15)', async () => {
    const root = tempRoot({
      'tickets/b/y.md': ticket('T-003', '', 'From b.\n'),
      'tickets/a/x.md': ticket('T-003', '', 'From a.\n'),
    });
    const result = await call(root, 'get_ticket', { id: 'T-003' });
    expect((result.structuredContent as { description: string }).description).toBe('From a.');
    expect(warnings()).toContainEqual(
      expect.objectContaining({ files: ['tickets/a/x.md', 'tickets/b/y.md'] }),
    );
  });

  it.each(['T-099', 'T-3', '', 'ADR-1'])(
    'returns a tool error with the available ids for %j',
    async (id) => {
      const result = await call(DEMO, 'get_ticket', { id });
      expect(result.isError).toBe(true);
      expect(text(result)).toBe(
        `Ticket "${id}" not found. Available ids: T-001, T-002, T-003, T-004. ` +
          'Call list_tickets for titles.',
      );
    },
  );

  it('returns a tool error with the reason for a file over --max-file-kb (FR-15)', async () => {
    const root = tempRoot({
      'tickets/T-1.md': ticket('T-1'),
      'tickets/T-2-big.md': ticket('T-2', '', `${'x'.repeat(2048)}\n`),
    });
    const result = await call(root, 'get_ticket', { id: 't-2' }, { maxFileKb: 1 });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      'Ticket "t-2" cannot be read: the file is larger than --max-file-kb (1 KB).',
    );
  });

  it.each([
    [
      'tickets/T-2-x.md',
      '---\nid: T-2\nlabels:\n  - api\n---\n',
      'the frontmatter is outside the supported subset',
    ],
    ['tickets/T-2.md', '# No frontmatter\n', 'the file has no frontmatter'],
    ['tickets/T-2.md', '---\ntitle: x\n---\n', 'the frontmatter has no id'],
    [
      'tickets/T-2.md',
      '---\nid: T 2\n---\n',
      'the id may only contain letters, digits, ".", "_" and "-"',
    ],
  ])('names the parse reason for skipped %s', async (path, content, reason) => {
    const root = tempRoot({ 'tickets/T-1.md': ticket('T-1'), [path]: content });
    const result = await call(root, 'get_ticket', { id: 'T-2' });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(`Ticket "T-2" cannot be read: ${reason}.`);

    const unknown = await call(root, 'get_ticket', { id: 'T-9' });
    expect(text(unknown)).toContain('Available ids: T-1, T-2.');
  });

  it('prefers a parsed ticket over a skipped file with the same filename id', async () => {
    const root = tempRoot({
      'tickets/T-1-broken.md': '# no frontmatter\n',
      'tickets/T-9-renamed.md': ticket('T-1', '', 'Real.\n'),
    });
    const result = await call(root, 'get_ticket', { id: 'T-1' });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { description: string }).description).toBe('Real.');
  });

  it('names --tickets-dir when the tickets directory is missing', async () => {
    const root = tempRoot({ 'README.md': '# x\n' });
    const result = await call(root, 'get_ticket', { id: 'T-1' });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      'Ticket "T-1" not found. Tickets directory not found: tickets. ' +
        'Set --tickets-dir if your tickets live elsewhere.',
    );
  });

  it('returns a tool error when there are no tickets', async () => {
    const root = tempRoot({ 'tickets/README.md': '# x\n' });
    const result = await call(root, 'get_ticket', { id: 'T-1' });
    expect(text(result)).toBe('Ticket "T-1" not found. There are no tickets in tickets.');
  });

  it('redacts frontmatter values in text and structuredContent', async () => {
    const root = tempRoot({
      'tickets/T-1.md': `---\nid: T-1\ntitle: "Mail ${EMAIL}"\nlabels: [${EMAIL}]\n---\n`,
    });
    const result = await call(root, 'get_ticket', { id: 'T-1' });
    expect(JSON.stringify(result)).not.toContain(EMAIL);
    expect(result.structuredContent).toMatchObject({
      title: 'Mail [REDACTED:email]',
      labels: ['[REDACTED:email]'],
    });
  });
});

describe('ticket parsing', () => {
  async function getTicket(body: string) {
    const root = tempRoot({ 'tickets/T-1.md': `---\nid: T-1\n---\n${body}` });
    const result = await call(root, 'get_ticket', { id: 'T-1' });
    expect(result.isError).toBeFalsy();
    return result.structuredContent as {
      description: string;
      acceptanceCriteria: { text: string; done: boolean }[];
    };
  }

  it('returns no criteria and the whole body without an acceptance section', async () => {
    expect(await getTicket('\nJust text.\n\n- [ ] not a criterion\n')).toEqual(
      expect.objectContaining({
        description: 'Just text.\n\n- [ ] not a criterion',
        acceptanceCriteria: [],
      }),
    );
  });

  it('keeps sections after the acceptance criteria in the description', async () => {
    const parsed = await getTicket(
      'Intro.\n\n## Acceptance Criteria\n\n- [X] One\n\n## Notes\n\nLater.\n',
    );
    expect(parsed.description).toBe('Intro.\n\n## Notes\n\nLater.');
    expect(parsed.acceptanceCriteria).toEqual([{ text: 'One', done: true }]);
  });

  it('joins indented continuation lines and ignores plain bullets and empty items', async () => {
    const parsed = await getTicket(
      '## Acceptance criteria\n\n' +
        '- [ ] First line\n      continues here\n' +
        '* [x] Star bullet\n' +
        '- plain bullet\n' +
        '- [ ]\n' +
        '  - [ ] Nested item\n' +
        '### Detail\n\n+ [ ] Under a subheading\n',
    );
    expect(parsed.acceptanceCriteria).toEqual([
      { text: 'First line continues here', done: false },
      { text: 'Star bullet', done: true },
      { text: 'Nested item', done: false },
      { text: 'Under a subheading', done: false },
    ]);
  });

  it('ignores checklist items inside a code fence in the acceptance section', async () => {
    const parsed = await getTicket(
      '## Acceptance criteria\n\n```md\n- [ ] in fence\n```\n\n- [ ] Real\n',
    );
    expect(parsed.acceptanceCriteria).toEqual([{ text: 'Real', done: false }]);
  });

  it('ignores an acceptance heading inside a code fence', async () => {
    const parsed = await getTicket('```md\n## Acceptance criteria\n- [ ] fake\n```\n');
    expect(parsed.acceptanceCriteria).toEqual([]);
  });

  it('shows (none) for a ticket without criteria in the text', async () => {
    const root = tempRoot({ 'tickets/T-1.md': '---\nid: T-1\ntitle: X\n---\n' });
    const result = await call(root, 'get_ticket', { id: 'T-1' });
    expect(text(result)).toBe(
      '# T-1: X\n\nStatus: (none)\n\n(no description)\n\n## Acceptance criteria\n\n(none)',
    );
  });
});

describe('ticket:// resource', () => {
  it('returns the raw markdown of demo T-002, redacted (AC22)', async () => {
    const result = await withClient(DEMO, (client) =>
      client.readResource({ uri: 'ticket://T-002' }),
    );
    const raw = readFileSync(join(DEMO, 'tickets/T-002-guide-contact-details.md'), 'utf8');
    const content = result.contents[0] as { text: string; mimeType: string };

    expect(content.mimeType).toBe('text/markdown');
    expect(content.text).toBe(
      raw
        .replace('maria.beispiel@example.com', '[REDACTED:email]')
        .replace('+49 170 0000000', '[REDACTED:phone]'),
    );
  });

  it('finds a ticket case-insensitively and writes one audit line with the scheme only', async () => {
    await withClient(DEMO, (client) => client.readResource({ uri: 'ticket://t-003' }));
    const audit = logLines().filter((line) => line.msg === 'audit');
    expect(audit).toEqual([expect.objectContaining({ event: 'resource_read', scheme: 'ticket' })]);
    expect(JSON.stringify(audit)).not.toMatch(/t-003/i);
  });

  it.each(['ticket://T-099', 'ticket://x'])('rejects unknown %s', async (uri) => {
    await expect(withClient(DEMO, (client) => client.readResource({ uri }))).rejects.toThrow(uri);
  });

  it('rejects a file whose frontmatter cannot be parsed as not found', async () => {
    const root = tempRoot({ 'tickets/T-2.md': '# no frontmatter\n' });
    await expect(
      withClient(root, (client) => client.readResource({ uri: 'ticket://T-2' })),
    ).rejects.toThrow('ticket://T-2');
  });

  it('reports a file over --max-file-kb without a host path', async () => {
    const root = tempRoot({ 'tickets/T-2.md': ticket('T-2', '', `${'x'.repeat(2048)}\n`) });
    const error = await withClient(root, (client) => client.readResource({ uri: 'ticket://T-2' }), {
      maxFileKb: 1,
    }).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(root);
  });

  it('lists every readable ticket with its title', async () => {
    const { resources } = await withClient(DEMO, (client) => client.listResources());
    const tickets = resources.filter((resource) => resource.uri.startsWith('ticket:'));

    expect(tickets.map((resource) => resource.uri)).toEqual([
      'ticket://T-001',
      'ticket://T-002',
      'ticket://T-003',
      'ticket://T-004',
    ]);
    expect(tickets[2]).toMatchObject({
      name: 'Ticket T-003',
      title: 'Rate-limit magic link requests',
      mimeType: 'text/markdown',
    });
  });

  it('redacts titles in the resource list', async () => {
    const root = tempRoot({ 'tickets/T-1.md': `---\nid: T-1\ntitle: "Ask ${EMAIL}"\n---\n` });
    const { resources } = await withClient(root, (client) => client.listResources());
    expect(JSON.stringify(resources)).not.toContain(EMAIL);
  });
});
