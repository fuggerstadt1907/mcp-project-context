import { describe, expect, it } from 'vitest';
import { call, captureIo, DEMO, tempRoot, text } from './support.js';

captureIo();

// Joined from parts so secret scanning does not flag this file (decision 43).
const TOKEN_KEY = ['ghp_', 'a'.repeat(36)].join('');

describe('tools reject unknown input fields (decisions 93, 94)', () => {
  it.each([
    ['list_adrs', { statuss: 'accepted' }],
    ['get_adr', { id: '2', format: 'raw' }],
    ['list_tickets', { lable: 'api' }],
    ['get_ticket', { id: 'T-003', full: true }],
    ['get_conventions', { file: 'CLAUDE.md' }],
    ['search_context', { query: 'authentication', kind: 'adr' }],
  ])('%s names the unknown field', async (tool, args) => {
    const result = await call(DEMO, tool, args);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(`Unknown field(s): ${Object.keys(args).at(-1)}`);
  });

  it('a typo in a filter returns an error, not an unfiltered list', async () => {
    const result = await call(DEMO, 'list_adrs', { statuss: 'accepted' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it('lists several unknown fields in one message', async () => {
    const result = await call(DEMO, 'get_adr', { id: '2', a: 1, b: 2 });
    expect(text(result)).toContain('Unknown field(s): a, b');
  });

  it('redacts an unknown field name and never echoes its value', async () => {
    const result = await call(DEMO, 'get_ticket', { id: 'T-003', [TOKEN_KEY]: 'value-marker-7f3' });
    expect(text(result)).toContain('Unknown field(s): [REDACTED:github_token]');
    expect(JSON.stringify(result)).not.toContain(TOKEN_KEY);
    expect(JSON.stringify(result)).not.toContain('value-marker-7f3');
  });

  it('redacts an unknown field name in create_adr_draft too', async () => {
    const root = tempRoot({ 'docs/adr/0001-a.md': '# 0001: A\n' });
    const args = { title: 'T', context: 'c', decision: 'd', consequences: 'x', [TOKEN_KEY]: 1 };
    const result = await call(root, 'create_adr_draft', args, { allowWrite: true });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Unknown field(s): [REDACTED:github_token]');
    expect(JSON.stringify(result)).not.toContain(TOKEN_KEY);
  });

  it('accepts a call without arguments for tools with only optional fields', async () => {
    for (const tool of ['list_adrs', 'list_tickets', 'get_conventions']) {
      expect((await call(DEMO, tool)).isError).toBeFalsy();
    }
  });
});
