import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { createSafeFs, type SafeFs, SafeFsError, type SafeFsReason } from '../src/fs/safe-fs.js';

let base: string;
let root: string;
let safeFs: SafeFs;

function write(rel: string, content = 'hello'): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    root,
    adrDir: 'docs/adr',
    ticketsDir: 'tickets',
    maxFileKb: 1,
    allowWrite: false,
    ...overrides,
  };
}

async function expectReason(promise: Promise<unknown>, reason: SafeFsReason): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SafeFsError);
  expect((error as SafeFsError).reason).toBe(reason);
}

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-safe-fs-')));
  root = join(base, 'project');
  mkdirSync(root);
  writeFileSync(join(base, 'secret.md'), 'outside root');
  safeFs = createSafeFs(makeConfig());
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('readTextFile', () => {
  it('reads a nested markdown file inside root', async () => {
    write('docs/adr/0001-x.md', '# ADR 1');
    await expect(safeFs.readTextFile('docs/adr/0001-x.md')).resolves.toBe('# ADR 1');
  });

  it('rejects ../ escapes', async () => {
    await expectReason(safeFs.readTextFile('../secret.md'), 'outside_root');
    await expectReason(safeFs.readTextFile('docs/../../secret.md'), 'outside_root');
  });

  it('rejects absolute paths', async () => {
    await expectReason(safeFs.readTextFile('/etc/passwd'), 'outside_root');
    await expectReason(safeFs.readTextFile(join(root, 'a.md')), 'outside_root');
  });

  it('rejects NUL bytes', async () => {
    await expectReason(safeFs.readTextFile('a.md\0.txt'), 'denied');
  });

  it('rejects a symlink inside root that points outside', async () => {
    symlinkSync(join(base, 'secret.md'), join(root, 'link.md'));
    await expectReason(safeFs.readTextFile('link.md'), 'outside_root');
  });

  it('rejects a path below a symlinked dir that points outside', async () => {
    symlinkSync(base, join(root, 'up'));
    await expectReason(safeFs.readTextFile('up/secret.md'), 'outside_root');
    await expectReason(safeFs.readTextFile('up/missing.md'), 'outside_root');
  });

  it('reports a missing file, a broken symlink and a directory as not_found', async () => {
    mkdirSync(join(root, 'dir.md'));
    symlinkSync(join(root, 'nowhere.md'), join(root, 'broken.md'));
    await expectReason(safeFs.readTextFile('missing.md'), 'not_found');
    await expectReason(safeFs.readTextFile('broken.md'), 'not_found');
    await expectReason(safeFs.readTextFile('dir.md'), 'not_found');
  });

  it('denies .env files, .git and node_modules', async () => {
    write('.env', 'SECRET=1');
    write('config/.env.local.md', 'SECRET=1');
    write('.git/config');
    write('node_modules/x/readme.md');
    await expectReason(safeFs.readTextFile('.env'), 'denied');
    await expectReason(safeFs.readTextFile('config/.env.local.md'), 'denied');
    await expectReason(safeFs.readTextFile('.git/config'), 'denied');
    await expectReason(safeFs.readTextFile('node_modules/x/readme.md'), 'denied');
  });

  it('denies a missing .env without revealing that it does not exist', async () => {
    await expectReason(safeFs.readTextFile('.env.production'), 'denied');
  });

  it('denies a symlink whose target is denied, and a denied link name', async () => {
    write('.env', 'SECRET=1');
    write('notes.md');
    symlinkSync(join(root, '.env'), join(root, 'notes-link.md'));
    symlinkSync(join(root, 'notes.md'), join(root, '.env.md'));
    await expectReason(safeFs.readTextFile('notes-link.md'), 'denied');
    await expectReason(safeFs.readTextFile('.env.md'), 'denied');
  });

  it('rejects extensions outside the allow-list', async () => {
    write('src/index.ts');
    write('README');
    await expectReason(safeFs.readTextFile('src/index.ts'), 'extension');
    await expectReason(safeFs.readTextFile('README'), 'extension');
  });

  it('checks the extension of the symlink target too', async () => {
    write('src/index.ts');
    symlinkSync(join(root, 'src/index.ts'), join(root, 'code.md'));
    await expectReason(safeFs.readTextFile('code.md'), 'extension');
  });

  it('reads every allowed extension, case-insensitively', async () => {
    for (const name of ['a.md', 'b.mdx', 'c.txt', 'd.yaml', 'e.yml', 'f.json', 'G.MD']) {
      write(name, name);
      await expect(safeFs.readTextFile(name)).resolves.toBe(name);
    }
  });

  it('rejects files over maxFileKb and reads files at the limit', async () => {
    write('big.md', 'x'.repeat(1025));
    write('limit.md', 'x'.repeat(1024));
    await expectReason(safeFs.readTextFile('big.md'), 'too_large');
    await expect(safeFs.readTextFile('limit.md')).resolves.toHaveLength(1024);
  });

  it('applies the rules in order: outside_root before denied before extension', async () => {
    writeFileSync(join(base, '.env'), 'SECRET=1');
    write('.git/hooks/pre-commit');
    await expectReason(safeFs.readTextFile('../.env'), 'outside_root');
    await expectReason(safeFs.readTextFile('.git/hooks/pre-commit'), 'denied');
  });

  it('does not put the real path of a symlink target into the message', async () => {
    symlinkSync(join(base, 'secret.md'), join(root, 'link.md'));
    const error = await safeFs.readTextFile('link.md').catch((e: unknown) => e);
    expect((error as Error).message).not.toContain(base);
  });
});

describe('exists', () => {
  it('is true for a readable file, also when it is too large', async () => {
    write('CLAUDE.md');
    write('big.md', 'x'.repeat(2048));
    await expect(safeFs.exists('CLAUDE.md')).resolves.toBe(true);
    await expect(safeFs.exists('big.md')).resolves.toBe(true);
  });

  it('is false for a missing file, a broken symlink and a directory', async () => {
    mkdirSync(join(root, 'dir.md'));
    symlinkSync(join(root, 'nowhere.md'), join(root, 'broken.md'));
    await expect(safeFs.exists('AGENTS.md')).resolves.toBe(false);
    await expect(safeFs.exists('broken.md')).resolves.toBe(false);
    await expect(safeFs.exists('dir.md')).resolves.toBe(false);
  });

  it('throws for paths that break a rule', async () => {
    write('.env');
    await expectReason(safeFs.exists('../secret.md'), 'outside_root');
    await expectReason(safeFs.exists('.env'), 'denied');
    await expectReason(safeFs.exists('a.ts'), 'extension');
  });
});

describe('listFiles', () => {
  it('lists allowed files recursively, sorted, relative to root', async () => {
    write('tickets/b/y.md');
    write('tickets/a/x.md');
    write('tickets/T-001.md');
    write('tickets/notes.txt');
    write('tickets/script.ts');
    write('other/z.md');
    await expect(safeFs.listFiles('tickets')).resolves.toEqual([
      'tickets/T-001.md',
      'tickets/a/x.md',
      'tickets/b/y.md',
      'tickets/notes.txt',
    ]);
  });

  it('filters by extension within the allow-list', async () => {
    write('docs/a.md');
    write('docs/b.json');
    write('docs/c.ts');
    await expect(safeFs.listFiles('docs', { extensions: ['.md'] })).resolves.toEqual(['docs/a.md']);
    await expect(safeFs.listFiles('docs', { extensions: ['.ts'] })).resolves.toEqual([]);
  });

  it('lists the root itself', async () => {
    write('CLAUDE.md');
    write('docs/a.md');
    await expect(safeFs.listFiles('.')).resolves.toEqual(['CLAUDE.md', 'docs/a.md']);
  });

  it('never returns denied files', async () => {
    write('a.md');
    write('.env.md');
    write('.git/x.md');
    write('node_modules/x/readme.md');
    write('sub/node_modules/y.md');
    await expect(safeFs.listFiles('.')).resolves.toEqual(['a.md']);
  });

  it('keeps files over the size limit, so callers can report them as skipped', async () => {
    write('docs/big.md', 'x'.repeat(2048));
    await expect(safeFs.listFiles('docs')).resolves.toEqual(['docs/big.md']);
  });

  it('does not follow symlinked directories', async () => {
    mkdirSync(join(base, 'outside'));
    writeFileSync(join(base, 'outside/leak.md'), 'outside root');
    write('docs/inside/a.md');
    symlinkSync(join(base, 'outside'), join(root, 'docs/out'));
    symlinkSync(join(root, 'docs/inside'), join(root, 'docs/again'));
    symlinkSync(join(root, 'docs'), join(root, 'docs/loop'));
    await expect(safeFs.listFiles('docs')).resolves.toEqual(['docs/inside/a.md']);
  });

  it('keeps symlinked files only if their target passes every rule', async () => {
    write('docs/a.md');
    write('.env', 'SECRET=1');
    write('src/x.ts');
    symlinkSync(join(root, 'docs/a.md'), join(root, 'docs/ok.md'));
    symlinkSync(join(base, 'secret.md'), join(root, 'docs/outside.md'));
    symlinkSync(join(root, '.env'), join(root, 'docs/env.md'));
    symlinkSync(join(root, 'src/x.ts'), join(root, 'docs/code.md'));
    symlinkSync(join(root, 'docs/nowhere.md'), join(root, 'docs/broken.md'));
    await expect(safeFs.listFiles('docs')).resolves.toEqual(['docs/a.md', 'docs/ok.md']);
  });

  it('rejects a directory outside root or on the deny list', async () => {
    write('.git/x.md');
    symlinkSync(base, join(root, 'up'));
    await expectReason(safeFs.listFiles('..'), 'outside_root');
    await expectReason(safeFs.listFiles('up'), 'outside_root');
    await expectReason(safeFs.listFiles('.git'), 'denied');
  });

  it('reports a missing directory or a file as not_found', async () => {
    write('a.md');
    await expectReason(safeFs.listFiles('tickets'), 'not_found');
    await expectReason(safeFs.listFiles('a.md'), 'not_found');
  });
});
