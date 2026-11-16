# 02 Safe file access

Labels: security, foundation

## Goal

One module that is the only way to read files. It makes it impossible to read outside the project
root or to read files that must never leave the machine.

## Scope

`src/fs/safe-fs.ts`, created from `Config`:

- `readTextFile(relPath): Promise<string>`
- `listFiles(relDir, { extensions }): Promise<string[]>` (relative paths, sorted)
- `exists(relPath): Promise<boolean>`

Rules, in this order:

1. Reject absolute paths and paths containing NUL bytes.
2. Resolve against root, then `realpath`. The result must start with the real root plus a separator.
   This covers `..` and symlinks pointing outside.
3. Deny list: any path segment `.git`, `node_modules`, or a file name matching `.env*`.
4. Only extensions `.md`, `.mdx`, `.txt`, `.yaml`, `.yml`, `.json`.
5. Size limit `maxFileKb`.

Throw a typed `SafeFsError` with a `reason` (`outside_root`, `denied`, `extension`, `too_large`,
`not_found`). Tools turn it into a tool error later.

## Acceptance criteria

- [ ] Negative tests for every rule: `../secret.md`, `/etc/passwd`, a symlink inside root pointing
      outside, `.env`, `.git/config`, `node_modules/x/readme.md`, a `.ts` file, an oversized file.
- [ ] Positive test: nested markdown file inside root is read.
- [ ] `listFiles` never returns denied files and does not follow symlinked directories outside root.
- [ ] Tests build their fixtures in a temp dir (`fs.mkdtemp`), not in the repo.
- [ ] No other module imports `node:fs` for reading (check in review).
