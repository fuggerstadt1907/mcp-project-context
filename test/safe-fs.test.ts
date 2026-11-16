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

  it('does not put the real path of a symlink target into the message', async () => {
    symlinkSync(join(base, 'secret.md'), join(root, 'link.md'));
    const error = await safeFs.readTextFile('link.md').catch((e: unknown) => e);
    expect((error as Error).message).not.toContain(base);
  });
});
