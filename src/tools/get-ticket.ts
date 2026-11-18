import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TicketSource } from '../sources/tickets.js';
import { fail, ok, withAudit } from './result.js';
import { reasonText } from './text.js';

// Plain z.string() for text from files: format checks would fail after redaction (decision 56).
const TicketSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  labels: z.array(z.string()),
  description: z.string(),
  acceptanceCriteria: z.array(z.object({ text: z.string(), done: z.boolean() })),
});

export function registerGetTicket(
  server: McpServer,
  tickets: TicketSource,
  options: { ticketsDir: string; maxFileKb: number },
): void {
  server.registerTool(
    'get_ticket',
    {
      title: 'Get ticket',
      description:
        'Read one ticket by id with its description and acceptance criteria (text and done ' +
        'flag). Use it before implementing a ticket and to cite its acceptance criteria. ' +
        'Accepts an id like "T-003", case-insensitive. Call list_tickets first if you do not ' +
        'know the id.',
      inputSchema: z.strictObject({
        id: z.string().describe('Ticket id from the frontmatter, e.g. "T-003".'),
      }),
      outputSchema: TicketSchema,
      annotations: { readOnlyHint: true },
    },
    withAudit('get_ticket', async ({ id }: { id: string }) => {
      const lookup = await tickets.get(id);
      if (!lookup.found) {
        if ('reason' in lookup) {
          return fail(
            `Ticket "${id}" cannot be read: ${reasonText(lookup.reason, options.maxFileKb)}.`,
          );
        }
        if (lookup.missingDir) {
          return fail(
            `Ticket "${id}" not found. Tickets directory not found: ${options.ticketsDir}. ` +
              'Set --tickets-dir if your tickets live elsewhere.',
          );
        }
        if (lookup.available.length === 0) {
          return fail(`Ticket "${id}" not found. There are no tickets in ${options.ticketsDir}.`);
        }
        return fail(
          `Ticket "${id}" not found. Available ids: ${lookup.available.join(', ')}. ` +
            'Call list_tickets for titles.',
        );
      }
      const { ticket } = lookup;
      const meta = [
        `Status: ${ticket.status || '(none)'}`,
        ...(ticket.labels.length > 0 ? [`Labels: ${ticket.labels.join(', ')}`] : []),
      ];
      const criteria =
        ticket.acceptanceCriteria.length === 0
          ? '(none)'
          : ticket.acceptanceCriteria
              .map((criterion) => `- [${criterion.done ? 'x' : ' '}] ${criterion.text}`)
              .join('\n');
      const text = [
        `# ${ticket.id}: ${ticket.title}`,
        meta.join(' · '),
        ticket.description || '(no description)',
        `## Acceptance criteria\n\n${criteria}`,
      ].join('\n\n');
      return ok(
        { ...ticket, acceptanceCriteria: ticket.acceptanceCriteria.map((ac) => ({ ...ac })) },
        text,
      );
    }),
  );
}
