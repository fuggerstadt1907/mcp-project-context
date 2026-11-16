// The only way to read files. Every path is checked against root, the deny list, the extension
// allow-list and the size limit before anything is read.
import { lstatSync, realpathSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Config } from '../config.js';

export type SafeFsReason = 'outside_root' | 'denied' | 'extension' | 'too_large' | 'not_found';

export class SafeFsError extends Error {
  override readonly name = 'SafeFsError';

  constructor(
    readonly reason: SafeFsReason,
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}

export interface SafeFs {
  readTextFile(relPath: string): Promise<string>;
}

// config.root must be a real path, as loadConfig returns it.
export function createSafeFs(config: Pick<Config, 'root' | 'maxFileKb'>): SafeFs {
  const { root } = config;

  // Rules 1 and 2. Returns the real path; it may not exist yet.
  function resolveInsideRoot(relPath: string): { real: string; exists: boolean } {
    if (relPath.includes('\0')) {
      throw new SafeFsError('denied', relPath, `Path contains a NUL byte: ${relPath}`);
    }
    if (isAbsolute(relPath)) {
      throw new SafeFsError('outside_root', relPath, `Absolute paths are not allowed: ${relPath}`);
    }
    const abs = resolve(root, relPath);
    if (!isInside(root, abs)) throw outsideRoot(relPath);
    const resolved = realpathOfNearestAncestor(abs);
    // A broken symlink has no target we can check or read.
    if (resolved === undefined) throw notFound(relPath);
    if (!isInside(root, resolved.real)) throw outsideRoot(relPath);
    return resolved;
  }

  async function readTextFile(relPath: string): Promise<string> {
    const { real, exists } = resolveInsideRoot(relPath);
    if (!exists) throw notFound(relPath);
    const info = await stat(real).catch(() => undefined);
    if (!info?.isFile()) throw notFound(relPath);
    return readFile(real, 'utf8');
  }

  return { readTextFile };
}

function outsideRoot(relPath: string): SafeFsError {
  return new SafeFsError('outside_root', relPath, `Path is outside the project root: ${relPath}`);
}

function notFound(relPath: string): SafeFsError {
  return new SafeFsError('not_found', relPath, `File not found: ${relPath}`);
}

// Path-based instead of a prefix check, so root '/' and dir names like '..foo' work.
export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

// Resolves symlinks in the longest existing prefix, so a missing path below a symlink that points
// outside root is still caught. Returns undefined for a broken symlink, whose target we cannot check.
export function realpathOfNearestAncestor(
  abs: string,
): { real: string; exists: boolean } | undefined {
  const missing: string[] = [];
  let current = abs;
  while (true) {
    try {
      return { real: join(realpathSync(current), ...missing), exists: missing.length === 0 };
    } catch {
      if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) return undefined;
      const parent = dirname(current);
      if (parent === current) return { real: abs, exists: false };
      missing.unshift(basename(current));
      current = parent;
    }
  }
}
