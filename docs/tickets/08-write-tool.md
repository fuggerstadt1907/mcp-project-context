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

## Acceptance criteria

- [ ] Resolve open question 6 (numbering) before coding.
- [ ] Without the flag, `listTools()` does not contain `create_adr_draft`.
- [ ] Never overwrites: a race or existing file returns a tool error.
- [ ] A title like `../../evil` produces a safe slug inside `drafts/`.
- [ ] Draft content is not redacted on write (it is the user's own input), but the returned
      text is.
