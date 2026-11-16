import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../src');

// safe-fs is the file access module; config.ts validates root before safe-fs can exist (CLAUDE.md).
const ALLOWED = new Set(['fs/safe-fs.ts', 'config.ts']);

// Static and side-effect imports, dynamic import() and require(), each with or without node: and /promises.
const FS_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"](?:node:)?fs(?:\/promises)?['"]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('architecture', () => {
  it.each([
    "import { readFile } from 'fs';",
    "import { readFile } from 'fs/promises';",
    "import { readFileSync } from 'node:fs';",
    'import { readFile } from "node:fs/promises";',
    "import * as fs from 'node:fs';",
    "import 'fs';",
    "export { readFile } from 'node:fs/promises';",
    "const fs = await import('node:fs');",
    "const fs = require('fs');",
    'const fs = require("node:fs/promises");',
  ])('detects %s', (source) => {
    expect(FS_IMPORT.test(source)).toBe(true);
  });

  it.each([
    "import { join } from 'node:path';",
    "import { createSafeFs } from './fs/safe-fs.js';",
    "import watcher from 'fsevents';",
    "const label = 'fs';",
  ])('ignores %s', (source) => {
    expect(FS_IMPORT.test(source)).toBe(false);
  });

  it('only safe-fs and config import node:fs', () => {
    const offenders = sourceFiles(SRC)
      .map((path) => relative(SRC, path).split('\\').join('/'))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => FS_IMPORT.test(readFileSync(join(SRC, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });

  // Every result goes through the output boundary in result.ts (ADR 0003, ADR 0005).
  it('every tool file wraps its handler in withAudit', () => {
    const helpers = new Set(['result.ts', 'text.ts']);
    const offenders = readdirSync(join(SRC, 'tools'))
      .filter((name) => name.endsWith('.ts') && !helpers.has(name))
      .filter((name) => !/\bwithAudit\(/.test(readFileSync(join(SRC, 'tools', name), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('every resource file wraps its read and list callbacks', () => {
    const offenders = readdirSync(join(SRC, 'resources'))
      .filter((name) => name.endsWith('.ts'))
      .filter((name) => {
        const source = readFileSync(join(SRC, 'resources', name), 'utf8');
        const hasList = /\blist:\s*(?!undefined)/.test(source);
        return (
          !/\bwithResourceAudit\(/.test(source) ||
          (hasList && !/\blist:\s*withResourceList\(/.test(source))
        );
      });
    expect(offenders).toEqual([]);
  });
});
