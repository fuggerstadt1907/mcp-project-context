// ADRs from `<adrDir>/NNNN-slug.md`. Only files directly in adrDir with a number prefix count;
// drafts/, other subdirectories and files like README.md are ignored. Read on every call (ADR 0004).
import { type SafeFs, SafeFsError, type SafeFsReason } from '../fs/safe-fs.js';
import { log } from '../log.js';
import { parseFrontmatter } from './frontmatter.js';
import { findHeadings, type Heading } from './markdown.js';

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
type Section = (typeof SECTIONS)[number];
// Section headings (any case), including the MADR 3 names.
const SECTION_NAMES: Record<string, Section> = Object.assign(Object.create(null), {
  context: 'context',
  'context and problem statement': 'context',
  decision: 'decision',
  'decision outcome': 'decision',
  consequences: 'consequences',
});

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
  const frontmatter = readFrontmatter(file, markdown);
  const lines = frontmatter.body.replace(/\r\n?/g, '\n').split('\n');
  const headings = findHeadings(lines);

  const titleHeading = headings.find((heading) => heading.level === 1);
  const title = titleHeading ? stripNumber(titleHeading.text) || file.slug : file.slug;

  // Bullets and the Date line count only before the first section, so a bullet inside
  // Consequences is not taken for the ADR's status.
  const firstSection = headings.find((heading) => heading.level >= 2)?.line ?? lines.length;
  const header = lines.slice(0, firstSection);
  const statusSection = section(lines, headings, 'status');
  const status = cutBy(
    frontmatter.status ?? bullet(header, 'status') ?? firstLine(statusSection?.text),
  );
  const date = frontmatter.date ?? bullet(header, 'date') ?? dateLine(header) ?? '';

  const sections: Record<Section, string | undefined> = {
    context: undefined,
    decision: undefined,
    consequences: undefined,
  };
  // MADR's `## Decision Outcome`, if that is where the decision came from.
  let outcome: { index: number; end: number } | undefined;
  for (const [index, heading] of headings.entries()) {
    const name = SECTION_NAMES[heading.text.toLowerCase()];
    if (heading.level !== 2 || name === undefined || sections[name] !== undefined) continue;
    const end = sectionEnd(lines, headings, index);
    sections[name] = text(lines, heading.line + 1, end);
    if (heading.text.toLowerCase() === 'decision outcome') outcome = { index, end };
  }

  // MADR keeps consequences as `### Consequences` inside Decision Outcome. A `## Consequences`
  // section wins, and Decision Outcome then stays whole.
  if (outcome && sections.consequences === undefined) {
    const start = (headings[outcome.index] as Heading).line;
    const subIndex = headings.findIndex(
      (heading, index) =>
        index > outcome.index &&
        heading.line < outcome.end &&
        heading.level === 3 &&
        heading.text.toLowerCase() === 'consequences',
    );
    const sub = headings[subIndex];
    if (sub) {
      const subEnd = sectionEnd(lines, headings, subIndex);
      sections.consequences = text(lines, sub.line + 1, subEnd);
      sections.decision = [...lines.slice(start + 1, sub.line), ...lines.slice(subEnd, outcome.end)]
        .join('\n')
        .trim();
    }
  }

  const missing = [
    ...(titleHeading ? [] : ['title']),
    ...(status === undefined ? ['status'] : []),
    // Consequences are optional in MADR.
    ...SECTIONS.filter(
      (name) => sections[name] === undefined && !(name === 'consequences' && outcome),
    ),
  ];
  if (missing.length > 0) {
    log.warn('ADR does not follow the template', { path: file.path, missing });
  }

  // Without sections the body goes into context, minus the Status section that gave the status.
  const noSections = SECTIONS.every((name) => sections[name] === undefined);
  const body = lines
    .filter(
      (_, line) =>
        line > (titleHeading?.line ?? -1) &&
        !(statusSection && line >= statusSection.start && line < statusSection.end),
    )
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

// MADR 3 frontmatter. Only `status` and `date` are read; an array or empty value counts as missing.
// Frontmatter outside the subset is ignored with a warning, the ADR is still listed (FR-14).
function readFrontmatter(
  file: AdrFile,
  markdown: string,
): { body: string; status?: string | undefined; date?: string | undefined } {
  const result = parseFrontmatter(markdown);
  if (result.kind === 'none') return { body: markdown };
  if (result.kind === 'invalid') {
    // Without a closing line the `---` is probably a thematic break, not frontmatter.
    if (result.body === undefined) return { body: markdown };
    log.warn('ADR frontmatter ignored', {
      path: file.path,
      line: result.line,
      problem: result.problem,
    });
    return { body: result.body };
  }
  const text = (key: string) => {
    const value = result.data[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  };
  return { body: result.body, status: text('status'), date: text('date') };
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

// `# 0003: Title` and Nygard's `# 1. Title`. `1.5 release` is not a number prefix.
function stripNumber(title: string): string {
  return title
    .replace(/^\d+\s*:\s*/, '')
    .replace(/^\d+\.\s+/, '')
    .trim();
}

// Nygard's plain `Date: 2026-01-01` line, also in bold. Case-sensitive, so the `date:` line of an
// unclosed frontmatter block is not taken for it.
function dateLine(lines: string[]): string | undefined {
  for (const line of lines) {
    const match = /^\s*(?:\*\*)?Date(?:\*\*)?\s*:(?:\*\*)?\s*(.*)$/.exec(line);
    if (match) return (match[1] as string).trim() || undefined;
  }
  return undefined;
}

// The first level-2 section with this name (any case): its text and line range, heading included.
function section(
  lines: string[],
  headings: Heading[],
  name: string,
): { start: number; end: number; text: string } | undefined {
  const index = headings.findIndex(
    (heading) => heading.level === 2 && heading.text.toLowerCase() === name,
  );
  const heading = headings[index];
  if (!heading) return undefined;
  const end = sectionEnd(lines, headings, index);
  return { start: heading.line, end, text: text(lines, heading.line + 1, end) };
}

// A section runs to the next heading of the same or a higher level.
function sectionEnd(lines: string[], headings: Heading[], index: number): number {
  const level = (headings[index] as Heading).level;
  return headings.slice(index + 1).find((next) => next.level <= level)?.line ?? lines.length;
}

function text(lines: string[], start: number, end: number): string {
  return lines.slice(start, end).join('\n').trim();
}

// adr-tools writes the status first and may add `Supersedes …` lines below it.
function firstLine(text: string | undefined): string | undefined {
  return text
    ?.split('\n')
    .find((line) => line.trim() !== '')
    ?.trim();
}

// `Superseded by [2. Use X](0002-use-x.md)` becomes `Superseded`, so the status filter finds it.
function cutBy(status: string | undefined): string | undefined {
  return status?.replace(/^(.+?)\s+by\s+\S.*$/i, '$1');
}
