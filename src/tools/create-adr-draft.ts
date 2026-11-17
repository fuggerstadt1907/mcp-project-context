// The only write tool (ADR 0002). Registered only with --allow-write. Writes a new ADR draft to
// `<adrDir>/drafts/NNNN-slug.md` and never overwrites. The file holds the input as given; only the
// returned result is redacted (ADR 0003).
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { type SafeFs, SafeFsError } from '../fs/safe-fs.js';
import { redact } from '../redact.js';
import { fail, ok, withAudit } from './result.js';

const MAX_TITLE = 200;
const MAX_SLUG = 60;
const STATUS = 'Proposed';
// Number prefix of an ADR or draft file name, as in sources/adr.ts.
const NUMBERED = /^(\d+)-.+\.md$/i;

// Plain z.string(): the values are redacted before the SDK validates them (decision 56).
const DraftSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  date: z.string(),
  path: z.string(),
});

interface DraftInput {
  title: string;
  context: string;
  decision: string;
  consequences: string;
}

/** Lowercase ASCII words joined by `-`, at most 60 characters. Never contains `/`, `\` or `..`. */
export function slugify(title: string): string {
  // Masked first: lowercasing would hide a secret from the patterns, and the file name ends up in
  // the returned path and on disk (decision 90). The heading inside the file keeps the raw title.
  const slug = redact(title)
    .text.normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '');
  return slug || 'untitled';
}

export function registerCreateAdrDraft(server: McpServer, safeFs: SafeFs, adrDir: string): void {
  const draftsDir = adrDir === '.' ? 'drafts' : `${adrDir}/drafts`;
  // Calls run one after another, so parallel calls get consecutive numbers. Two server processes on
  // the same repository are not serialised; exclusive create still keeps them from overwriting.
  let queue: Promise<unknown> = Promise.resolve();

  server.registerTool(
    'create_adr_draft',
    {
      title: 'Create ADR draft',
      description:
        "Propose a new architecture decision as an ADR draft with status Proposed and today's " +
        `date. Writes ${draftsDir}/NNNN-<slug>.md with the next free number and never ` +
        'overwrites a file. Use it when the user asks you to record a decision. Drafts are not ' +
        'returned by list_adrs or get_adr until a human moves them into the ADR directory. ' +
        'Example: title "Use Postgres for bookings".',
      inputSchema: z.object({
        title: z.string().describe('One line, e.g. "Use Postgres for bookings".'),
        context: z.string().describe('Why a decision is needed: the forces and constraints.'),
        decision: z.string().describe('What is decided.'),
        consequences: z.string().describe('What follows from the decision, good and bad.'),
      }),
      outputSchema: DraftSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    withAudit('create_adr_draft', (input: DraftInput) => {
      const run = queue.then(() => create(input));
      queue = run.catch(() => undefined);
      return run;
    }),
  );

  async function create(input: DraftInput) {
    const title = input.title.trim();
    if (title === '') return fail('Title must not be empty.');
    if (/[\r\n]/.test(title)) return fail('Title must be a single line.');
    if (title.length > MAX_TITLE) {
      return fail(`Title must be at most ${MAX_TITLE} characters, got ${title.length}.`);
    }

    const next = await nextNumber();
    if (next === undefined) {
      return fail(
        `ADR directory not found: ${adrDir}. Set --adr-dir if your ADRs live elsewhere. ` +
          'Nothing was written.',
      );
    }
    const id = String(next).padStart(4, '0');
    const date = today();
    const path = `${draftsDir}/${id}-${slugify(title)}.md`;
    const content = [
      `# ${id}: ${title}`,
      '',
      `- Status: ${STATUS}`,
      `- Date: ${date}`,
      '',
      section('Context', input.context),
      section('Decision', input.decision),
      section('Consequences', input.consequences),
    ].join('\n');

    try {
      await safeFs.writeTextFile(path, content, { overwrite: false });
    } catch (error) {
      if (error instanceof SafeFsError && error.reason === 'exists') {
        return fail(
          `ADR draft ${path} already exists. Nothing was written. Ask the user to remove or ` +
            'rename it, or use a different title.',
        );
      }
      // Other SafeFsErrors reach the agent through withAudit with their message.
      throw error;
    }

    const target = adrDir === '.' ? 'the project root' : `${adrDir}/`;
    const text =
      `Created ADR draft ${id} "${title}" at ${path} (${STATUS}, ${date}). Drafts are not ` +
      `listed by list_adrs; move it to ${target} to accept it.`;
    return ok({ id, title, status: STATUS, date, path }, text);
  }

  // Highest number among `NNNN-*.md` names directly in adrDir and in drafts/, plus one
  // (decision 6). Counts names, so unreadable and oversized files count too. Undefined if adrDir
  // does not exist.
  async function nextNumber(): Promise<number | undefined> {
    const names = await namesIn(adrDir);
    if (names === undefined) return undefined;
    let highest = 0;
    for (const name of [...names, ...((await namesIn(draftsDir)) ?? [])]) {
      const number = Number(NUMBERED.exec(name)?.[1]);
      // Numbers beyond 2^53 lose precision; such a file cannot be meant as an ADR number.
      if (Number.isSafeInteger(number)) highest = Math.max(highest, number);
    }
    return highest + 1;
  }

  async function namesIn(dir: string): Promise<string[] | undefined> {
    try {
      return await safeFs.listNames(dir);
    } catch (error) {
      if (error instanceof SafeFsError && error.reason === 'not_found') return undefined;
      throw error;
    }
  }
}

function section(heading: string, body: string): string {
  return `## ${heading}\n\n${body.trim()}\n`;
}

// Local calendar date, as a human writing the ADR would put it.
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
