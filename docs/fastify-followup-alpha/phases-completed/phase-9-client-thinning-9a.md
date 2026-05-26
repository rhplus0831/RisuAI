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

Known broader-check status:

- `pnpm check` still fails on pre-existing Fastify/server type errors
  outside this 9A slice. The 9A-owned module test fixture error found
  during verification was fixed; the remaining `svelte-check` output is
  in server memory/generation/prompt/proxy/hub areas and route-backed
  sendChat fixture typing.

Pending before any broad alpha closeout:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```
