import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI = ['--import', 'tsx', 'src/cli.ts'];
const DEMO = 'examples/demo-project';

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function start(args: string[]): { child: ChildProcess; done: Promise<Run> } {
  const child = spawn(process.execPath, [...CLI, ...args], { stdio: 'pipe' });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk;
  });
  const done = new Promise<Run>((resolve) => {
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
  return { child, done };
}

function run(args: string[]): Promise<Run> {
  const { child, done } = start(args);
  child.stdin?.end();
  return done;
}

function jsonLines(text: string): Record<string, unknown>[] {
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

// Created at module level: the it.each tables below are built before beforeAll runs.
const base = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-cli-')));

beforeAll(() => {
  writeFileSync(join(base, 'file.txt'), 'x');
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('cli', () => {
  it.each([
    ['no --root', [], '--root is required'],
    ['a missing root', ['--root', join(base, 'nope')], '--root does not exist'],
    ['a file as root', ['--root', join(base, 'file.txt')], '--root is not a directory'],
    [
      'a tickets dir outside root',
      ['--root', DEMO, '--tickets-dir', '../other'],
      '--tickets-dir resolves outside --root',
    ],
    ['an unknown flag', ['--root', DEMO, '--nope'], "Unknown option '--nope'"],
    // ADR 0005: audit goes to stderr only.
    [
      '--audit-file',
      ['--root', DEMO, '--audit-file', 'audit.log'],
      "Unknown option '--audit-file'",
    ],
  ])(
    'exits with code 2 for %s',
    async (_name, args, message) => {
      const { code, stdout, stderr } = await run(args);
      expect(code).toBe(2);
      expect(stdout).toBe('');
      const [line] = jsonLines(stderr);
      expect(line).toMatchObject({ level: 'error' });
      expect(String(line?.msg)).toContain(message);
    },
    15_000,
  );

  it.each([['--help'], ['--version']])(
    'prints %s to stderr only',
    async (flag) => {
      const { code, stdout, stderr } = await run([flag]);
      expect(code).toBe(0);
      expect(stdout).toBe('');
      expect(stderr).not.toBe('');
    },
    15_000,
  );

  it('starts against the demo project, logs to stderr and keeps stdout empty', async () => {
    const { child, done } = start(['--root', DEMO]);
    await new Promise<void>((resolve) => {
      child.stderr?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('server started')) resolve();
      });
    });
    child.kill();
    const { stdout, stderr } = await done;
    expect(stdout).toBe('');
    expect(jsonLines(stderr)).toContainEqual(
      expect.objectContaining({ level: 'info', msg: 'server started' }),
    );
  }, 15_000);

  it('starts with a missing tickets dir and logs a warning', async () => {
    const { child, done } = start(['--root', DEMO, '--tickets-dir', 'nope']);
    await new Promise<void>((resolve) => {
      child.stderr?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('server started')) resolve();
      });
    });
    child.kill();
    const { stdout, stderr } = await done;
    expect(stdout).toBe('');
    expect(jsonLines(stderr)).toContainEqual(
      expect.objectContaining({ level: 'warn', msg: expect.stringContaining('--tickets-dir') }),
    );
  }, 15_000);
});
