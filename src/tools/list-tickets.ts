import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TicketSource } from '../sources/tickets.js';
import { ok, withAudit } from './result.js';
import { skippedLine } from './text.js';

// Plain z.string() for text from files: format checks would fail after redaction (decision 56).
const TicketSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  labels: z.array(z.string()),
});

export function registerListTickets(
  server: McpServer,
  tickets: TicketSource,
  ticketsDir: string,
): void {
  server.registerTool(
    'list_tickets',
    {
      title: 'List tickets',
      description:
        'List the tickets of this project with id, title, status and labels, sorted by id. Use it ' +
        'to find the ticket you work on before reading it with get_ticket (e.g. id "T-003"). ' +
        'Optional status and label filters, case-insensitive and exact, combined with AND, ' +
        'e.g. status "todo" and label "api".',
      inputSchema: z.object({
        status: z.string().optional().describe('Only tickets with this status, e.g. "todo".'),
        label: z.string().optional().describe('Only tickets with this label, e.g. "api".'),
      }),
      outputSchema: z.object({ tickets: z.array(TicketSummarySchema) }),
      annotations: { readOnlyHint: true },
    },
    withAudit(
      'list_tickets',
      async ({ status, label }: { status?: string | undefined; label?: string | undefined }) => {
        const listing = await tickets.list();
        // An empty filter is no filter: agents sometimes send optional fields as "".
        const wantedStatus = status?.trim().toLowerCase() || undefined;
        const wantedLabel = label?.trim().toLowerCase() || undefined;
        const matches = listing.tickets
          .filter(
            (ticket) =>
              (wantedStatus === undefined || ticket.status.toLowerCase() === wantedStatus) &&
              (wantedLabel === undefined ||
                ticket.labels.some((candidate) => candidate.toLowerCase() === wantedLabel)),
          )
          .map(({ id, title, status, labels }) => ({ id, title, status, labels }));

        const lines = matches.map((ticket) => {
          const meta = [ticket.status, ticket.labels.join(', ')].filter(Boolean).join(' · ');
          return `${ticket.id}  ${ticket.title}${meta ? `  (${meta})` : ''}`;
        });
        if (listing.missingDir) {
          lines.push(
            `Tickets directory not found: ${ticketsDir}. ` +
              'Set --tickets-dir if your tickets live elsewhere.',
          );
        } else if (matches.length === 0) {
          const filters = [
            ...(wantedStatus === undefined ? [] : [`status "${status}"`]),
            ...(wantedLabel === undefined ? [] : [`label "${label}"`]),
          ];
          lines.push(
            filters.length === 0
              ? `No tickets found in ${ticketsDir}.`
              : `No tickets with ${filters.join(' and ')}.`,
          );
        }
        const skipped = skippedLine(listing.skipped);
        const text = [lines.join('\n'), skipped].filter(Boolean).join('\n\n');
        return ok({ tickets: matches }, text);
      },
    ),
  );
}
