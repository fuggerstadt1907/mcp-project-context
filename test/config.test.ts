import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

let base: string;
let root: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-config-')));
  root = join(base, 'project');
  mkdirSync(join(root, 'docs/adr'), { recursive: true });
  mkdirSync(join(root, 'tickets'));
  mkdirSync(join(base, 'other'));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function expectError(input: Record<string, unknown>, pattern: RegExp): void {
  const result = loadConfig(input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toMatch(pattern);
}

describe('loadConfig', () => {
  it('applies defaults', () => {
    const result = loadConfig({ root });
    expect(result).toEqual({
      ok: true,
      config: {
        root,
        adrDir: 'docs/adr',
        ticketsDir: 'tickets',
        maxFileKb: 256,
        allowWrite: false,
      },
      warnings: [],
    });
  });

  it('resolves root to its real path', () => {
    symlinkSync(root, join(base, 'link'));
    const result = loadConfig({ root: join(base, 'link') });
    expect(result.ok && result.config.root).toBe(root);
  });

  it('accepts explicit values', () => {
    mkdirSync(join(root, 'adr'));
    const result = loadConfig({
      root,
      adrDir: 'adr',
      ticketsDir: './tickets/',
      maxFileKb: '64',
      allowWrite: true,
    });
    expect(result.ok && result.config).toEqual({
      root,
      adrDir: 'adr',
      ticketsDir: 'tickets',
      maxFileKb: 64,
      allowWrite: true,
    });
  });

  it('accepts an absolute source dir inside root', () => {
    const result = loadConfig({ root, ticketsDir: join(root, 'tickets') });
    expect(result.ok && result.config.ticketsDir).toBe('tickets');
  });

  it('warns about a missing source dir inside root', () => {
    rmSync(join(root, 'tickets'), { recursive: true });
    const result = loadConfig({ root });
    expect(result.ok).toBe(true);
    expect(result.ok && result.warnings).toEqual([
      'Tickets directory not found: tickets. Set --tickets-dir if your tickets live elsewhere.',
    ]);
  });

  it('rejects a missing --root', () => {
    expectError({}, /--root is required/);
  });

  it('rejects a root that does not exist', () => {
    expectError({ root: join(base, 'nope') }, /--root does not exist/);
  });

  it('rejects a root that is a file', () => {
    writeFileSync(join(base, 'file.txt'), 'x');
    expectError({ root: join(base, 'file.txt') }, /--root is not a directory/);
  });

  it('rejects a source dir outside root via ..', () => {
    expectError({ root, ticketsDir: '../other' }, /--tickets-dir resolves outside --root/);
  });

  it('rejects a missing source dir outside root via ..', () => {
    expectError({ root, adrDir: '../missing/adr' }, /--adr-dir resolves outside --root/);
  });

  it('rejects an absolute source dir outside root', () => {
    expectError({ root, adrDir: join(base, 'other') }, /--adr-dir resolves outside --root/);
  });

  it('rejects a symlinked source dir pointing outside root', () => {
    symlinkSync(join(base, 'other'), join(root, 'linked'));
    expectError({ root, ticketsDir: 'linked' }, /--tickets-dir resolves outside --root/);
  });

  it('rejects a missing source dir below a symlink pointing outside root', () => {
    symlinkSync(join(base, 'other'), join(root, 'linked'));
    expectError({ root, ticketsDir: 'linked/tickets' }, /--tickets-dir resolves outside --root/);
  });

  it('rejects a broken symlink as source dir', () => {
    symlinkSync(join(base, 'missing'), join(root, 'dangling'));
    expectError({ root, ticketsDir: 'dangling' }, /--tickets-dir contains a broken symlink/);
  });

  it('rejects a source dir that is a file', () => {
    writeFileSync(join(root, 'tickets.md'), 'x');
    expectError({ root, ticketsDir: 'tickets.md' }, /--tickets-dir is not a directory/);
  });

  it('rejects a source dir below a file with a readable error', () => {
    writeFileSync(join(root, 'tickets.md'), 'x');
    expectError({ root, ticketsDir: 'tickets.md/sub' }, /--tickets-dir cannot be checked/);
  });

  it('accepts a source dir whose name starts with ..', () => {
    mkdirSync(join(root, '..tickets'));
    const result = loadConfig({ root, ticketsDir: '..tickets' });
    expect(result.ok && result.config.ticketsDir).toBe('..tickets');
  });

  it('accepts / as root', () => {
    const result = loadConfig({ root: '/', adrDir: 'mcp-config-missing-adr' });
    expect(result.ok).toBe(true);
  });

  it.each([
    ['adrDir', '--adr-dir'],
    ['ticketsDir', '--tickets-dir'],
  ])('rejects an empty %s naming the flag', (key, flag) => {
    expectError({ root, [key]: '' }, new RegExp(`${flag} must not be empty`));
  });

  it.each(['0', '-1', '1.5', 'abc'])('rejects --max-file-kb %s', (value) => {
    expectError({ root, maxFileKb: value }, /--max-file-kb must be a positive integer/);
  });
});
