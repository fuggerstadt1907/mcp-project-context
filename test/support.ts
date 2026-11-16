// Shared helpers for tests that talk to the server through InMemoryTransport + Client.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { type CallToolResult, InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import type { Config } from '../src/config.js';
import { createServer } from '../src/server.js';

export const DEMO = realpathSync(join(import.meta.dirname, '../examples/demo-project'));

/**
 * Captures stderr for the current test file, checks that nothing reached stdout and removes temp
 * roots after each test.
 */
export function captureIo(): { stderr: () => string; logLines: () => Record<string, unknown>[] } {
  let chunks: string[] = [];
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    chunks = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    stdout = vi.spyOn(process.stdout, 'write');
  });

  afterEach(() => {
    expect(stdout).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
    tempRoots = [];
  });

  const stderr = () => chunks.join('');
  const logLines = () =>
    stderr()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { stderr, logLines };
}

let tempRoots: string[] = [];

export function tempRoot(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-test-')));
  tempRoots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

export async function connect(root: string, overrides: Partial<Config> = {}): Promise<Client> {
  const config: Config = {
    root,
    adrDir: 'docs/adr',
    ticketsDir: 'tickets',
    maxFileKb: 256,
    allowWrite: false,
    ...overrides,
  };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(config).connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

export async function withClient<T>(
  root: string,
  run: (client: Client) => Promise<T>,
  overrides: Partial<Config> = {},
): Promise<T> {
  const client = await connect(root, overrides);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

export function call(
  root: string,
  name: string,
  args: Record<string, unknown> = {},
  overrides: Partial<Config> = {},
): Promise<CallToolResult> {
  return withClient(
    root,
    async (client) => (await client.callTool({ name, arguments: args })) as CallToolResult,
    overrides,
  );
}

export function text(result: CallToolResult): string {
  return (result.content[0] as { text: string }).text;
}
