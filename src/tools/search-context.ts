import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { queryTerms, SEARCH_KINDS, type Search, type SearchKind } from '../search.js';
import { fail, ok, withAudit } from './result.js';
import { skippedLine } from './text.js';

// Plain z.string() for text from files: format checks would fail after redaction (decision 56).
const SearchResultSchema = z.object({
  kind: z.enum(SEARCH_KINDS),
  id: z.string(),
  title: z.string(),
  score: z.number(),
  snippet: z.string(),
});

export function registerSearchContext(server: McpServer, search: Search): void {
  server.registerTool(
    'search_context',
    {
      title: 'Search project context',
      description:
        'Keyword search across ADRs, tickets (title, labels, description, acceptance criteria) ' +
        'and convention files. Use it when you do not know which ADR or ticket covers a topic, ' +
        'e.g. query "authentication". Every word counts, case-insensitive; title matches rank ' +
        'higher. Returns kind, id, title, score and a short snippet; read the full document ' +
        'with get_adr, get_ticket or get_conventions.',
      inputSchema: z.object({
        query: z.string().max(500).describe('Words to look for, e.g. "rate limit".'),
        kinds: z
          .array(z.enum(SEARCH_KINDS))
          .optional()
          .describe('Only these kinds, e.g. ["adr"]. Default: all.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Maximum number of results, 1 to 50. Default: 10.'),
      }),
      outputSchema: z.object({ results: z.array(SearchResultSchema) }),
      annotations: { readOnlyHint: true },
    },
    withAudit(
      'search_context',
      async ({
        query,
        kinds,
        limit,
      }: {
        query: string;
        kinds?: SearchKind[] | undefined;
        limit?: number | undefined;
      }) => {
        if (queryTerms(query).length === 0) {
          return fail('The query is empty. Pass one or more words, e.g. "authentication".');
        }
        const { results, skipped } = await search.search(query, {
          ...(kinds === undefined ? {} : { kinds }),
          ...(limit === undefined ? {} : { limit }),
        });
        const lines = results.map(
          (result, index) =>
            `${index + 1}. ${result.kind} ${result.id}  ${result.title}  (score ${result.score})\n` +
            `   ${result.snippet}`,
        );
        if (results.length === 0) lines.push(`No matches for "${query.trim()}".`);
        const text = [lines.join('\n'), skippedLine(skipped)].filter(Boolean).join('\n\n');
        return ok({ results: results.map((result) => ({ ...result })) }, text);
      },
    ),
  );
}
