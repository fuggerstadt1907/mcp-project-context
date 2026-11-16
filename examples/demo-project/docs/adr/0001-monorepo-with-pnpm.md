# 0001: Monorepo with pnpm workspaces

- Status: Accepted
- Date: 2026-03-02

## Context

Web app, mobile app and API share types and validation. Separate repos caused version drift.

## Decision

One repository with pnpm workspaces: `apps/web`, `apps/mobile`, `apps/api`, `packages/shared`.

## Consequences

- Shared types change in one PR across all apps.
- CI must run only affected packages to stay fast.
