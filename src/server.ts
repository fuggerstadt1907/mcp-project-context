import { McpServer } from '@modelcontextprotocol/server';
import type { Config } from './config.js';
import { VERSION } from './version.js';

export function createServer(_config: Config): McpServer {
  // Declare the tools capability up front so tools/list answers even before any tool exists.
  return new McpServer(
    { name: 'mcp-project-context', version: VERSION },
    { capabilities: { tools: {} } },
  );
}
