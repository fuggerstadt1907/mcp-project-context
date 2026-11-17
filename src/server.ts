import { McpServer } from '@modelcontextprotocol/server';
import type { Config } from './config.js';
import { createSafeFs } from './fs/safe-fs.js';
import { registerAdrResource } from './resources/adr.js';
import { registerTicketResource } from './resources/ticket.js';
import { createSearch } from './search.js';
import { createAdrSource } from './sources/adr.js';
import { createConventionSource } from './sources/conventions.js';
import { createTicketSource } from './sources/tickets.js';
import { registerGetAdr } from './tools/get-adr.js';
import { registerGetConventions } from './tools/get-conventions.js';
import { registerGetTicket } from './tools/get-ticket.js';
import { registerListAdrs } from './tools/list-adrs.js';
import { registerListTickets } from './tools/list-tickets.js';
import { registerSearchContext } from './tools/search-context.js';
import { VERSION } from './version.js';

export function createServer(config: Config): McpServer {
  // Declare the tools capability up front so tools/list answers even before any tool exists.
  const server = new McpServer(
    { name: 'mcp-project-context', version: VERSION },
    { capabilities: { tools: {} } },
  );
  const safeFs = createSafeFs(config);
  const adrs = createAdrSource(safeFs, config.adrDir);
  const tickets = createTicketSource(safeFs, config.ticketsDir);
  const conventions = createConventionSource(safeFs);

  registerListAdrs(server, adrs, config.adrDir);
  registerGetAdr(server, adrs, { adrDir: config.adrDir, maxFileKb: config.maxFileKb });
  registerAdrResource(server, adrs);
  registerListTickets(server, tickets, config.ticketsDir);
  registerGetTicket(server, tickets, {
    ticketsDir: config.ticketsDir,
    maxFileKb: config.maxFileKb,
  });
  registerTicketResource(server, tickets);
  registerGetConventions(server, conventions);
  registerSearchContext(server, createSearch({ adrs, tickets, conventions }));
  return server;
}
