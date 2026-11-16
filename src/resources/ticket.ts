import {
  type McpServer,
  ResourceNotFoundError,
  ResourceTemplate,
} from '@modelcontextprotocol/server';
import type { TicketSource } from '../sources/tickets.js';
import { withResourceAudit, withResourceList } from '../tools/result.js';

/** `ticket://{id}` returns the raw markdown of one ticket, redacted by withResourceAudit. */
export function registerTicketResource(server: McpServer, tickets: TicketSource): void {
  server.registerResource(
    'ticket',
    new ResourceTemplate('ticket://{id}', {
      list: withResourceList(async () => {
        const { tickets: list } = await tickets.list();
        return {
          resources: list.map((ticket) => ({
            uri: `ticket://${ticket.id}`,
            name: `Ticket ${ticket.id}`,
            title: ticket.title,
            mimeType: 'text/markdown',
          })),
        };
      }),
    }),
    {
      title: 'Ticket',
      description: 'Raw markdown of one ticket, including frontmatter, e.g. ticket://T-003.',
      mimeType: 'text/markdown',
    },
    withResourceAudit('ticket', async (uri: URL, variables: Record<string, string | string[]>) => {
      const id = variables.id;
      const lookup = typeof id === 'string' ? await tickets.get(id) : undefined;
      if (!lookup?.found) {
        // A file that cannot be read keeps its SafeFsError reason. A file whose frontmatter cannot
        // be parsed has no ticket id, so it is not found; get_ticket names the reason.
        if (lookup && 'error' in lookup && lookup.error) throw lookup.error;
        throw new ResourceNotFoundError(uri.href);
      }
      return {
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text: lookup.raw }],
      };
    }),
  );
}
