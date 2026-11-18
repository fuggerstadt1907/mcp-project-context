import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../src');

// safe-fs is the file access module; config.ts validates root before safe-fs can exist (CLAUDE.md).
const ALLOWED = new Set(['fs/safe-fs.ts', 'config.ts']);

// Static and side-effect imports, dynamic import() and require(), each with or without node: and /promises.
const FS_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"](?:node:)?fs(?:\/promises)?['"]/;

// Calls that change the file system: writes, appends, directories, renames, deletes, links, and
// open() with a write flag. Sync and promise forms alike.
const FS_WRITE = new RegExp(
  [
    String.raw`\b(?:writeFile|appendFile|mkdir|mkdtemp|rename|rm|rmdir|unlink|copyFile|cp|truncate|ftruncate|symlink|link|chmod|chown|utimes|createWriteStream)(?:Sync)?\s*\(`,
    String.raw`\bopen(?:Sync)?\s*\([^)]*['"](?:w|wx|w\+|wx\+|a|ax|a\+|ax\+|r\+|rs\+)['"]`,
    String.raw`\bopen(?:Sync)?\s*\([^)]*\bO_(?:WRONLY|RDWR|CREAT|TRUNC|APPEND)\b`,
  ].join('|'),
);

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

  it.each([
    "await writeFile(path, text, { flag: 'wx' });",
    'writeFileSync(path, text);',
    'await appendFile(path, line);',
    'await mkdir(dir, { recursive: true });',
    'mkdirSync(dir);',
    'await rename(a, b);',
    'await rm(dir, { recursive: true });',
    'unlinkSync(path);',
    "const handle = await open(path, 'w');",
    "openSync(path, 'a+');",
    "await open(path, 'r+');",
    'await open(path, constants.O_WRONLY | constants.O_CREAT);',
    'createWriteStream(path);',
    'await copyFile(a, b);',
    'symlinkSync(target, path);',
  ])('detects the write %s', (source) => {
    expect(FS_WRITE.test(source)).toBe(true);
  });

  it.each([
    "const handle = await open(real, 'r');",
    'await readdir(real);',
    'await safeFs.writeTextFile(path, content, { overwrite: false });',
    'const form = transform(text);',
    'confirm(x);',
  ])('ignores %s', (source) => {
    expect(FS_WRITE.test(source)).toBe(false);
  });

  it('only safe-fs writes to the file system', () => {
    const offenders = sourceFiles(SRC)
      .map((path) => relative(SRC, path).split('\\').join('/'))
      .filter((rel) => rel !== 'fs/safe-fs.ts')
      .filter((rel) => FS_WRITE.test(readFileSync(join(SRC, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });

  // Every result goes through the output boundary in result.ts (ADR 0003, ADR 0005).
  it('every tool file wraps its handler in withAudit', () => {
    const offenders = toolFiles().filter(
      (name) => !/\bwithAudit\(/.test(readFileSync(join(SRC, 'tools', name), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  // Unknown input fields are an error, and their names are redacted (decisions 93, 94).
  it('every tool file builds its input schema with strictInput', () => {
    const offenders = toolFiles().filter(
      (name) =>
        !/\binputSchema: strictInput\(/.test(readFileSync(join(SRC, 'tools', name), 'utf8')),
    );
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

function toolFiles(): string[] {
  const helpers = new Set(['input.ts', 'result.ts', 'text.ts']);
  return readdirSync(join(SRC, 'tools')).filter(
    (name) => name.endsWith('.ts') && !helpers.has(name),
  );
}
