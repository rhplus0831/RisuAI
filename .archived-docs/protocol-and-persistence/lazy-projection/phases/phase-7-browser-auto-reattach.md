# Phase 7: Browser Auto-Reattach

Date: 2026-05-30

Status: PLANNED. Capstone. Depends only on durable `send` (already exists), so it
is movable earlier if desired.

## Goal

Let a reloaded / reconnected browser re-attach to a live in-flight generation and
resume rendering the stream, instead of only seeing the result after it lands.

## Background

The server half is already built and tested:
- `GET /api/v1/generate/chat/:id/stream` reattaches (read-only observe,
  `server/fastify/src/routes/generationChat.ts:1234`).
- Bootstrap surfaces `activeGenerationJobs` (`{ chatId, jobId }[]`,
  `routes/bootstrap.ts:37`).

The client half does not exist: `rg activeGenerationJobs src/` returns zero hits.
The durability guarantee does **not** depend on this phase — the result is
server-persisted and surfaces on the next projection refresh. This phase is purely
the live re-stream UX.

## Changes

- Add `activeGenerationJobs` to the client bootstrap projection contract
  (`src/ts/server/bootstrap.ts`).
- On load, if a job is running for the current chat, re-drive the orchestrator off
  `GET .../:id/stream` (replay buffered frames, reconcile partial render) instead
  of starting fresh.

## Seams

- `src/ts/server/bootstrap.ts`, `src/ts/process/index.svelte.ts` (orchestrator
  entry), `src/ts/process/request/serverChat.ts` (SSE adapter).

## Risks / landmines

- Re-driving the orchestrator from a mid-stream reattach (buffered-frame replay +
  reconciling already-rendered tokens) is the only real complexity.

## Exit criteria

- A mid-generation reload re-attaches to the live stream rather than only seeing
  the result post-hoc.
- This closes the one part of durable generation that was not end-to-end (its
  server half was already done).
