import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { AdrSource } from '../sources/adr.js';
import { ok, withAudit } from './result.js';
import { skippedLine } from './text.js';

// Plain z.string() for text from files: format checks would fail after redaction (decision 56).
const AdrSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  date: z.string(),
});

export function registerListAdrs(server: McpServer, adrs: AdrSource, adrDir: string): void {
  server.registerTool(
    'list_adrs',
    {
      title: 'List ADRs',
      description:
        'List the architecture decision records (ADRs) of this project with id, title, status and ' +
        'date, sorted by id. Use it to find which ADR covers a topic before reading it with ' +
        'get_adr (e.g. id "0002"). Optional status filter, case-insensitive and exact, ' +
        'e.g. "accepted".',
      inputSchema: z.strictObject({
        status: z
          .string()
          .optional()
          .describe('Only ADRs with this status, e.g. "accepted" or "proposed".'),
      }),
      outputSchema: z.object({ adrs: z.array(AdrSummarySchema) }),
      annotations: { readOnlyHint: true },
    },
    withAudit('list_adrs', async ({ status }: { status?: string | undefined }) => {
      const listing = await adrs.list();
      // An empty status is no filter: agents sometimes send optional fields as "".
      const wanted = status?.trim().toLowerCase() || undefined;
      const matches = listing.adrs
        .filter((adr) => wanted === undefined || adr.status.toLowerCase() === wanted)
        .map(({ id, title, status, date }) => ({ id, title, status, date }));

      const lines = matches.map(
        (adr) => `${adr.id}  ${adr.title}  (${[adr.status, adr.date].filter(Boolean).join(', ')})`,
      );
      if (listing.missingDir) {
        lines.push(
          `ADR directory not found: ${adrDir}. Set --adr-dir if your ADRs live elsewhere.`,
        );
      } else if (matches.length === 0) {
        lines.push(
          wanted === undefined ? `No ADRs found in ${adrDir}.` : `No ADRs with status "${status}".`,
        );
      }
      const skipped = skippedLine(listing.skipped);
      const text = [lines.join('\n'), skipped].filter(Boolean).join('\n\n');
      return ok({ adrs: matches }, text);
    }),
  );
}
