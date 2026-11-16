# 0004: Read sources on every call, no cache

- Status: Accepted
- Date: 2026-11-16

## Context

NFR-7 asks for answers under 300 ms on a project with 500 markdown files. A cache or an index
built at startup is the obvious way to get there. But the agent edits the same files during a
session: it ticks acceptance criteria, adds ADR drafts, changes tickets. A stale answer is worse
than a slow one, because the agent cannot tell it is stale.

## Decision

Sources hold no state. Every tool call and resource read lists and reads the files it needs from
disk through `safe-fs`. There is no startup index and no mtime cache in v0.1.

## Consequences

- Results always reflect the files on disk, with no invalidation logic to test.
- Ticket 07's performance test (500 generated files, under 300 ms) is the check. If it fails, a
  cache comes back as a new ADR that supersedes this one.
- Each call costs a directory listing plus file reads. This is acceptable for local markdown.
