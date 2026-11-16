# 01 Server skeleton and CLI

Labels: foundation

## Goal

A server that starts with `--root`, connects over stdio and lists zero tools. Logging works and
never touches stdout.

## Scope

- `src/config.ts`: `Config` type and zod schema. Fields: `root` (real path, must exist and be a
  directory), `adrDir` (default `docs/adr`), `ticketsDir` (default `tickets`), `maxFileKb`
  (default 256), `allowWrite` (default false). `adrDir` and `ticketsDir` must resolve inside the
  real root (same realpath check as safe-fs); otherwise the config is invalid. A directory that
  does not exist is allowed and only logs a warning at startup (requirements FR-1, FR-16).
- `src/cli.ts`: parse flags with `node:util` `parseArgs`. `--version` and `--help`. On invalid
  config, print the reason to stderr and exit with code 2.
- `src/server.ts`: `createServer(config): McpServer`. No tools yet.
- `src/log.ts`: `log.info|warn|error(msg, fields?)` writes JSON lines to stderr.
- Wire it: `serveStdio(() => createServer(config))`.
- Remove `test/setup.test.ts`.

## Acceptance criteria

- [x] `pnpm dev` starts and waits for input without printing to stdout.
- [x] `node dist/cli.js` without `--root` exits with code 2 and a readable message.
- [x] `--root` pointing to a file or missing path exits with code 2.
- [x] `--tickets-dir ../other` or a symlinked dir pointing outside root exits with code 2.
- [x] A missing `--adr-dir` or `--tickets-dir` starts the server and logs a warning.
- [x] Test: `createServer` connected via `InMemoryTransport` answers `listTools()` with an empty list.
- [x] Test: config parsing (defaults, invalid values).
- [x] `pnpm check` and `pnpm build` pass.
- [x] Add `pnpm build` as the last step in `.github/workflows/ci.yml`.

## Notes

`serveStdio` takes a factory, not a server instance. See `docs/architecture.md`.
