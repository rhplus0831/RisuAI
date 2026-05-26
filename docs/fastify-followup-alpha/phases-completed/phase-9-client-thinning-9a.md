# Phase 9 Alpha 9A - Projection-Write Blockers

Date: 2026-05-27

## Scope

Closed the reopened Phase 9 alpha finding where reachable Fastify UI
paths mutated projection aliases before command dispatch.

## Landed Changes

- Module settings create, edit, delete, and global enablement now route
  through command-first helpers in Fastify mode.
- `SideChatList` chat/folder create, fork/copy, delete, fold, color,
  rename, selection, and reorder paths avoid mutating bound projection
  aliases before dispatch. Reorder flows use id-based payload helpers.
- Hypa/supa memory toggle writes now route through a character patch
  command in Fastify mode.
- Global lorebook page selection is durable and now has a typed
  `POST /api/v1/commands/lorebooks/:lorebookId/select` command plus
  server/client tests.

## Verification

Passed:

```bash
pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/commands.test.ts src/ts/moduleCommands.test.ts src/ts/characterCommands.test.ts
pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/events.test.ts server/fastify/__tests__/bootstrap.test.ts
pnpm smoke:fastify-browser
```

## Current Status

Functional Phase 9A alpha work is closed. At the 9A closeout, broader
Fastify/server type errors remained outside this slice; they were later
closed by `50d55b97`. Current alpha status lives in
[`../status.md`](../status.md).
