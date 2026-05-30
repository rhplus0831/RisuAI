# Phase 2: Surgical Inbound Sync

Date: 2026-05-30

Status: PLANNED. **Prerequisite for Phases 4 and 5.**

## Goal

Stop the SSE command-event refresh from doing a full-projection refetch +
`setDatabase` replace on every event. Replace it with: optimistic local apply +
revision-based echo-skip + targeted fetch on foreign events or a detected gap.
Full bootstrap becomes the gap/reconnect fallback, not the per-event default.

Design detail: [`../reference/surgical-sync.md`](../reference/surgical-sync.md).

## Why this must precede stub-loading

Today every command event triggers `scheduleServerProjectionRefresh` →
`refreshServerProjection()` → `fetchServerBootstrapProjectionReadOnly()` →
`applyServerProjectionDatabase()`, a full `setDatabase` replace
(`src/ts/bootstrap.ts:156-166`). Once the projection ships stubs, that replace
re-stubs whatever the user just hydrated. So stub-loading is non-functional until
this lands.

## What the code already gives us

- Every `CommandEvent` carries the monotonic global `revision`
  (`server/fastify/src/commands/events.ts:3`; `resource`, `id?`, `parentId?`
  alongside).
- The SSE frame has **no `id:` line** (`server/fastify/src/routes/events.ts:11-16`),
  so there is no native `Last-Event-ID` replay — and we do not build one.

So gap detection is essentially free (compare expected vs received revision), and
own-echo identification needs no client op-id (the client already caches the
revision returned by its own command response).

## Changes

- On a command: apply the change optimistically via `withTrustedServerProjectionWrite`
  and cache the revision returned by the command response (the cache already
  exists — `setCachedServerCommandRevision`, `src/ts/server/commands.ts:957`).
- Rework `refreshServerProjection` into a decision tree on each event:
  - `event.revision <= cachedRevision` → already applied (own echo) → **skip**.
  - `event.revision` ahead, contiguous, foreign → **targeted fetch** of the named
    `resource` (the same per-resource fetch primitive Phases 4–5 use for hydration).
  - revision **gap** (received > expected+1) or SSE reconnect → **full bootstrap**
    fallback (today's self-healing behavior, now triggered only here).
- Foreign events are real even under single-writer: durable-generation completion
  (`generation.persisted`) and the memory worker originate server-side events.

## Seams

- `src/ts/bootstrap.ts` — `scheduleServerProjectionRefresh` / `refreshServerProjection`.
- `src/ts/server/events.ts` — `onCommandEvent` wiring; events already parsed with
  `revision`/`resource`.
- `src/ts/server/commands.ts` — revision cache; optimistic apply through the
  trusted-write path.

## Risks / landmines

- **Loss of self-healing.** Full refetch is self-healing today; once you skip it,
  a missed event = permanent divergence. The revision-gap check + full-bootstrap-on-gap
  is mandatory, not optional.
- Optimistic apply must go through `withTrustedServerProjectionWrite` (the
  projection proxy is read-only, `projectionWriteGuard.svelte.ts:59`).

## Exit criteria

- A command no longer triggers a full `setDatabase` replace; the writer's own
  change is applied optimistically and its echo is skipped.
- A foreign event updates only its resource; an injected revision gap or a
  reconnect recovers via full bootstrap (covered by tests of the decision tree).
- This delivers the **targeted per-resource fetch primitive** that Phases 4–5
  reuse for hydration.
