// Startup validation of root and source dirs. This module may use node:fs directly (see CLAUDE.md):
// safe-fs needs a validated root before it can do anything.
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import * as z from 'zod/v4';

const ConfigInputSchema = z.object({
  root: z.string({ error: '--root is required' }).min(1, { error: '--root is required' }),
  adrDir: z.string().min(1, { error: '--adr-dir must not be empty' }).default('docs/adr'),
  ticketsDir: z.string().min(1, { error: '--tickets-dir must not be empty' }).default('tickets'),
  maxFileKb: z.coerce
    .number()
    .int({ error: '--max-file-kb must be a positive integer' })
    .positive({ error: '--max-file-kb must be a positive integer' })
    .default(256),
  allowWrite: z.boolean().default(false),
});

export type Config = z.output<typeof ConfigInputSchema>;

export type ConfigResult =
  | { ok: true; config: Config; warnings: string[] }
  | { ok: false; error: string };

const SOURCE_DIRS = [
  { key: 'adrDir', flag: '--adr-dir', label: 'ADR', items: 'ADRs' },
  { key: 'ticketsDir', flag: '--tickets-dir', label: 'Tickets', items: 'tickets' },
] as const;

export function loadConfig(input: Record<string, unknown>): ConfigResult {
  const parsed = ConfigInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // NaN from z.coerce reports a type error, not our message.
    const message =
      issue?.path[0] === 'maxFileKb'
        ? '--max-file-kb must be a positive integer'
        : (issue?.message ?? 'Invalid configuration');
    return { ok: false, error: message };
  }

  const root = resolveRoot(parsed.data.root);
  if (!root.ok) return root;

  const config: Config = { ...parsed.data, root: root.path };
  const warnings: string[] = [];
  for (const { key, flag, label, items } of SOURCE_DIRS) {
    const dir = resolveSourceDir(root.path, config[key], flag);
    if (!dir.ok) return dir;
    config[key] = dir.relPath;
    if (!dir.exists) {
      warnings.push(
        `${label} directory not found: ${dir.relPath}. Set ${flag} if your ${items} live elsewhere.`,
      );
    }
  }
  return { ok: true, config, warnings };
}

function resolveRoot(input: string): { ok: true; path: string } | { ok: false; error: string } {
  let path: string;
  try {
    path = realpathSync(resolve(input));
  } catch {
    return { ok: false, error: `--root does not exist: ${input}` };
  }
  try {
    if (!statSync(path).isDirectory()) {
      return { ok: false, error: `--root is not a directory: ${input}` };
    }
  } catch (error) {
    return { ok: false, error: `--root cannot be checked: ${input} (${errorCode(error)})` };
  }
  return { ok: true, path };
}

type SourceDirResult =
  | { ok: true; relPath: string; exists: boolean }
  | { ok: false; error: string };

function resolveSourceDir(root: string, input: string, flag: string): SourceDirResult {
  try {
    return checkSourceDir(root, input, flag);
  } catch (error) {
    // ENOTDIR, EACCES and similar: report them instead of crashing with a stack trace.
    return { ok: false, error: `${flag} cannot be checked: ${input} (${errorCode(error)})` };
  }
}

function checkSourceDir(root: string, input: string, flag: string): SourceDirResult {
  const resolved = realpathOfNearestAncestor(resolve(root, input));
  if (resolved === undefined) {
    return { ok: false, error: `${flag} contains a broken symlink: ${input}` };
  }
  const { real, exists } = resolved;
  if (!isInside(root, real)) {
    return { ok: false, error: `${flag} resolves outside --root: ${input}` };
  }
  if (exists && !statSync(real).isDirectory()) {
    return { ok: false, error: `${flag} is not a directory: ${input}` };
  }
  const relPath = relative(root, real).split(sep).join('/') || '.';
  return { ok: true, relPath, exists };
}

// Path-based instead of a prefix check, so root '/' and dir names like '..foo' work.
function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? String(error);
}

// Resolves symlinks in the longest existing prefix, so a missing dir below a symlink that points
// outside root is still caught. Returns undefined for a broken symlink, whose target we cannot check.
function realpathOfNearestAncestor(abs: string): { real: string; exists: boolean } | undefined {
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
