# 01 Server skeleton and CLI

Labels: foundation

## Goal

A server that starts with `--root`, connects over stdio and lists zero tools. Logging works and
never touches stdout.

## Scope

- `src/config.ts`: `Config` type and zod schema. Fields: `root` (real path, must exist and be a
  directory), `adrDir` (default `docs/adr`), `ticketsDir` (default `tickets`), `maxFileKb`
  (default 256), `allowWrite` (default false).
- `src/cli.ts`: parse flags with `node:util` `parseArgs`. `--version` and `--help`. On invalid
  config, print the reason to stderr and exit with code 2.
- `src/server.ts`: `createServer(config): McpServer`. No tools yet.
- `src/log.ts`: `log.info|warn|error(msg, fields?)` writes JSON lines to stderr.
- Wire it: `serveStdio(() => createServer(config))`.
- Remove `test/setup.test.ts`.

## Acceptance criteria

- [ ] `pnpm dev` starts and waits for input without printing to stdout.
- [ ] `node dist/cli.js` without `--root` exits with code 2 and a readable message.
- [ ] `--root` pointing to a file or missing path exits with code 2.
- [ ] Test: `createServer` connected via `InMemoryTransport` answers `listTools()` with an empty list.
- [ ] Test: config parsing (defaults, invalid values).
- [ ] `pnpm check` and `pnpm build` pass.
- [ ] Add `pnpm build` as the last step in `.github/workflows/ci.yml`.

## Notes

`serveStdio` takes a factory, not a server instance. See `docs/architecture.md`.
