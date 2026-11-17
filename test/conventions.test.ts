import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { call, captureIo, connect, DEMO, tempRoot, text } from './support.js';

const { logLines } = captureIo();

function paths(result: { structuredContent?: unknown }): string[] {
  return (result.structuredContent as { files: { path: string }[] }).files.map((f) => f.path);
}

describe('get_conventions', () => {
  it('is listed as a read-only tool with an output schema', async () => {
    const client = await connect(DEMO);
    const { tools } = await client.listTools();
    await client.close();

    const tool = tools.find((candidate) => candidate.name === 'get_conventions');
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.outputSchema).toBeDefined();
  });

  it('returns the files in fixed order and skips missing ones (AC7)', async () => {
    const root = tempRoot({
      'AGENTS.md': '# Agents\n\nAsk first.\n',
      'CLAUDE.md': '# Claude\n\nNever write to stdout.\n',
      'CONVENTIONS.md': '# Conventions\n\nUse kebab-case.\n',
    });

    const result = await call(root, 'get_conventions');

    expect(result.isError).toBeFalsy();
    expect(paths(result)).toEqual(['CONVENTIONS.md', 'CLAUDE.md', 'AGENTS.md']);
    expect(result.structuredContent).toMatchObject({
      files: [{ content: '# Conventions\n\nUse kebab-case.\n' }, {}, {}],
    });
    const body = text(result);
    expect(body.indexOf('## CONVENTIONS.md')).toBeLessThan(body.indexOf('## CLAUDE.md'));
    expect(body.indexOf('## CLAUDE.md')).toBeLessThan(body.indexOf('## AGENTS.md'));
    expect(body).toContain('Never write to stdout.');
  });

  it('returns CONTRIBUTING.md between CONVENTIONS.md and CLAUDE.md', async () => {
    const root = tempRoot({
      'CLAUDE.md': 'c',
      'CONTRIBUTING.md': 'b',
      'CONVENTIONS.md': 'a',
    });
    expect(paths(await call(root, 'get_conventions'))).toEqual([
      'CONVENTIONS.md',
      'CONTRIBUTING.md',
      'CLAUDE.md',
    ]);
  });

  it('redacts the fake secrets in the demo CONVENTIONS.md', async () => {
    const result = await call(DEMO, 'get_conventions');
    const output = JSON.stringify(result);

    expect(paths(result)).toEqual(['CONVENTIONS.md']);
    expect(output).not.toContain('sk_test_FAKE');
    expect(output).not.toContain('ghp_FAKE');
    expect(text(result)).toContain('[REDACTED:assignment]');
    expect(text(result)).toContain('[REDACTED:github_token]');
  });

  it('returns an empty list with a hint when no file exists', async () => {
    const result = await call(tempRoot({ 'README.md': '# Readme\n' }), 'get_conventions');

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ files: [] });
    expect(text(result)).toBe(
      'No convention files in root. Looked for CONVENTIONS.md, CONTRIBUTING.md, CLAUDE.md, AGENTS.md.',
    );
  });

  it('skips a file over --max-file-kb, says so and warns (FR-15)', async () => {
    const root = tempRoot({ 'CONVENTIONS.md': 'x'.repeat(2048), 'AGENTS.md': 'Ask first.\n' });

    const result = await call(root, 'get_conventions', {}, { maxFileKb: 1 });

    expect(paths(result)).toEqual(['AGENTS.md']);
    expect(text(result)).toContain('1 file skipped (too large).');
    expect(text(result)).not.toContain('xxxx');
    expect(logLines()).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        msg: 'convention file skipped',
        path: 'CONVENTIONS.md',
        reason: 'too_large',
      }),
    );
  });

  it('reads the files again on every call (ADR 0004)', async () => {
    const root = tempRoot({ 'CONVENTIONS.md': 'old\n' });
    const client = await connect(root);

    await client.callTool({ name: 'get_conventions', arguments: {} });
    writeFileSync(join(root, 'AGENTS.md'), 'new\n');
    const second = await client.callTool({ name: 'get_conventions', arguments: {} });
    await client.close();

    expect(paths(second)).toEqual(['CONVENTIONS.md', 'AGENTS.md']);
  });
});
