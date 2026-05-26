# Phase 8 Follow-Up - Hypa V3 Memory

Date: 2026-05-26

Status: reopened by audit.

## Goal

Close server-owned Hypa V3 memory gaps for custom embeddings, progress
events, and follow-up summary jobs.

## Audit Findings

- Custom embedding follow-ups use the wrong model identifier. Assembly
  returns the custom wire model from
  `server/fastify/src/prompt/assemble.ts:984`; follow-up jobs use the
  value from selection at
  `server/fastify/src/prompt/memoryFollowups.ts:56`, while the embedding
  resolver only recognizes the literal custom selector in
  `server/fastify/src/memoryEmbeddingModel.ts:48`.
- Memory job progress events are optional app wiring in
  `server/fastify/src/app.ts:50` and are passed into worker/routes at
  `server/fastify/src/app.ts:112` and `server/fastify/src/app.ts:155`,
  but `/api/v1/events` streams command events only from
  `server/fastify/src/routes/events.ts:19`. The browser subscriber in
  `src/ts/server/events.ts:6` has no production memory-event path.
- Follow-up summary enqueue misses chunks that have neither summary nor
  embedding. Diagnostics collect missing summaries while iterating
  embeddings in `server/fastify/src/memorySelectionService.ts:117`, and
  follow-ups enqueue from `chunkIdsMissingSummaries` in
  `server/fastify/src/prompt/memoryFollowups.ts:56`.

## Tasks

- Preserve a stable repository/job model key for custom embeddings, such
  as `custom`, and pass the custom wire model separately to the provider
  adapter. An equivalent design is acceptable if tests prove follow-up
  embedding jobs still call the custom model correctly.
- Wire memory job progress into the production event stream consumed by
  the browser, or document a separate production subscriber and add tests
  that exercise it.
- Update memory diagnostics so chunks missing both embedding and summary
  still enqueue summary follow-up jobs.
- Add regression tests for custom embedding follow-ups, progress event
  delivery, and no-embedding/no-summary chunk diagnostics.

## Session Slices

- 8A - Custom embedding follow-up routing. Preserve a stable repository
  and job model key for custom embeddings, pass the custom wire model
  separately to the adapter, and prove prompt-time and deferred jobs call
  the intended custom model.
- 8B - Production memory progress events. Wire memory job progress into
  `/api/v1/events` and the browser subscriber, or document a separate
  production subscriber path with tests that exercise it.
- 8C - Missing-summary diagnostics. Update diagnostics and follow-up
  enqueue logic so chunks missing both embedding and summary still
  schedule summary jobs, with focused no-embedding/no-summary coverage.

## Exit Criteria

- Custom Hypa V3 embedding settings work for prompt-time selection and
  deferred follow-up jobs.
- Browser-visible memory progress is available in Fastify-served web
  mode.
- Missing summaries are scheduled even when the chunk has no embedding
  yet.

## Verification

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/memorySelectionService.test.ts server/fastify/__tests__/memoryJobsRoutes.test.ts server/fastify/__tests__/memoryWorker.test.ts server/fastify/__tests__/assemble.test.ts
pnpm api:test -- server/fastify/__tests__/memoryJobsRoutes.test.ts server/fastify/__tests__/memoryWorker.test.ts
```

## References

- Original phase: `docs/fastify/phases/phase-8-memory.md`
- custom model resolver in assembly: `server/fastify/src/prompt/assemble.ts:984`
- follow-up summary enqueue: `server/fastify/src/prompt/memoryFollowups.ts:56`
- memory diagnostics: `server/fastify/src/memorySelectionService.ts:117`
- optional app memory events: `server/fastify/src/app.ts:50`
- production event route: `server/fastify/src/routes/events.ts:19`
- browser event subscriber: `src/ts/server/events.ts:6`
