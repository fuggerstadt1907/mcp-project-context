# Changelog

## 0.1.0 (2026-11-19)

First release.

### Tools and resources

- `list_adrs`, `get_adr`: ADRs in bullet (`- Status:`), Nygard (`## Status`) and MADR 3
  (frontmatter) format, split into title, status, date, context, decision and consequences.
  Status filter, case-insensitive. ADRs off the template stay listed.
- `list_tickets`, `get_ticket`: markdown tickets with frontmatter, status and label filters,
  acceptance criteria as checklist items.
- `get_conventions`: `CONVENTIONS.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `AGENTS.md` from the root.
- `search_context`: keyword search over ADRs, tickets and conventions, with snippets.
- `create_adr_draft`: writes a new ADR to `<adr-dir>/drafts/`, never overwrites. Only registered
  with `--allow-write`.
- Resources `adr://{id}` and `ticket://{id}` return the raw markdown.

### Guardrails

- No file outside `--root` is readable through `..`, absolute paths or symlinks (two documented
  gaps: hard links and a symlink swapped in during a read, see the README Limitations).
  `.env*`, `.git/`, `node_modules/`, files over `--max-file-kb` and files outside the extension
  allow-list (`.md`, `.mdx`, `.txt`, `.yaml`, `.yml`, `.json`) are refused.
- Every text sent to the client is redacted: private keys, AWS keys, GitHub and Slack tokens, JWTs,
  `Authorization` headers, URL credentials, emails, IBANs, phone numbers and `key = value` secrets.
- Unknown input fields are rejected, so a typo in a filter is an error, not an unfiltered list.
- One audit line on stderr per tool call and resource read that reaches the handlers, without
  arguments or content.
  stdout carries only the MCP protocol.
