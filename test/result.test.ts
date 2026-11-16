import { Client } from '@modelcontextprotocol/client';
import {
  type CallToolResult,
  InMemoryTransport,
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod/v4';
import { createSafeFs, SafeFsError } from '../src/fs/safe-fs.js';
import { fail, ok, withAudit, withResourceAudit, withResourceList } from '../src/tools/result.js';

// Fake tokens are joined at runtime so secret scanners on push do not flag the test file.
const fake = (...parts: string[]) => parts.join('');
const TOKEN = fake('ghp_', 'a'.repeat(36));

const safeFs = createSafeFs({ root: process.cwd(), maxFileKb: 256 });

type Handler = (args: { q: string }) => CallToolResult | Promise<CallToolResult>;

let stderr: string[];
let stdout: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stderr = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  stdout = vi.spyOn(process.stdout, 'write');
});

afterEach(() => {
  expect(stdout).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

function lines(): Record<string, unknown>[] {
  return stderr
    .join('')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function auditLines(): Record<string, unknown>[] {
  return lines().filter((line) => line.msg === 'audit');
}

async function connect(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

async function callProbe(handler: Handler, q = 'needle-value-123'): Promise<CallToolResult> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  server.registerTool(
    'probe',
    {
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({
        note: z.string(),
        nested: z.object({ items: z.array(z.string()) }),
      }),
      annotations: { readOnlyHint: true },
    },
    withAudit('probe', handler),
  );
  const client = await connect(server);
  const result = (await client.callTool({ name: 'probe', arguments: { q } })) as CallToolResult;
  await client.close();
  return result;
}

async function readAdr(read: (uri: URL) => Promise<string>, uri = 'adr://0042'): Promise<unknown> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  server.registerResource(
    'adr',
    new ResourceTemplate('adr://{id}', { list: undefined }),
    { mimeType: 'text/markdown' },
    withResourceAudit('adr', async (url: URL) => ({
      contents: [{ uri: url.href, text: await read(url) }],
    })),
  );
  const client = await connect(server);
  try {
    return await client.readResource({ uri });
  } finally {
    await client.close();
  }
}

describe('ok', () => {
  it('masks a token in a nested field in content and structuredContent', async () => {
    const result = await callProbe(() =>
      ok(
        { note: 'plain', nested: { items: ['first', `token ${TOKEN} here`] } },
        `Found token ${TOKEN}`,
      ),
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: 'text', text: 'Found token [REDACTED:github_token]' }]);
    expect(result.structuredContent).toEqual({
      note: 'plain',
      nested: { items: ['first', 'token [REDACTED:github_token] here'] },
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(auditLines()).toEqual([expect.objectContaining({ redactions: 2 })]);
  });

  it('redacts object keys and counts them', () => {
    const result = ok({ byAssignee: { 'jane@example.com': 3 } }, 'counts');
    expect(result.structuredContent).toEqual({ byAssignee: { '[REDACTED:email]': 3 } });
  });

  it('returns a frozen result, so raw text cannot be put back after ok()', async () => {
    const result = await callProbe(() => {
      const built = ok({ note: 'safe', nested: { items: [] } }, 'safe');
      (built.content[0] as { text: string }).text = `raw ${TOKEN}`;
      return built;
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('leaves numbers, booleans and null unchanged', () => {
    const result = ok({ n: 1, b: true, z: null, s: 'x' }, 'x');
    expect(result.structuredContent).toEqual({ n: 1, b: true, z: null, s: 'x' });
  });
});

describe('fail', () => {
  it('redacts the message', () => {
    const result = fail(`Bad token ${TOKEN}`);
    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Bad token [REDACTED:github_token]' }],
    });
  });
});

describe('withAudit', () => {
  it('turns a SafeFsError outside_root into a tool error', async () => {
    const result = await callProbe(async () => {
      await safeFs.readTextFile('../outside.md');
      return ok({ note: '', nested: { items: [] } }, 'unreachable');
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'Path is outside the project root: ../outside.md' },
    ]);
    expect(auditLines()).toEqual([expect.objectContaining({ tool: 'probe', ok: false })]);
  });

  it('redacts a SafeFsError message and counts the redaction', async () => {
    const result = await callProbe(() => {
      throw new SafeFsError('denied', '.env', `Path is on the deny list: ${TOKEN}`);
    });

    expect(result.content).toEqual([
      { type: 'text', text: 'Path is on the deny list: [REDACTED:github_token]' },
    ]);
    expect(auditLines()).toEqual([expect.objectContaining({ ok: false, redactions: 1 })]);
  });

  it('turns any other exception into a generic tool error without its message', async () => {
    const result = await callProbe(() => {
      throw new Error(`boom /Users/someone/secret ${TOKEN}`);
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'Internal error in probe. Try again or report it.' },
    ]);
    expect(stderr.join('')).not.toContain(TOKEN);
    expect(lines()).toContainEqual(
      expect.objectContaining({ level: 'error', msg: 'handler failed', error: 'Error' }),
    );
  });

  it('rejects a result that was not built with ok() or fail()', async () => {
    const result = await callProbe(() => ({
      content: [{ type: 'text', text: `raw ${TOKEN}` }],
      structuredContent: { note: TOKEN, nested: { items: [] } },
    }));

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(auditLines()).toEqual([expect.objectContaining({ ok: false })]);
  });

  it('writes one audit line without arguments or content', async () => {
    await callProbe(
      () => ok({ note: 'content-marker', nested: { items: [] } }, 'content-marker'),
      'needle-value-123',
    );

    const audit = auditLines();
    expect(audit).toHaveLength(1);
    expect(Object.keys(audit[0] ?? {}).sort()).toEqual(
      ['bytes', 'event', 'level', 'ms', 'msg', 'ok', 'redactions', 'time', 'tool'].sort(),
    );
    expect(audit[0]).toMatchObject({ event: 'tool_call', tool: 'probe', ok: true, redactions: 0 });
    expect(audit[0]?.bytes).toBeGreaterThan(0);
    expect(Number.isInteger(audit[0]?.ms)).toBe(true);
    expect(audit[0]?.ms).toBeGreaterThanOrEqual(0);
    expect(stderr.join('')).not.toContain('needle-value-123');
    expect(stderr.join('')).not.toContain('content-marker');
  });
});

describe('withResourceAudit', () => {
  it('redacts contents and writes one resource_read line without the id', async () => {
    const result = await readAdr(async () => `# ADR\n\nKey: ${TOKEN}`);

    expect(result).toEqual({
      contents: [{ uri: 'adr://0042', text: '# ADR\n\nKey: [REDACTED:github_token]' }],
    });
    const audit = auditLines();
    expect(audit).toEqual([
      expect.objectContaining({ event: 'resource_read', scheme: 'adr', ok: true, redactions: 1 }),
    ]);
    expect(Object.keys(audit[0] ?? {}).sort()).toEqual(
      ['bytes', 'event', 'level', 'ms', 'msg', 'ok', 'redactions', 'scheme', 'time'].sort(),
    );
    expect(stderr.join('')).not.toContain('0042');
  });

  it('turns not_found into a resource-not-found error and audits ok: false', async () => {
    // The SDK answers a resource miss with -32602 and the requested URI, not the file path.
    await expect(
      readAdr(() => safeFs.readTextFile('docs/adr/0042-missing.md')),
    ).rejects.toMatchObject({
      code: -32602,
      message: 'Resource not found: adr://0042',
      data: { uri: 'adr://0042' },
    });

    expect(auditLines()).toEqual([
      expect.objectContaining({ event: 'resource_read', scheme: 'adr', ok: false, bytes: 0 }),
    ]);
    expect(stderr.join('')).not.toContain('0042');
  });

  it('hides the message of an unexpected error from the client', async () => {
    const read = readAdr(async () => {
      throw new Error(`boom ${TOKEN}`);
    });

    await expect(read).rejects.toThrow('Internal error in adr resource. Try again or report it.');
    expect(stderr.join('')).not.toContain(TOKEN);
    expect(auditLines()).toEqual([expect.objectContaining({ ok: false })]);
  });

  it('passes a SafeFsError message on, redacted', async () => {
    const read = readAdr(async () => {
      throw new SafeFsError('denied', '.env', `Path is on the deny list: .env ${TOKEN}`);
    });

    await expect(read).rejects.toThrow('Path is on the deny list: .env [REDACTED:github_token]');
    expect(auditLines()).toEqual([expect.objectContaining({ ok: false })]);
  });

  async function readRaw(contents: unknown[]): Promise<unknown> {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    server.registerResource(
      'adr',
      new ResourceTemplate('adr://{id}', { list: undefined }),
      {},
      withResourceAudit('adr', async () => ({ contents }) as never),
    );
    const client = await connect(server);
    try {
      return await client.readResource({ uri: 'adr://0001' });
    } finally {
      await client.close();
    }
  }

  it('rejects binary contents and audits ok: false', async () => {
    await expect(readRaw([{ uri: 'adr://0001', blob: 'AAAA' }])).rejects.toThrow(
      'Internal error in adr resource',
    );
    expect(auditLines()).toEqual([expect.objectContaining({ ok: false })]);
  });

  it('drops _meta and redacts the uri of each entry', async () => {
    const result = await readRaw([
      { uri: 'adr://jane@example.com', mimeType: 'text/markdown', text: 'x', _meta: { k: TOKEN } },
    ]);

    expect(result).toEqual({
      contents: [{ uri: 'adr://[REDACTED:email]', mimeType: 'text/markdown', text: 'x' }],
    });
  });
});

describe('withResourceList', () => {
  it('redacts the message of a SafeFsError', async () => {
    const list = withResourceList(() => {
      throw new SafeFsError('unreadable', 'x', `File cannot be read: ${TOKEN}`);
    });
    await expect(list()).rejects.toThrow('File cannot be read: [REDACTED:github_token]');
  });

  it('replaces any other error with a generic message', async () => {
    const list = withResourceList(() => {
      throw new Error(`boom /Users/someone ${TOKEN}`);
    });
    await expect(list()).rejects.toThrow(
      'Internal error in resource list. Try again or report it.',
    );
    expect(stderr.join('')).not.toContain(TOKEN);
  });
});
