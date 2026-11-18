import { describe, expect, it } from 'vitest';
import { call, captureIo, DEMO, text } from './support.js';

captureIo();

describe('read-only tools reject unknown input fields', () => {
  it.each([
    ['list_adrs', { statuss: 'accepted' }],
    ['get_adr', { id: '2', format: 'raw' }],
    ['list_tickets', { lable: 'api' }],
    ['get_ticket', { id: 'T-003', full: true }],
    ['get_conventions', { file: 'CLAUDE.md' }],
    ['search_context', { query: 'authentication', kind: 'adr' }],
  ])('%s', async (tool, args) => {
    const result = await call(DEMO, tool, args);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(Object.keys(args).at(-1));
  });

  it('a typo in a filter returns an error, not an unfiltered list', async () => {
    const result = await call(DEMO, 'list_adrs', { statuss: 'accepted' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(text(result)).toMatch(/statuss/);
  });
});
