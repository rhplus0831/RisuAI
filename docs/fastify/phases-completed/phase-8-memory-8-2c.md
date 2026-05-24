# Phase 8 Memory - 8-2c Closeout

Date: 2026-05-24

## Scope Landed

- Added retry scheduling fields to the current `memory_jobs` schema:
  `attempt_count`, `max_attempts`, and `next_run_at`.
- Bumped the Fastify schema version to 3 and kept table creation
  idempotent for fresh and migrated databases.
- Extended memory job repository types and mappers to include attempts,
  max attempts, and next-run scheduling.
- `claimNextMemoryJob` now skips pending jobs whose `next_run_at` is in
  the future and increments `attempt_count` when a job is claimed.
- Added exponential retry scheduling through `retryOrFailMemoryJob`.
  Handler failures return jobs to `pending` until `max_attempts` is
  reached, then persist `failed`.
- Added `recoverRunningMemoryJobs` and wired `MemoryWorker.start()` to
  recover abandoned `running` jobs from a prior process before polling.
- Defined cancellation behavior for the current single in-process
  worker: pending jobs stop before claim, and running jobs remain
  `cancelled` if a handler settles after cancellation.
- Updated bootstrap/smoke tests to assert the exported current schema
  version instead of hard-coded version literals.

## Boundaries

- `chunk`, `embed`, and `summarize` handlers remain stubs.
- No SSE progress events, memory routes, provider calls, real memory row
  mutations, prompt memory selection, or browser UI landed here.
- Cancellation does not abort already-running handler code yet; it only
  guards the persisted queue transition.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryWorker.test.ts server/fastify/__tests__/memoryRepository.test.ts server/fastify/__tests__/db.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Focused verification passed with 28 tests. `pnpm check` was clean.
`pnpm test` passed with 639 tests plus 4 skipped. `pnpm api:test`
passed with 926 tests. `pnpm build` passed with existing CSS
`::highlight`, browser externalization, plugin-timing, and chunk-size
warnings.

## Next Pickup

Continue with 8-2d - memory progress event contract. Define and test the
smallest server event surface for memory queue state changes and
Phase-7-compatible `hypav3_progress` side effects. Keep memory job
routes, provider calls, real memory mutation handlers, and browser UI
listeners out of 8-2d.
