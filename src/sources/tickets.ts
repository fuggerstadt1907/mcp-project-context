// Tickets from `<ticketsDir>/**/*.md` with frontmatter (requirements, Data & schema). The id is the
// frontmatter `id` (FR-12); files named README.md are not tickets. Read on every call (ADR 0004).
import { type SafeFs, SafeFsError, type SafeFsReason } from '../fs/safe-fs.js';
import { log } from '../log.js';
import { parseFrontmatter } from './frontmatter.js';
import { findHeadings } from './markdown.js';

export interface AcceptanceCriterion {
  text: string;
  done: boolean;
}

export interface Ticket {
  id: string;
  title: string;
  status: string;
  labels: string[];
  description: string;
  acceptanceCriteria: AcceptanceCriterion[];
}

export type TicketSummary = Pick<Ticket, 'id' | 'title' | 'status' | 'labels'>;

export type TicketParseReason = 'no_frontmatter' | 'invalid_frontmatter' | 'missing_id';
export type TicketSkipReason = SafeFsReason | TicketParseReason;

export interface SkippedTicketFile {
  path: string;
  reason: TicketSkipReason;
}

export interface TicketListing {
  tickets: Ticket[];
  skipped: SkippedTicketFile[];
  // The tickets directory does not exist (FR-16).
  missingDir: boolean;
}

export type TicketLookup =
  | { found: true; ticket: Ticket; raw: string }
  // Unknown id. `available` holds every ticket id, plus the filename ids of skipped files.
  | { found: false; available: string[]; missingDir: boolean }
  // A skipped file whose filename id matches (FR-15). `error` is set when reading failed.
  | { found: false; available: string[]; reason: TicketSkipReason; error?: SafeFsError };

export interface TicketSource {
  list(): Promise<TicketListing>;
  get(id: string): Promise<TicketLookup>;
}

interface Scanned {
  tickets: { ticket: Ticket; raw: string; path: string }[];
  skipped: (SkippedTicketFile & { error?: SafeFsError })[];
  missingDir: boolean;
}

// `T-012` from `T-012-login.md` or `T-012.md`. Files without such a prefix have no filename id.
const FILENAME_ID = /^([A-Za-z]+-\d+)(?=[-_.]|$)/;
const ACCEPTANCE_HEADING = 'acceptance criteria';
const CHECKLIST_ITEM = /^\s*[-*+]\s+\[([ xX])\](?:\s+(.*))?$/;

export function createTicketSource(safeFs: SafeFs, ticketsDir: string): TicketSource {
  async function scan(): Promise<Scanned> {
    let paths: string[];
    try {
      paths = await safeFs.listFiles(ticketsDir, { extensions: ['.md'] });
    } catch (error) {
      if (error instanceof SafeFsError && error.reason === 'not_found') {
        return { tickets: [], skipped: [], missingDir: true };
      }
      throw error;
    }
    const result: Scanned = { tickets: [], skipped: [], missingDir: false };
    const byId = new Map<string, string>();
    // listFiles sorts by path, so the first file for a duplicate id wins (FR-12).
    for (const path of paths) {
      if (baseName(path).toLowerCase() === 'readme.md') continue;
      let raw: string;
      try {
        raw = await safeFs.readTextFile(path);
      } catch (error) {
        if (!(error instanceof SafeFsError)) throw error;
        log.warn('ticket skipped', { path, reason: error.reason });
        result.skipped.push({ path, reason: error.reason, error });
        continue;
      }
      const parsed = parseTicket(path, raw);
      if ('reason' in parsed) {
        result.skipped.push({ path, reason: parsed.reason });
        continue;
      }
      const key = parsed.id.toLowerCase();
      const existing = byId.get(key);
      if (existing !== undefined) {
        log.warn('duplicate ticket id, keeping the first file', { files: [existing, path] });
        continue;
      }
      byId.set(key, path);
      result.tickets.push({ ticket: parsed, raw, path });
    }
    result.tickets.sort((a, b) => compareIds(a.ticket.id, b.ticket.id));
    return result;
  }

  async function list(): Promise<TicketListing> {
    const { tickets, skipped, missingDir } = await scan();
    return {
      tickets: tickets.map((entry) => entry.ticket),
      skipped: skipped.map(({ path, reason }) => ({ path, reason })),
      missingDir,
    };
  }

  async function get(input: string): Promise<TicketLookup> {
    const { tickets, skipped, missingDir } = await scan();
    const wanted = input.trim().toLowerCase();
    const hit = tickets.find((entry) => entry.ticket.id.toLowerCase() === wanted);
    if (hit) return { found: true, ticket: hit.ticket, raw: hit.raw };

    const ids = new Map(tickets.map((entry) => [entry.ticket.id.toLowerCase(), entry.ticket.id]));
    for (const file of skipped) {
      const id = filenameId(file.path);
      if (id !== undefined && !ids.has(id.toLowerCase())) ids.set(id.toLowerCase(), id);
    }
    const available = [...ids.values()].sort(compareIds);
    const skippedHit = skipped.find((file) => filenameId(file.path)?.toLowerCase() === wanted);
    if (skippedHit) {
      return {
        found: false,
        available,
        reason: skippedHit.reason,
        ...(skippedHit.error ? { error: skippedHit.error } : {}),
      };
    }
    return { found: false, available, missingDir };
  }

  return { list, get };
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function filenameId(path: string): string | undefined {
  return FILENAME_ID.exec(baseName(path))?.[1];
}

// Letters case-insensitively, digit runs by value: T-2 before T-10.
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
function compareIds(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** Parses one ticket, or returns why it is skipped. Warnings name the path, never content. */
function parseTicket(path: string, markdown: string): Ticket | { reason: TicketParseReason } {
  const frontmatter = parseFrontmatter(markdown);
  if (frontmatter.kind === 'none') {
    log.warn('ticket skipped', { path, reason: 'no_frontmatter' });
    return { reason: 'no_frontmatter' };
  }
  if (frontmatter.kind === 'invalid') {
    const { line, problem } = frontmatter;
    log.warn('ticket skipped', { path, reason: 'invalid_frontmatter', line, problem });
    return { reason: 'invalid_frontmatter' };
  }
  const { data, body } = frontmatter;
  for (const key of ['id', 'title', 'status'] as const) {
    if (Array.isArray(data[key])) {
      const problem = `${key} must be a string`;
      log.warn('ticket skipped', { path, reason: 'invalid_frontmatter', problem });
      return { reason: 'invalid_frontmatter' };
    }
  }
  const id = ((data.id as string | undefined) ?? '').trim();
  if (id === '') {
    log.warn('ticket skipped', { path, reason: 'missing_id' });
    return { reason: 'missing_id' };
  }
  const fromName = filenameId(path);
  if (fromName !== undefined && fromName.toLowerCase() !== id.toLowerCase()) {
    log.warn('ticket id differs from the filename, using the frontmatter id', { path });
  }

  // A plain `labels: api` is one label; `labels:` with no value is none.
  const rawLabels = data.labels ?? [];
  const labels = (Array.isArray(rawLabels) ? rawLabels : [rawLabels])
    .map((label) => label.trim())
    .filter(Boolean);

  return {
    id,
    title: ((data.title as string | undefined) ?? '').trim(),
    status: ((data.status as string | undefined) ?? '').trim(),
    labels,
    ...parseBody(body),
  };
}

// The description is the body without the first `## Acceptance criteria` section. Checklist items
// in that section become criteria; indented lines below an item continue it.
function parseBody(body: string): Pick<Ticket, 'description' | 'acceptanceCriteria'> {
  const lines = body.split('\n');
  const headings = findHeadings(lines);
  const index = headings.findIndex(
    (heading) => heading.level === 2 && heading.text.toLowerCase() === ACCEPTANCE_HEADING,
  );
  if (index === -1) return { description: body.trim(), acceptanceCriteria: [] };

  const start = (headings[index] as { line: number }).line;
  const end = headings.slice(index + 1).find((next) => next.level <= 2)?.line ?? lines.length;
  const description = [...lines.slice(0, start), ...lines.slice(end)].join('\n').trim();

  const acceptanceCriteria: AcceptanceCriterion[] = [];
  let current: AcceptanceCriterion | undefined;
  for (const line of lines.slice(start + 1, end)) {
    const item = CHECKLIST_ITEM.exec(line);
    if (item) {
      current = { text: (item[2] ?? '').trim(), done: item[1] !== ' ' };
      acceptanceCriteria.push(current);
    } else if (current && /^\s+\S/.test(line)) {
      current.text = `${current.text} ${line.trim()}`.trim();
    } else {
      current = undefined;
    }
  }
  return { description, acceptanceCriteria: acceptanceCriteria.filter((ac) => ac.text !== '') };
}
