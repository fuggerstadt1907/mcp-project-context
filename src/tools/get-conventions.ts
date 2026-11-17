import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { CONVENTION_FILES, type ConventionSource } from '../sources/conventions.js';
import { ok, withAudit } from './result.js';
import { skippedLine } from './text.js';

// Plain z.string() for text from files: format checks would fail after redaction (decision 56).
const ConventionFileSchema = z.object({ path: z.string(), content: z.string() });

export function registerGetConventions(server: McpServer, conventions: ConventionSource): void {
  server.registerTool(
    'get_conventions',
    {
      title: 'Get conventions',
      description:
        "Read the project's rules for contributors and coding agents: CONVENTIONS.md, " +
        'CONTRIBUTING.md, CLAUDE.md and AGENTS.md from the project root, in that order. Files ' +
        'that do not exist are left out. Use it before writing code or opening a PR.',
      inputSchema: z.object({}),
      outputSchema: z.object({ files: z.array(ConventionFileSchema) }),
      annotations: { readOnlyHint: true },
    },
    withAudit('get_conventions', async () => {
      const listing = await conventions.list();
      const files = listing.files.map(({ path, content }) => ({ path, content }));
      const sections = files.map((file) => `## ${file.path}\n\n${file.content.trim()}`);
      if (files.length === 0 && listing.skipped.length === 0) {
        sections.push(`No convention files in root. Looked for ${CONVENTION_FILES.join(', ')}.`);
      }
      const text = [...sections, skippedLine(listing.skipped)].filter(Boolean).join('\n\n');
      return ok({ files }, text);
    }),
  );
}
