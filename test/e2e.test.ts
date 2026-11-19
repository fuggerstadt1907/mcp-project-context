// End to end: one client session against examples/demo-project, the way an agent uses the server.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/client';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { captureIo, DEMO, withClient } from './support.js';

const { stderr, logLines } = captureIo();

// Every secret in the demo fixtures. Joined from parts so secret scanning does not flag this file
// (decision 43). A sanity test below checks that each one is really in the fixtures.
const FIXTURE_SECRETS = [
  ['sk_test_', 'FAKE_51HxDemoOnlyNotARealKey000'].join(''),
  ['ghp_', 'FAKEdemoToken', '0'.repeat(23)].join(''),
  ['maria.beispiel', '@', 'example.com'].join(''),
  ['+49 170 ', '0000000'].join(''),
];

// Distinctive parts of the secrets, so a leak that is cut off or reformatted is caught too.
const SECRET_PARTS = [
  ['FAKE_51Hx', 'DemoOnly'].join(''),
  ['FAKE', 'demoToken'].join(''),
  ['maria.beispiel', '@'].join(''),
  ['170 ', '0000000'].join(''),
];

// A fake token the agent sends itself, as a key, value, tool name or URI.
const AGENT_SECRET = ['ghp_', 'b'.repeat(36)].join('');

// Masks that prove the files holding the secrets were actually returned.
const EXPECTED_MASKS = [
  '[REDACTED:email]',
  '[REDACTED:phone]',
  '[REDACTED:assignment]',
  '[REDACTED:github_token]',
];

async function tool(client: Client, name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

/** Runs a request and returns its result or the error the client saw, so both can be checked. */
async function attempt(run: () => Promise<unknown>): Promise<unknown> {
  try {
    return await run();
  } catch (error) {
    return { thrown: error instanceof Error ? error.message : String(error) };
  }
}

function audits() {
  return logLines().filter((line) => line.msg === 'audit');
}

describe('e2e session against the demo project', () => {
  it('lists tools, searches, reads an ADR and a ticket, lists and reads resources', async () => {
    await withClient(DEMO, async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual([
        'list_adrs',
        'get_adr',
        'list_tickets',
        'get_ticket',
        'get_conventions',
        'search_context',
      ]);

      const search = await tool(client, 'search_context', { query: 'authentication' });
      expect(search.isError).toBeFalsy();
      const results = (search.structuredContent as { results: { kind: string; id: string }[] })
        .results;
      expect(results[0]).toMatchObject({ kind: 'adr', id: '0002' });

      const adr = await tool(client, 'get_adr', { id: '2' });
      expect(adr.structuredContent).toMatchObject({ id: '0002', status: 'Accepted' });
      expect((adr.structuredContent as { decision: string }).decision).toMatch(/magic link/i);

      const ticket = await tool(client, 'get_ticket', { id: 'T-003' });
      const criteria = (ticket.structuredContent as { acceptanceCriteria: { done: boolean }[] })
        .acceptanceCriteria;
      expect(criteria).toHaveLength(4);
      expect(criteria.every((c) => !c.done)).toBe(true);

      const { resources } = await client.listResources();
      const uris = resources.map((r) => r.uri);
      expect(uris).toEqual(expect.arrayContaining(['adr://0002', 'ticket://T-003']));
      expect(uris).toHaveLength(8);

      const read = await client.readResource({ uri: 'adr://0002' });
      const content = read.contents[0] as { uri: string; mimeType: string; text: string };
      expect(content).toMatchObject({ uri: 'adr://0002', mimeType: 'text/markdown' });
      expect(content.text).toMatch(/^# 0002: /);
    });
  });
});

describe('leak test (AC22, AC29)', () => {
  it('lists secrets that are really in the demo fixtures', () => {
    const fixtures = readdirSync(DEMO, { recursive: true, encoding: 'utf8' })
      .filter((path) => path.endsWith('.md'))
      .map((path) => readFileSync(join(DEMO, path), 'utf8'))
      .join('\n');
    for (const secret of FIXTURE_SECRETS) expect(fixtures).toContain(secret);
  });

  it('returns no fixture secret from any tool, resource or error, and logs none', async () => {
    const returned: unknown[] = [];
    const keep = (value: unknown) => {
      returned.push(value);
      return value;
    };

    await withClient(DEMO, async (client) => {
      keep(await client.listTools());
      keep(await client.listResourceTemplates());

      const adrs = keep(await tool(client, 'list_adrs')) as CallToolResult;
      for (const { id } of (adrs.structuredContent as { adrs: { id: string }[] }).adrs) {
        keep(await tool(client, 'get_adr', { id }));
      }
      const tickets = keep(await tool(client, 'list_tickets')) as CallToolResult;
      for (const { id } of (tickets.structuredContent as { tickets: { id: string }[] }).tickets) {
        keep(await tool(client, 'get_ticket', { id }));
      }
      keep(await tool(client, 'get_conventions'));
      for (const query of ['token', 'PAYMENT_API_KEY', 'maria', 'pilot guide', '170', 'sk_test']) {
        keep(await tool(client, 'search_context', { query, limit: 50 }));
      }

      const { resources } = keep(await client.listResources()) as {
        resources: { uri: string }[];
      };
      for (const { uri } of resources) keep(await client.readResource({ uri }));

      keep(await tool(client, 'get_adr', { id: '9999' }));
      keep(await tool(client, 'get_ticket', { id: 'T-999' }));
      keep(await tool(client, 'search_context', { query: '' }));
      keep(await attempt(() => client.readResource({ uri: 'ticket://T-999' })));
      keep(await attempt(() => tool(client, 'get_ticket', { id: 'T-002', extra: 1 })));
    });

    const all = JSON.stringify(returned);
    for (const mask of EXPECTED_MASKS) expect(all).toContain(mask);
    for (const secret of [...FIXTURE_SECRETS, ...SECRET_PARTS]) {
      expect(all).not.toContain(secret);
      expect(stderr()).not.toContain(secret);
    }
  });

  // The agent's own input can carry a secret. Every error the SDK or the server builds from it
  // must come back redacted (decision 99).
  it.each<[string, (client: Client) => Promise<unknown>]>([
    ['an unknown key', (c) => tool(c, 'get_ticket', { id: 'T-003', [AGENT_SECRET]: 1 })],
    [
      'an invalid enum value',
      (c) => tool(c, 'search_context', { query: 'x', kinds: [AGENT_SECRET] }),
    ],
    ['a status filter', (c) => tool(c, 'list_adrs', { status: AGENT_SECRET })],
    ['a wrong-typed value', (c) => tool(c, 'search_context', { query: 'x', limit: AGENT_SECRET })],
    ['a key of a wrong-typed value', (c) => tool(c, 'get_adr', { id: { [AGENT_SECRET]: 1 } })],
    ['an unknown id', (c) => tool(c, 'get_adr', { id: AGENT_SECRET })],
    ['an unknown tool name', (c) => tool(c, AGENT_SECRET)],
    ['an unknown resource id', (c) => c.readResource({ uri: `adr://${AGENT_SECRET}` })],
    ['an unknown resource scheme', (c) => c.readResource({ uri: `x://${AGENT_SECRET}` })],
  ])('returns no secret the agent sent as %s', async (_, run) => {
    const answer = await withClient(DEMO, (client) => attempt(() => run(client)));
    expect(JSON.stringify(answer)).not.toContain(AGENT_SECRET);
    expect(stderr()).not.toContain(AGENT_SECRET);
  });
});

describe('audit end to end (AC26)', () => {
  it('writes one line per tool call and resource read, without arguments, ids or content', async () => {
    await withClient(DEMO, async (client) => {
      await tool(client, 'get_ticket', { id: 'T-002' });
      await client.readResource({ uri: 'ticket://T-002' });
    });

    expect(audits()).toEqual([
      {
        time: expect.any(String),
        level: 'info',
        msg: 'audit',
        event: 'tool_call',
        tool: 'get_ticket',
        ok: true,
        ms: expect.any(Number),
        bytes: expect.any(Number),
        redactions: 4,
      },
      {
        time: expect.any(String),
        level: 'info',
        msg: 'audit',
        event: 'resource_read',
        scheme: 'ticket',
        ok: true,
        ms: expect.any(Number),
        bytes: expect.any(Number),
        redactions: 2,
      },
    ]);
    expect(stderr()).not.toMatch(/T-002|Maria|Guide contact/i);
  });

  // Decision 57: the SDK answers these before withAudit runs. Pinned so an SDK update that
  // changes it shows up here.
  it('writes no audit line for calls the SDK rejects before the handler', async () => {
    const answers = await withClient(DEMO, async (client) => [
      await attempt(() => tool(client, 'get_adr', { id: 2 })),
      await attempt(() => tool(client, 'get_adr', { id: '2', secret: 'hunter2-value' })),
      await attempt(() => tool(client, 'no_such_tool')),
      await attempt(() => client.readResource({ uri: 'nope://0002' })),
    ]);

    expect(audits()).toEqual([]);
    for (const answer of answers) {
      const isError = (answer as CallToolResult).isError === true || 'thrown' in (answer as object);
      expect(isError).toBe(true);
    }
    expect(JSON.stringify(answers)).not.toContain('hunter2-value');
  });
});
