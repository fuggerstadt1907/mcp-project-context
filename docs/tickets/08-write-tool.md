# 08 Write tool behind a flag

Labels: feature, security

## Goal

With explicit opt-in, the agent can propose a new decision as an ADR draft.

## Scope

- Add `writeTextFile(relPath, content, { overwrite: false })` to `safe-fs.ts` with the same root
  and deny rules. Use exclusive create (`flag: 'wx'`).
- Tool `create_adr_draft` — input `{ title, context, decision, consequences }`. Writes
  `<adrDir>/drafts/NNNN-<slug>.md` with status `Proposed` and today's date. Returns the path.
- Register it **only** when `config.allowWrite` is true (ADR 0002).
- Annotations: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`.

## Decisions

Recorded as requirements decisions 87–93: parallel calls are serialised (87), missing ADR
directory (88), output (89), slug with redaction first (90), numbering by name (91), file and
input details (92), strict input schema (93).

## Acceptance criteria

- [x] Numbering: highest number across `<adrDir>` and `<adrDir>/drafts/`, plus one
      (requirements decision 6). With ADRs 0001 to 0004 and draft 0005, the next draft is 0006.
- [x] Without the flag, `listTools()` does not contain `create_adr_draft`.
- [x] Never overwrites: an existing entry at the target returns a tool error. Parallel calls in
      one server all succeed with consecutive numbers (requirements decision 87).
- [x] A title like `../../evil` produces a safe slug inside `drafts/`.
- [x] Draft content is not redacted on write (it is the user's own input), but the returned
      text is.
