# Architecture

## Overview

```mermaid
flowchart LR
  A[Claude Code / MCP client] <-- stdio JSON-RPC --> B[cli.ts<br/>serveStdio]
  B --> C[server.ts<br/>createServer(config)]
  C --> T[tools/*]
  C --> R[resources]
  T --> S[sources<br/>adr · tickets · conventions]
  R --> S
  T --> Q[search.ts]
  Q --> S
  S --> F[fs/safeFs.ts<br/>root guard · size · deny list]
  T --> X[redact.ts]
  R --> X
  T --> L[log.ts / audit<br/>stderr only]
```

A request flows left to right. Every tool and resource handler reads through **sources**, which
read only through **safeFs**. Every result passes **redact** right before it is returned.
Logging never touches stdout.

## Modules

| Path | Responsibility |
| --- | --- |
| `src/cli.ts` | Parse flags, build `Config`, call `serveStdio(() => createServer(config))`. |
| `src/config.ts` | `Config` type, defaults, validation (zod). Resolves `root` to a real path. |
| `src/server.ts` | `createServer(config): McpServer`. Registers tools and resources. Write tools only if `config.allowWrite`. |
| `src/log.ts` | Logger to stderr. `audit(event)` writes one JSON line. |
| `src/fs/safe-fs.ts` | `readTextFile(rel)`, `listFiles(relDir, ext)`. Enforces root, deny list, size limit, realpath check. |
| `src/redact.ts` | `redact(text): { text, findings }`. Pattern table, one entry per secret or PII type. |
| `src/sources/adr.ts` | Parse ADR markdown into `{ id, title, status, date, context, decision, consequences }`. |
| `src/sources/tickets.ts` | Parse ticket markdown with YAML frontmatter. |
| `src/sources/conventions.ts` | Load known convention files if present. |
| `src/search.ts` | Keyword search over all sources, simple scoring, snippets. |
| `src/tools/*.ts` | One tool per file: schema, annotations, handler. |
| `src/tools/result.ts` | Helpers `ok(structured, text)` and `fail(message)`; applies redaction and audit. |

## Key decisions

- [ADR 0001](adr/0001-sdk-v2-and-stdio.md): MCP TypeScript SDK v2, stdio transport only.
- [ADR 0002](adr/0002-read-only-by-default.md): Read-only by default, write tools registered only behind a flag.
- [ADR 0003](adr/0003-redact-at-output-boundary.md): Redact once, at the output boundary.

## SDK usage (verified against `@modelcontextprotocol/server` 2.4.0)

```ts
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const server = new McpServer({ name: 'mcp-project-context', version: '0.1.0' });

server.registerTool(
  'get_adr',
  {
    title: 'Get ADR',
    description: 'Read one architecture decision record by id, e.g. "0003".',
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ id: z.string(), title: z.string() /* ... */ }),
    annotations: { readOnlyHint: true },
  },
  async ({ id }) => ({
    content: [{ type: 'text', text: '...' }],
    structuredContent: { id, title: '...' },
  }),
);

server.registerResource(
  'adr',
  new ResourceTemplate('adr://{id}', { list: async () => ({ resources: [/* { uri, name } */] }) }),
  { title: 'ADR', mimeType: 'text/markdown' },
  async (uri, { id }) => ({ contents: [{ uri: uri.href, text: '...' }] }),
);

// cli.ts: serveStdio takes a factory, not an instance
serveStdio(() => createServer(config));
```

Testing without a process (used in all integration tests):

```ts
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await createServer(config).connect(serverTransport);
const client = new Client({ name: 'test', version: '0.0.0' });
await client.connect(clientTransport);
await client.callTool({ name: 'get_adr', arguments: { id: '0001' } });
```
