// Keyword search over ADRs, tickets and convention files. Works on raw text, like the sources;
// the result helper redacts at the output boundary (ADR 0003). Reads on every call (ADR 0004).
import { redact } from './redact.js';
import type { AdrSource } from './sources/adr.js';
import type { ConventionSource } from './sources/conventions.js';
import type { TicketSkipReason, TicketSource } from './sources/tickets.js';

export const SEARCH_KINDS = ['adr', 'ticket', 'convention'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export interface SearchResult {
  kind: SearchKind;
  id: string;
  title: string;
  score: number;
  snippet: string;
}

export interface SearchOutcome {
  results: SearchResult[];
  skipped: { path: string; reason: TicketSkipReason }[];
}

export interface Search {
  search(query: string, options?: { kinds?: SearchKind[]; limit?: number }): Promise<SearchOutcome>;
}

interface Doc {
  kind: SearchKind;
  id: string;
  title: string;
  body: string;
}

// A match in the title counts this many times as one in the body.
const TITLE_WEIGHT = 5;
const SNIPPET_LENGTH = 200;
// Characters before the first match, so the snippet shows some context.
const SNIPPET_LEAD = 60;
// How far an edge may move to the next whitespace so words are not cut.
const WORD_SNAP = 30;

/** Lowercased, unique terms of the query, split on whitespace. Empty for a blank query. */
export function queryTerms(query: string): string[] {
  return [...new Set(query.trim().toLowerCase().split(/\s+/).filter(Boolean))];
}

export function createSearch(sources: {
  adrs: AdrSource;
  tickets: TicketSource;
  conventions: ConventionSource;
}): Search {
  async function load(kinds: ReadonlySet<SearchKind>): Promise<{
    docs: Doc[];
    skipped: SearchOutcome['skipped'];
  }> {
    const docs: Doc[] = [];
    const skipped: SearchOutcome['skipped'] = [];
    if (kinds.has('adr')) {
      // Only NNNN-*.md directly in the ADR directory, so drafts/ is never searched.
      const listing = await sources.adrs.list();
      skipped.push(...listing.skipped);
      for (const adr of listing.adrs) {
        const body = [adr.context, adr.decision, adr.consequences].filter(Boolean).join('\n\n');
        docs.push({ kind: 'adr', id: adr.id, title: adr.title, body });
      }
    }
    if (kinds.has('ticket')) {
      // The whole ticket: description, acceptance criteria and labels (requirements decision 2).
      const listing = await sources.tickets.list();
      skipped.push(...listing.skipped);
      for (const ticket of listing.tickets) {
        const criteria = ticket.acceptanceCriteria
          .map((criterion) => `- [${criterion.done ? 'x' : ' '}] ${criterion.text}`)
          .join('\n');
        const labels = ticket.labels.length > 0 ? `Labels: ${ticket.labels.join(', ')}` : '';
        const body = [ticket.description, criteria, labels].filter(Boolean).join('\n\n');
        docs.push({ kind: 'ticket', id: ticket.id, title: ticket.title, body });
      }
    }
    if (kinds.has('convention')) {
      const listing = await sources.conventions.list();
      skipped.push(...listing.skipped);
      for (const file of listing.files) {
        docs.push({ kind: 'convention', id: file.path, title: file.path, body: file.content });
      }
    }
    return { docs, skipped };
  }

  async function search(
    query: string,
    options: { kinds?: SearchKind[]; limit?: number } = {},
  ): Promise<SearchOutcome> {
    const terms = queryTerms(query).map((term) => new RegExp(escapeRegExp(term), 'gi'));
    const kinds = new Set(options.kinds?.length ? options.kinds : SEARCH_KINDS);
    const { docs, skipped } = await load(kinds);

    const scored = docs
      .map((doc) => {
        let score = 0;
        let first: number | undefined;
        for (const term of terms) {
          score += TITLE_WEIGHT * count(doc.title, term);
          for (const match of doc.body.matchAll(term)) {
            score += 1;
            if (first === undefined || match.index < first) first = match.index;
          }
        }
        return { doc, score, first };
      })
      .filter((entry) => entry.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          SEARCH_KINDS.indexOf(a.doc.kind) - SEARCH_KINDS.indexOf(b.doc.kind) ||
          collator.compare(a.doc.id, b.doc.id),
      );

    // Snippets only for what is returned: finding the secret spans costs a redact() pass.
    const results = scored.slice(0, options.limit ?? 10).map(({ doc, score, first }) => ({
      kind: doc.kind,
      id: doc.id,
      title: doc.title,
      score,
      snippet: snippetAround(doc.body, first ?? 0),
    }));
    return { results, skipped };
  }

  return { search };
}

/**
 * About 200 characters of `text` around offset `at`, on one line. Edges move to whitespace so
 * words stay whole, then outwards until no pattern match of redact() is cut: a cut secret would
 * no longer match its pattern at the output boundary and leak (decision 80). The snippet is not
 * redacted here.
 */
export function snippetAround(text: string, at: number): string {
  let start = Math.max(0, at - SNIPPET_LEAD);
  let end = Math.min(text.length, start + SNIPPET_LENGTH);
  start = Math.max(0, Math.min(start, end - SNIPPET_LENGTH));

  if (start > 0) {
    const space = lastWhitespace(text, start, start - WORD_SNAP);
    if (space !== undefined) start = space + 1;
  }
  if (end < text.length) {
    const space = firstWhitespace(text, end, end + WORD_SNAP);
    if (space !== undefined) end = space;
  }

  const spans = redact(text).findings.map((finding) => finding.match);
  let moved = true;
  while (moved) {
    moved = false;
    for (const [matchStart, matchEnd] of spans) {
      if (matchStart < start && start < matchEnd) {
        start = matchStart;
        moved = true;
      }
      if (matchStart < end && end < matchEnd) {
        end = matchEnd;
        moved = true;
      }
    }
  }

  const body = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`;
}

function lastWhitespace(text: string, from: number, limit: number): number | undefined {
  for (let index = from - 1; index >= Math.max(0, limit); index--) {
    if (/\s/.test(text.charAt(index))) return index;
  }
  return undefined;
}

function firstWhitespace(text: string, from: number, limit: number): number | undefined {
  for (let index = from; index < Math.min(text.length, limit); index++) {
    if (/\s/.test(text.charAt(index))) return index;
  }
  return undefined;
}

function count(text: string, term: RegExp): number {
  let found = 0;
  for (const _ of text.matchAll(term)) found++;
  return found;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Ids sort with digit runs by value (T-2 before T-10), as in the ticket source.
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
