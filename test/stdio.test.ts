// Smoke test of the built CLI over real stdio (AC25, NFR-5): stdout carries only protocol
// messages, stderr only JSON log lines.
import { execFileSync, spawn } from 'node:child_process';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/server';
import { beforeAll, describe, expect, it } from 'vitest';

const DEMO = 'examples/demo-project';

// Builds the current source, so the test never runs against a stale dist/ (also in CI, where the
// build step comes after the tests). Output is piped, so a failing build shows tsup's errors.
beforeAll(() => {
  execFileSync('pnpm', ['build'], { stdio: 'pipe' });
}, 60_000);

// Joined from parts so secret scanning does not flag this file (decision 43).
const AGENT_SECRET = ['ghp_', 'b'.repeat(36)].join('');

const REQUESTS = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'stdio-test', version: '0.0.0' },
    },
  },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'get_adr', arguments: { id: '2' } },
  },
  // The SDK quotes an unknown tool name in its error; the CLI must redact it (decision 99).
  { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: AGENT_SECRET, arguments: {} } },
];

interface Session {
  code: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

/** Sends each request after the previous response arrived, then closes stdin. */
function session(): Promise<Session> {
  const child = spawn(process.execPath, ['dist/cli.js', '--root', DEMO], { stdio: 'pipe' });
  let stdout = '';
  let stderr = '';
  let next = 0;
  let awaited = 0;
  // Writes requests up to and including the next one that expects a response.
  const send = () => {
    while (next < REQUESTS.length) {
      const request = REQUESTS[next++];
      child.stdin.write(`${JSON.stringify(request)}\n`);
      if (request && 'id' in request) {
        awaited++;
        return;
      }
    }
    child.stdin.end();
  };
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (!stdout.endsWith('\n')) return;
    const responses = lines(stdout).filter((line) => 'id' in JSON.parse(line)).length;
    if (responses === awaited) send();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, 10_000);
  return new Promise((resolve) => {
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut, stdout, stderr });
    });
    send();
  });
}

function lines(text: string): string[] {
  return text.split('\n').filter((line) => line !== '');
}

describe('built CLI over stdio', () => {
  it('answers initialize, tools/list and two tools/call with JSON-RPC only on stdout', async () => {
    const { code, timedOut, stdout, stderr } = await session();
    expect(timedOut, 'the server did not answer every request within 10 s').toBe(false);

    expect(stdout.endsWith('\n')).toBe(true);
    const messages = lines(stdout).map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(messages.map((m) => [m.jsonrpc, m.id, 'result' in m])).toEqual([
      ['2.0', 1, true],
      ['2.0', 2, true],
      ['2.0', 3, true],
      ['2.0', 4, false],
    ]);
    expect(messages[3]?.error).toMatchObject({ message: expect.stringContaining('[REDACTED:') });
    expect(stdout).not.toContain(AGENT_SECRET);

    const [init, list, call] = messages.slice(0, 3).map((m) => m.result) as [
      Record<string, unknown>,
      { tools: { name: string }[] },
      Record<string, unknown>,
    ];
    expect(init).toMatchObject({
      protocolVersion: LATEST_PROTOCOL_VERSION,
      serverInfo: { name: 'mcp-project-context' },
    });
    expect(list.tools.map((t) => t.name)).not.toContain('create_adr_draft');
    expect(call).toMatchObject({ structuredContent: { id: '0002' } });
    expect(call.isError).toBeFalsy();

    const logs = lines(stderr).map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(logs).toContainEqual(expect.objectContaining({ msg: 'server started' }));
    expect(logs).toContainEqual(
      expect.objectContaining({ msg: 'audit', event: 'tool_call', tool: 'get_adr', ok: true }),
    );
    expect(code).toBe(0);
  }, 20_000);
});
