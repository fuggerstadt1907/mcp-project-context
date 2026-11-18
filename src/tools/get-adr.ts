import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { AdrSource } from '../sources/adr.js';
import { fail, ok, withAudit } from './result.js';
import { reasonText } from './text.js';

// Plain z.string() for text from files: format checks would fail after redaction (decision 56).
const AdrSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  date: z.string(),
  context: z.string(),
  decision: z.string(),
  consequences: z.string(),
});

export function registerGetAdr(
  server: McpServer,
  adrs: AdrSource,
  options: { adrDir: string; maxFileKb: number },
): void {
  server.registerTool(
    'get_adr',
    {
      title: 'Get ADR',
      description:
        'Read one architecture decision record by id, split into context, decision and ' +
        'consequences. Use it to cite what was decided and why. Accepts "2" or "0002". ' +
        'Call list_adrs first if you do not know the id.',
      inputSchema: z.strictObject({
        id: z.string().describe('ADR number, e.g. "0002" or "2".'),
      }),
      outputSchema: AdrSchema,
      annotations: { readOnlyHint: true },
    },
    withAudit('get_adr', async ({ id }: { id: string }) => {
      const lookup = await adrs.get(id);
      if (!lookup.found) {
        if ('error' in lookup) {
          return fail(
            `ADR "${id}" cannot be read: ${reasonText(lookup.error.reason, options.maxFileKb)}.`,
          );
        }
        if (lookup.missingDir) {
          return fail(
            `ADR "${id}" not found. ADR directory not found: ${options.adrDir}. ` +
              'Set --adr-dir if your ADRs live elsewhere.',
          );
        }
        if (lookup.available.length === 0) {
          return fail(`ADR "${id}" not found. There are no ADRs in ${options.adrDir}.`);
        }
        return fail(
          `ADR "${id}" not found. Available ids: ${lookup.available.join(', ')}. ` +
            'Call list_adrs for titles.',
        );
      }
      const { adr } = lookup;
      const meta = [`Status: ${adr.status}`, ...(adr.date ? [`Date: ${adr.date}`] : [])];
      const text = [
        `# ${adr.id}: ${adr.title}`,
        meta.join(' · '),
        section('Context', adr.context),
        section('Decision', adr.decision),
        section('Consequences', adr.consequences),
      ].join('\n\n');
      return ok({ ...adr }, text);
    }),
  );
}

function section(heading: string, body: string): string {
  return `## ${heading}\n\n${body || '(empty)'}`;
}
