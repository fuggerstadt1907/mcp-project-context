import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { createServer } from '../src/server.js';

const config: Config = {
  root: process.cwd(),
  adrDir: 'docs/adr',
  ticketsDir: 'tickets',
  maxFileKb: 256,
  allowWrite: false,
};

describe('createServer', () => {
  it('answers listTools with an empty list', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer(config).connect(serverTransport);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();

    expect(tools).toEqual([]);
    await client.close();
  });
});
