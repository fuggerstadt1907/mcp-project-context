import {
  type McpServer,
  ResourceNotFoundError,
  ResourceTemplate,
} from '@modelcontextprotocol/server';
import type { AdrSource } from '../sources/adr.js';
import { withResourceAudit, withResourceList } from '../tools/result.js';

/** `adr://{id}` returns the raw markdown of one ADR, redacted by withResourceAudit. */
export function registerAdrResource(server: McpServer, adrs: AdrSource): void {
  server.registerResource(
    'adr',
    new ResourceTemplate('adr://{id}', {
      list: withResourceList(async () => {
        const { adrs: list } = await adrs.list();
        return {
          resources: list.map((adr) => ({
            uri: `adr://${adr.id}`,
            name: `ADR ${adr.id}`,
            title: adr.title,
            mimeType: 'text/markdown',
          })),
        };
      }),
    }),
    {
      title: 'ADR',
      description: 'Raw markdown of one architecture decision record, e.g. adr://0002.',
      mimeType: 'text/markdown',
    },
    withResourceAudit('adr', async (uri: URL, variables: Record<string, string | string[]>) => {
      const id = variables.id;
      const lookup = typeof id === 'string' ? await adrs.get(id) : undefined;
      if (!lookup?.found) {
        if (lookup && 'error' in lookup) throw lookup.error;
        throw new ResourceNotFoundError(uri.href);
      }
      return {
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text: lookup.raw }],
      };
    }),
  );
}
