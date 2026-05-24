# Phase 8 Memory - 8-2d Closeout

Date: 2026-05-24

## Scope Landed

- Added `server/fastify/src/memoryEvents.ts` as the reusable memory
  progress event contract.
- Defined `memory.job` events with `chatId`, `jobId`, `kind`, `status`,
  attempt metadata, retry scheduling, and error fields.
- Defined the Phase-7-compatible `hypav3_progress` side-effect payload
  alongside memory job events. The payload keeps the existing
  `open`, `miniMsg`, `msg`, and `subMsg` shape for the later browser
  progress listener.
- Added `MemoryWorker` `onEvent` support and emitted events for claim,
  completion, retry-backoff, terminal failure, and abandoned-running-job
  recovery transitions.
- Guarded cancellation semantics at the event layer: if a running job is
  cancelled while its handler is in flight, the worker leaves the row
  cancelled and does not emit a false `completed` event.
- Added focused worker tests for successful completion, retry, terminal
  failure, cancellation during handler settlement, and boot recovery
  event emissions.

## Boundaries

- Memory job routes are still out of scope. Enqueue and cancel event
  emission should be added in 8-2e where the routes own those
  transitions.
- `chunk`, `embed`, and `summarize` handlers remain stubs.
- No provider calls, real memory row mutations, browser UI listeners,
  prompt memory selection, or browser job list/cancel controls landed
  here.
- No public SSE route for memory progress landed here; the contract is a
  typed server event surface for later routes/listeners to reuse.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryWorker.test.ts server/fastify/__tests__/memoryRepository.test.ts --config server/fastify/vitest.config.ts
pnpm exec vitest run server/fastify/__tests__/memoryWorker.test.ts server/fastify/__tests__/memoryRepository.test.ts server/fastify/__tests__/db.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Focused verification passed with 26 tests for the worker/repository pair
and 33 tests when `db.test.ts` was included. `pnpm check` was clean.
`pnpm test` passed with 639 tests plus 4 skipped. `pnpm api:test`
passed with 931 tests. `pnpm build` passed with existing CSS
`::highlight`, browser externalization, plugin-timing, and chunk-size
warnings.

## Next Pickup

Continue with 8-2e - memory job routes. Wire
`POST /api/v1/memory/jobs`, `GET /api/v1/memory/jobs`, and
`DELETE /api/v1/memory/jobs/:id` behind auth. Reuse
`buildMemoryJobEvent` for enqueue and cancel transitions owned by the
routes. Keep provider calls, real memory mutation handlers, chunk/summary
read routes, browser listeners, and browser list/cancel UI out of 8-2e.
