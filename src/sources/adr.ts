// ADRs from `<adrDir>/NNNN-slug.md`. Only files directly in adrDir with a number prefix count;
// drafts/, other subdirectories and files like README.md are ignored. Read on every call (ADR 0004).
import { type SafeFs, SafeFsError, type SafeFsReason } from '../fs/safe-fs.js';
import { log } from '../log.js';
import { findHeadings } from './markdown.js';

export interface Adr {
  id: string;
  title: string;
  status: string;
  date: string;
  context: string;
  decision: string;
  consequences: string;
}

export type AdrSummary = Pick<Adr, 'id' | 'title' | 'status' | 'date'>;

export interface SkippedFile {
  path: string;
  reason: SafeFsReason;
}

export interface AdrListing {
  adrs: Adr[];
  skipped: SkippedFile[];
  // The ADR directory does not exist (FR-16).
  missingDir: boolean;
}

export type AdrLookup =
  | { found: true; adr: Adr; raw: string }
  // Unknown or malformed id. `available` holds every ADR id on disk, including skipped files.
  | { found: false; available: string[]; missingDir: boolean }
  // The file exists but cannot be read (too large, unreadable).
  | { found: false; available: string[]; error: SafeFsError };

export interface AdrSource {
  list(): Promise<AdrListing>;
  get(id: string): Promise<AdrLookup>;
}

interface AdrFile {
  id: string;
  slug: string;
  path: string;
}

const FILE_NAME = /^(\d+)-(.+)\.md$/i;
const SECTIONS = ['context', 'decision', 'consequences'] as const;

/** `"3"`, `"03"` and `"0003"` all become `"0003"`. Anything that is not only digits is undefined. */
export function normalizeAdrId(input: string): string | undefined {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  return trimmed.replace(/^0+(?=\d)/, '').padStart(4, '0');
}

export function createAdrSource(safeFs: SafeFs, adrDir: string): AdrSource {
  async function files(): Promise<{ files: AdrFile[]; missingDir: boolean }> {
    let paths: string[];
    try {
      paths = await safeFs.listFiles(adrDir, { extensions: ['.md'] });
    } catch (error) {
      if (error instanceof SafeFsError && error.reason === 'not_found') {
        return { files: [], missingDir: true };
      }
      throw error;
    }
    // listFiles returns paths relative to root; adrDir '.' gives paths without a prefix.
    const prefix = adrDir === '.' ? '' : `${adrDir}/`;
    const byId = new Map<string, AdrFile>();
    for (const path of paths) {
      const name = path.slice(prefix.length);
      if (name.includes('/')) continue;
      const match = FILE_NAME.exec(name);
      if (!match) continue;
      const id = normalizeAdrId(match[1] as string) as string;
      const existing = byId.get(id);
      if (existing) {
        // Paths are sorted, so the first one wins, as for duplicate ticket ids (FR-12).
        log.warn('duplicate ADR id, keeping the first file', { files: [existing.path, path] });
        continue;
      }
      byId.set(id, { id, slug: match[2] as string, path });
    }
    const sorted = [...byId.values()].sort((a, b) => compareIds(a.id, b.id));
    return { files: sorted, missingDir: false };
  }

  async function read(file: AdrFile): Promise<{ adr: Adr; raw: string }> {
    const raw = await safeFs.readTextFile(file.path);
    return { adr: parseAdr(file, raw), raw };
  }

  async function list(): Promise<AdrListing> {
    const { files: adrFiles, missingDir } = await files();
    const adrs: Adr[] = [];
    const skipped: SkippedFile[] = [];
    for (const file of adrFiles) {
      try {
        adrs.push((await read(file)).adr);
      } catch (error) {
        if (!(error instanceof SafeFsError)) throw error;
        log.warn('ADR skipped', { path: file.path, reason: error.reason });
        skipped.push({ path: file.path, reason: error.reason });
      }
    }
    return { adrs, skipped, missingDir };
  }

  async function get(input: string): Promise<AdrLookup> {
    const { files: adrFiles, missingDir } = await files();
    const available = adrFiles.map((file) => file.id);
    const id = normalizeAdrId(input);
    const file = adrFiles.find((candidate) => candidate.id === id);
    if (!file) return { found: false, available, missingDir };
    try {
      return { found: true, ...(await read(file)) };
    } catch (error) {
      if (!(error instanceof SafeFsError)) throw error;
      log.warn('ADR skipped', { path: file.path, reason: error.reason });
      return { found: false, available, error };
    }
  }

  return { list, get };
}

function compareIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * Parses one ADR. Never fails: a file that does not follow the template keeps what can be found
 * (requirements decision 4) and a warning names what is missing.
 */
function parseAdr(file: AdrFile, markdown: string): Adr {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const headings = findHeadings(lines);

  const titleHeading = headings.find((heading) => heading.level === 1);
  const title = titleHeading
    ? titleHeading.text.replace(/^\d+\s*:\s*/, '').trim() || file.slug
    : file.slug;

  // Status and Date bullets count only before the first section, so a bullet inside
  // Consequences is not taken for the ADR's status.
  const firstSection = headings.find((heading) => heading.level >= 2)?.line ?? lines.length;
  const header = lines.slice(0, firstSection);
  const status = bullet(header, 'status');
  const date = bullet(header, 'date') ?? '';

  const sections: Record<(typeof SECTIONS)[number], string | undefined> = {
    context: undefined,
    decision: undefined,
    consequences: undefined,
  };
  for (const [index, heading] of headings.entries()) {
    const name = heading.text.toLowerCase() as (typeof SECTIONS)[number];
    if (heading.level !== 2 || !SECTIONS.includes(name) || sections[name] !== undefined) continue;
    const end = headings.slice(index + 1).find((next) => next.level <= 2)?.line ?? lines.length;
    sections[name] = lines
      .slice(heading.line + 1, end)
      .join('\n')
      .trim();
  }

  const missing = [
    ...(titleHeading ? [] : ['title']),
    ...(status === undefined ? ['status'] : []),
    ...SECTIONS.filter((name) => sections[name] === undefined),
  ];
  if (missing.length > 0) {
    log.warn('ADR does not follow the template', { path: file.path, missing });
  }

  const noSections = SECTIONS.every((name) => sections[name] === undefined);
  const body = lines
    .slice(titleHeading ? titleHeading.line + 1 : 0)
    .join('\n')
    .trim();

  return {
    id: file.id,
    title,
    status: status ?? 'Unknown',
    date,
    context: noSections ? body : (sections.context ?? ''),
    decision: sections.decision ?? '',
    consequences: sections.consequences ?? '',
  };
}

// `- Status: Accepted`, also with `*` or `+` bullets and `**Status**:` in bold.
function bullet(lines: string[], key: string): string | undefined {
  const pattern = new RegExp(
    `^\\s*[-*+]\\s+(?:\\*\\*)?${key}(?:\\*\\*)?\\s*:(?:\\*\\*)?\\s*(.*)$`,
    'i',
  );
  for (const line of lines) {
    const match = pattern.exec(line);
    // An empty value counts as missing, so `- Status:` gives `Unknown`.
    if (match) return (match[1] as string).trim() || undefined;
  }
  return undefined;
}
