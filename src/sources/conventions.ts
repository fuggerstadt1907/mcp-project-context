// Convention files from root, in a fixed order: team rules first, agent-specific rules after
// (requirements decisions 18 and 21). Missing files are skipped. Read on every call (ADR 0004).
import { type SafeFs, SafeFsError, type SafeFsReason } from '../fs/safe-fs.js';
import { log } from '../log.js';

export const CONVENTION_FILES = ['CONVENTIONS.md', 'CONTRIBUTING.md', 'CLAUDE.md', 'AGENTS.md'];

export interface ConventionFile {
  path: string;
  content: string;
}

export interface ConventionListing {
  files: ConventionFile[];
  // Files that exist but cannot be read (too large, unreadable). Missing files are not listed.
  skipped: { path: string; reason: SafeFsReason }[];
}

export interface ConventionSource {
  list(): Promise<ConventionListing>;
}

export function createConventionSource(safeFs: SafeFs): ConventionSource {
  async function list(): Promise<ConventionListing> {
    const result: ConventionListing = { files: [], skipped: [] };
    for (const path of CONVENTION_FILES) {
      try {
        result.files.push({ path, content: await safeFs.readTextFile(path) });
      } catch (error) {
        if (!(error instanceof SafeFsError)) throw error;
        if (error.reason === 'not_found') continue;
        log.warn('convention file skipped', { path, reason: error.reason });
        result.skipped.push({ path, reason: error.reason });
      }
    }
    return result;
  }

  return { list };
}
