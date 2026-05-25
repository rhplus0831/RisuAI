# Phase 8 Memory - 8-7a Closeout

Date: 2026-05-25

## Scope Landed

- Added `server/fastify/src/routes/memoryReads.ts`.
- Registered memory read routes from `server/fastify/src/app.ts`.
- Added auth-gated `GET /api/v1/memory/chunks/:chatId`.
- Added auth-gated `GET /api/v1/memory/summaries/:chatId?model=...`.
- Returned current repository row shapes through `{ chunks }` and
  `{ summaries }` JSON envelopes.
- Used `listMemoryChunks` and `listMemorySummaries` directly, preserving
  current schema/import paths and repository ordering.
- Added focused route coverage in
  `server/fastify/__tests__/memoryReadRoutes.test.ts` for auth, chat
  filtering, model filtering, ordering, empty results, and malformed
  empty model filters.

## Boundaries

- No schema change was needed.
- No compatibility adapters for old intermediate Fastify/browser memory
  shapes were added.
- No summary generation, embedding generation, provider dispatch, or
  queue mutation occurs in the read handlers.
- Browser adapter, progress listener, and list/cancel UI wiring remain
  for later 8-7 slices.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryReadRoutes.test.ts server/fastify/__tests__/memoryJobsRoutes.test.ts --config server/fastify/vitest.config.ts
```

Focused 8-7a verification passed with 12 tests.

## Next Pickup

Continue with 8-7b - Browser memory API adapter. Add a thin
server-backed browser client for chunk reads, summary reads, job listing,
and cancellation while keeping progress UI/list UI wiring for later
8-7 slices.
