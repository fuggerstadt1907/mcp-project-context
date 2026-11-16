import { McpServer } from '@modelcontextprotocol/server';
import type { Config } from './config.js';
import { createSafeFs } from './fs/safe-fs.js';
import { registerAdrResource } from './resources/adr.js';
import { createAdrSource } from './sources/adr.js';
import { registerGetAdr } from './tools/get-adr.js';
import { registerListAdrs } from './tools/list-adrs.js';
import { VERSION } from './version.js';

export function createServer(config: Config): McpServer {
  // Declare the tools capability up front so tools/list answers even before any tool exists.
  const server = new McpServer(
    { name: 'mcp-project-context', version: VERSION },
    { capabilities: { tools: {} } },
  );
  const safeFs = createSafeFs(config);
  const adrs = createAdrSource(safeFs, config.adrDir);

  registerListAdrs(server, adrs, config.adrDir);
  registerGetAdr(server, adrs, { adrDir: config.adrDir, maxFileKb: config.maxFileKb });
  registerAdrResource(server, adrs);
  return server;
}
