// The only way to read files. Every path is checked against root, the deny list, the extension
// allow-list and the size limit before anything is read.
import { type Dirent, lstatSync, realpathSync } from 'node:fs';
import { access, constants, open, readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Config } from '../config.js';

export const ALLOWED_EXTENSIONS = ['.md', '.mdx', '.txt', '.yaml', '.yml', '.json'] as const;
const DENIED_SEGMENTS = new Set(['.git', 'node_modules']);

export type SafeFsReason =
  | 'outside_root'
  | 'denied'
  | 'extension'
  | 'too_large'
  | 'not_found'
  | 'unreadable';

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
  // False only for a missing file; a path that breaks a rule throws. Ignores the size limit.
  exists(relPath: string): Promise<boolean>;
  // Recursive, sorted, paths relative to root with '/'. Never enters symlinked directories.
  // Files over the size limit are listed, so callers can report them as skipped. Denied and
  // unreadable entries are left out.
  listFiles(relDir: string, options?: { extensions?: readonly string[] }): Promise<string[]>;
}

// config.root must be a real path, as loadConfig returns it.
export function createSafeFs(config: Pick<Config, 'root' | 'maxFileKb'>): SafeFs {
  const { root } = config;
  const maxBytes = config.maxFileKb * 1024;

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
    let resolved: ReturnType<typeof realpathOfNearestAncestor>;
    try {
      resolved = realpathOfNearestAncestor(abs);
    } catch {
      // EACCES on a parent directory. Node's message holds the absolute path, so drop it.
      throw unreadable(relPath);
    }
    // A broken symlink has no target we can check or read.
    if (resolved === undefined) throw notFound(relPath);
    if (!isInside(root, resolved.real)) throw outsideRoot(relPath);
    return resolved;
  }

  // Rules 3 and 4, on the requested path and on the symlink target, so a link cannot rename a
  // denied file into an allowed one or the other way round.
  function checkFileRules(relPath: string, real: string): void {
    for (const path of [relative(root, resolve(root, relPath)), relative(root, real)]) {
      if (isDenied(path)) {
        throw new SafeFsError('denied', relPath, `Path is on the deny list: ${relPath}`);
      }
    }
    for (const path of [relPath, real]) {
      if (!hasAllowedExtension(path)) {
        throw new SafeFsError(
          'extension',
          relPath,
          `File type is not allowed: ${relPath}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
        );
      }
    }
  }

  // Rules 1 to 4 plus "is a readable regular file". Returns the real path for rule 5.
  async function inspect(relPath: string): Promise<string> {
    const { real, exists } = resolveInsideRoot(relPath);
    if (real === root) throw notFound(relPath);
    checkFileRules(relPath, real);
    if (!exists) throw notFound(relPath);
    const info = await stat(real).catch((error: unknown) => {
      throw fromErrno(error, relPath);
    });
    if (!info.isFile()) throw notFound(relPath);
    await access(real, constants.R_OK).catch((error: unknown) => {
      throw fromErrno(error, relPath);
    });
    return real;
  }

  // Rule 5 runs on the open handle and caps the read, so a file that grows after the check
  // cannot get past the limit. A symlink swapped in between check and open is not caught.
  async function readTextFile(relPath: string): Promise<string> {
    const real = await inspect(relPath);
    const tooLarge = new SafeFsError(
      'too_large',
      relPath,
      `File is larger than ${config.maxFileKb} KB: ${relPath}`,
    );
    const handle = await open(real, 'r').catch((error: unknown) => {
      throw fromErrno(error, relPath);
    });
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw notFound(relPath);
      if (info.size > maxBytes) throw tooLarge;
      const buffer = Buffer.alloc(maxBytes + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length > maxBytes) throw tooLarge;
      return buffer.toString('utf8', 0, length);
    } catch (error) {
      throw fromErrno(error, relPath);
    } finally {
      await handle.close();
    }
  }

  async function exists(relPath: string): Promise<boolean> {
    try {
      await inspect(relPath);
      return true;
    } catch (error) {
      if (error instanceof SafeFsError && error.reason === 'not_found') return false;
      throw error;
    }
  }

  async function listFiles(
    relDir: string,
    options: { extensions?: readonly string[] } = {},
  ): Promise<string[]> {
    const { real, exists } = resolveInsideRoot(relDir);
    for (const path of [relative(root, resolve(root, relDir)), relative(root, real)]) {
      if (isDenied(path)) {
        throw new SafeFsError('denied', relDir, `Directory is on the deny list: ${relDir}`);
      }
    }
    const info = exists ? await stat(real).catch(() => undefined) : undefined;
    if (!info?.isDirectory()) {
      throw new SafeFsError('not_found', relDir, `Directory not found: ${relDir}`);
    }
    const entries = await readdir(real, { withFileTypes: true }).catch(() => {
      throw unreadable(relDir);
    });

    const wanted = options.extensions?.map((ext) => ext.toLowerCase());
    const files: string[] = [];
    const prefix = toPosix(relative(root, resolve(root, relDir)));
    await walk(entries, real, prefix, files);
    return files
      .filter((file) => wanted === undefined || wanted.includes(extname(file).toLowerCase()))
      .sort();
  }

  // Real directories only. Symlinked files go through inspect(), which checks their target;
  // symlinked directories are skipped, which also rules out cycles. Unreadable entries are skipped.
  async function walk(entries: Dirent[], absDir: string, relDir: string, out: string[]) {
    for (const entry of entries) {
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (isDeniedSegment(entry.name)) continue;
        const abs = join(absDir, entry.name);
        const children = await readdir(abs, { withFileTypes: true }).catch(() => undefined);
        if (children) await walk(children, abs, rel, out);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        const ok = await inspect(rel).then(
          () => true,
          (error: unknown) => {
            if (error instanceof SafeFsError) return false;
            throw error;
          },
        );
        if (ok) out.push(rel);
      }
    }
  }

  return { readTextFile, exists, listFiles };
}

function outsideRoot(relPath: string): SafeFsError {
  return new SafeFsError('outside_root', relPath, `Path is outside the project root: ${relPath}`);
}

function notFound(relPath: string): SafeFsError {
  return new SafeFsError('not_found', relPath, `File not found: ${relPath}`);
}

function unreadable(relPath: string): SafeFsError {
  return new SafeFsError('unreadable', relPath, `File cannot be read: ${relPath}`);
}

// Node errors carry absolute paths in their message; replace them with a SafeFsError.
function fromErrno(error: unknown, relPath: string): SafeFsError {
  if (error instanceof SafeFsError) return error;
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' ? notFound(relPath) : unreadable(relPath);
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

// Case-insensitive, because macOS and Windows file systems are: .GIT is .git there.
function isDenied(relPath: string): boolean {
  return relPath.split(sep).some(isDeniedSegment);
}

function isDeniedSegment(segment: string): boolean {
  const name = segment.toLowerCase();
  return DENIED_SEGMENTS.has(name) || name.startsWith('.env');
}

function hasAllowedExtension(path: string): boolean {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(extname(path).toLowerCase());
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
