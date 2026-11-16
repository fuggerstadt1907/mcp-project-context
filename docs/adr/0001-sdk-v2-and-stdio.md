# 0001: MCP TypeScript SDK v2 with stdio transport

- Status: Accepted
- Date: 2026-11-16

## Context

The server runs locally next to a coding agent. The MCP TypeScript SDK v2
(`@modelcontextprotocol/server`) is the stable line for the 2026-07-28 spec; v1
(`@modelcontextprotocol/sdk`) is the previous line. Claude Code starts local servers as child
processes and talks to them over stdio.

## Decision

Use `@modelcontextprotocol/server` 2.x with `serveStdio`. No HTTP transport in v0.1.
Pin the exact SDK version and update deliberately.

## Consequences

- No network surface, no authentication needed.
- stdout belongs to the protocol. Any `console.log` breaks the connection, so logging goes to stderr
  and Biome forbids `console.*` except `console.error`.
- Integration tests use `InMemoryTransport` instead of spawning processes. One smoke test spawns the
  real CLI to cover the stdio wiring.
