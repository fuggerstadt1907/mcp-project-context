import { parseArgs } from 'node:util';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig } from './config.js';
import { log } from './log.js';
import { createServer } from './server.js';
import { VERSION } from './version.js';

const EXIT_INVALID_CONFIG = 2;

const HELP = `mcp-project-context ${VERSION}

MCP server (stdio) that exposes a repository's ADRs, tickets and conventions.

Usage: mcp-project-context --root <dir> [options]

Options:
  --root <dir>          Project root (required)
  --adr-dir <dir>       ADR directory, relative to root (default: docs/adr)
  --tickets-dir <dir>   Tickets directory, relative to root (default: tickets)
  --max-file-kb <n>     Files larger than this are never read (default: 256)
  --allow-write         Register write tools (create_adr_draft)
  -h, --help            Show this help
  -v, --version         Show the version

All output goes to stderr. stdout carries the MCP protocol.
`;

function main(argv: string[]): void {
  let values: ReturnType<typeof parse>['values'];
  try {
    values = parse(argv).values;
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }

  if (values.help) {
    process.stderr.write(HELP);
    return;
  }
  if (values.version) {
    process.stderr.write(`${VERSION}\n`);
    return;
  }

  const result = loadConfig({
    root: values.root,
    adrDir: values['adr-dir'],
    ticketsDir: values['tickets-dir'],
    maxFileKb: values['max-file-kb'],
    allowWrite: values['allow-write'],
  });
  if (!result.ok) {
    fail(result.error);
    return;
  }

  for (const warning of result.warnings) log.warn(warning);
  const { config } = result;
  serveStdio(() => createServer(config), {
    onerror: (error) => log.error('transport error', { error: error.message }),
  });
  log.info('server started', {
    version: VERSION,
    root: config.root,
    adrDir: config.adrDir,
    ticketsDir: config.ticketsDir,
    allowWrite: config.allowWrite,
  });
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      root: { type: 'string' },
      'adr-dir': { type: 'string' },
      'tickets-dir': { type: 'string' },
      'max-file-kb': { type: 'string' },
      'allow-write': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
}

function fail(message: string): void {
  log.error(message, { hint: 'Run with --help for usage.' });
  process.exitCode = EXIT_INVALID_CONFIG;
}

main(process.argv.slice(2));
