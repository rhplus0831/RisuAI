# Reference: Surgical Inbound Sync

Date: 2026-05-30

Backs Phase 2. How the client applies SSE command events without a full-projection
refetch, and why it needs no replay buffer or op-id.

## The problem

Today: a command event → `scheduleServerProjectionRefresh` →
`refreshServerProjection()` → `fetchServerBootstrapProjectionReadOnly()` →
`applyServerProjectionDatabase()`, a full `setDatabase` replace
(`src/ts/bootstrap.ts:156-166`). Once the projection ships stubs (Phases 4–5), that
replace re-stubs whatever the user hydrated. So the refresh must become surgical.

## What the code already gives us

- Every `CommandEvent` carries the **monotonic global `revision`**
  (`server/fastify/src/commands/events.ts:3`), bumped by exactly +1 per mutation
  in `db.ts`. Also `resource`, `id?`, `parentId?`.
- The client already caches the revision returned by its own command responses
  (`setCachedServerCommandRevision`, `src/ts/server/commands.ts:957`;
  `getServerCommandBaseRevision` returns the cache without a fetch, `:967-999`).
- The SSE frame has **no `id:` line** (`server/fastify/src/routes/events.ts:11-16`)
  → no native `Last-Event-ID`. We do **not** build a replay buffer.

Consequence: gap detection is free (compare expected vs received revision), and
own-echo detection needs no client op-id (the writer already knows the revisions
it authored, via its command responses).

## The model (single-writer)

1. **On a command:** apply the change optimistically to the local projection via
   `withTrustedServerProjectionWrite` (the projection proxy is read-only,
   `src/ts/server/projectionWriteGuard.svelte.ts:59`), and cache the returned
   revision.
2. **On each SSE command event**, decide:
   - `event.revision <= cachedRevision` → already accounted for (my echo) → **skip**.
   - ahead + contiguous + foreign → **targeted fetch** of `event.resource` and
     advance the cache. (Foreign events are real even under single-writer:
     durable-generation completion `generation.persisted`, memory-worker events.)
   - **revision gap** (`event.revision > cachedRevision + 1`) or SSE reconnect →
     **full bootstrap** fallback (today's behavior, now only here).

## Why each piece is required

- **Echo-skip** is what stops re-stubbing the hydrated entity (the Phase 2 ↔ Phase 4
  link).
- **Gap detection + full-bootstrap-on-gap** restores the self-healing property
  that the per-event full refetch provided. Without it, a dropped event = permanent
  divergence. This is mandatory, not optional.
- **No replay buffer / no op-id**: the monotonic revision already disambiguates;
  building a `Last-Event-ID` event log is unnecessary scope.

## The hydration link

The **targeted per-resource fetch** built here is the same primitive Phases 4–5
use to hydrate a chat's messages / a character's `globalLore` / a module's
`lorebook` on open. Build it once, in Phase 2.
