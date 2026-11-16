# 0002: Read-only by default, write tools behind a flag

- Status: Accepted
- Date: 2026-11-16

## Context

Agents call tools on their own. A write tool that is merely "discouraged" will eventually be
used. MCP tool annotations (`readOnlyHint`, `destructiveHint`) are hints for the client, not
enforcement.

## Decision

Write tools are **not registered at all** unless the server starts with `--allow-write`.
The only write tool in v0.1, `create_adr_draft`, writes into `<adr-dir>/drafts/`, never overwrites
an existing file, and goes through the same root guard as reads.

## Consequences

- Safe default for team rollout: installing the server cannot change files.
- Tests must assert that the write tool is absent from `listTools()` without the flag.
- Users who want drafts must opt in explicitly in their MCP config.
