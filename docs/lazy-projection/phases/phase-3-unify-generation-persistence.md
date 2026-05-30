# Phase 3: Unify Generation Persistence

Date: 2026-05-30

Status: PLANNED. Eases Phase 4; precondition for a clean Phase 6.

## Goal

Make the server own the assistant-message result write for **all** generation, not
just the durable path. Remove the browser's non-durable `generation-result` POST
("B2").

## Background

Today the durable path persists the result server-side
(`persistDurableGenerationResult`, `server/fastify/src/routes/generationChat.ts:756`),
but the non-durable path still has the browser issue the persistence command
(`src/ts/process/index.svelte.ts:399`, guarded by `!serverDurable`). Unifying on
server-owned writes:

- gives one persistence path to migrate to SQLite in Phase 4 (instead of two), and
- removes the "best-effort post-gen swallow" wart on the non-durable inline path.

## Changes

- The route/job owns the assistant-message write for the non-durable send path
  too, reusing the durable persistence shape (idempotent on `generationId`, one
  revision bump, one `generation.persisted` event).
- Remove the browser non-durable persist call; the browser reconciles the
  terminal-frame revision (as the durable path already does).

## Seams

- `server/fastify/src/routes/generationChat.ts` — the result writer
  (`persistDurableGenerationResult` / the non-durable terminal).
- `server/fastify/src/routes/commands.ts` — the `generation-result` command
  (`:3112`) becomes server-internal-only or is retired for this path.
- `src/ts/process/index.svelte.ts` — drop the `serverDispatch && !serverDurable`
  persist branch (`:399`).

## Risks / landmines

- **Double-write avoidance.** The server-owned write must be idempotent on
  `generationId` so a reattach/replay never appends twice.
- Keep the revision bump + single event contract intact.

## Exit criteria

- No browser-issued result-persistence command on any path.
- Server is the sole author of generation results; existing generation tests stay
  green with the browser persist removed.
