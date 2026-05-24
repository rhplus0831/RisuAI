# Phase 8 Memory - 8-2b Closeout

Date: 2026-05-24

## Scope Landed

- Added `server/fastify/src/memoryWorker.ts` with a single in-process
  worker lifecycle.
- The worker supports idempotent `start()` / `stop()`, configurable
  polling, explicit `tick()` for deterministic tests, and one-at-a-time
  job claiming through `claimNextMemoryJob`.
- Job dispatch is kind-based for `chunk`, `embed`, and `summarize`.
  Default handlers are no-op stubs; injected handlers let tests prove
  dispatch and shutdown behavior without real memory mutations.
- Successful handlers complete jobs through `completeMemoryJob`.
  Handler exceptions fail jobs through `failMemoryJob` with the thrown
  error message.
- `buildApp()` now starts the memory worker after opening/backfilling the
  DB and stops it in `onClose` before closing the DB. Tests can pass
  `memoryWorker: false` or injected worker options through `BuildAppOptions`.
- Added `server/fastify/__tests__/memoryWorker.test.ts` covering
  lifecycle idempotency, dispatch, one-at-a-time claiming, failure
  persistence, graceful shutdown, and Fastify startup/shutdown
  integration.

## Boundaries

- `chunk`, `embed`, and `summarize` remain stub handlers.
- No retry/backoff, attempt counters, next-run scheduling, boot recovery,
  SSE progress events, memory job routes, provider calls, real chunk /
  summary / embedding mutation handlers, or browser UI landed here.
- Cancellation still uses the 8-2a repository primitive only; 8-2c owns
  the worker-aware pending/running cancellation semantics.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryWorker.test.ts server/fastify/__tests__/memoryRepository.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Focused verification passed with 15 tests. `pnpm check` was clean.
`pnpm test` passed with 639 tests plus 4 skipped. `pnpm api:test`
passed with 920 tests. `pnpm build` passed with existing CSS
`::highlight`, browser externalization, plugin-timing, and chunk-size
warnings.

## Next Pickup

Continue with 8-2c - retry, backoff, cancel, and boot recovery. Add
attempt tracking and retry scheduling directly to the current schema,
teach claiming to respect scheduled retry time, persist max-retry
failures, define worker-aware cancellation for pending/running jobs, and
recover abandoned `running` jobs on startup. Keep SSE progress, routes,
provider calls, real memory mutation handlers, and browser UI out of
8-2c.
