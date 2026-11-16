import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../src');

// safe-fs is the file access module; config.ts validates root before safe-fs can exist (CLAUDE.md).
const ALLOWED = new Set(['fs/safe-fs.ts', 'config.ts']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('architecture', () => {
  it('only safe-fs and config import node:fs', () => {
    const offenders = sourceFiles(SRC)
      .map((path) => relative(SRC, path).split('\\').join('/'))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) =>
        /from\s+['"](node:)?fs(\/promises)?['"]|import\(\s*['"](node:)?fs/.test(
          readFileSync(join(SRC, rel), 'utf8'),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
