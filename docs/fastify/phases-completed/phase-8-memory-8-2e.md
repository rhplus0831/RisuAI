# Phase 8 Memory - 8-2e Closeout

Date: 2026-05-24

## Scope Landed

- Added `server/fastify/src/routes/memoryJobs.ts` and registered it from
  the Fastify app.
- Wired the auth-gated backend job API:
  `POST /api/v1/memory/jobs`, `GET /api/v1/memory/jobs`, and
  `DELETE /api/v1/memory/jobs/:id`.
- `POST /api/v1/memory/jobs` enqueues pending `chunk`, `embed`, and
  `summarize` jobs using the existing repository queue shape. The route
  owns job ids and defaults missing payloads to `{}`.
- `GET /api/v1/memory/jobs` lists active `pending` / `running` jobs by
  default and supports optional `chatId`, `kind`, and `status` filters.
- `DELETE /api/v1/memory/jobs/:id` cancels pending/running jobs and
  returns 404 for missing or already-terminal jobs.
- Added route-owned enqueue/cancel event emission through the 8-2d
  `memory.job` contract with `hypav3_progress` side effects and queued
  counts.
- Added `BuildAppOptions.memoryEvents` so routes and the memory worker
  can share the same event sink in tests and later runtime wiring.
- Added focused route tests for enqueue, list, cancel, validation
  failures, unauthorized access, and authenticated access.

## Boundaries

- `chunk`, `embed`, and `summarize` handlers remain stubs.
- No provider calls, memory chunk/summary mutations, chunk/summary read
  routes, browser progress listeners, or browser list/cancel controls
  landed here.
- The memory job API returns the current repository job shape directly;
  no compatibility migration layer was added.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryJobsRoutes.test.ts server/fastify/__tests__/memoryRepository.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Focused route/repository verification passed with 18 tests.
`pnpm check` was clean. `pnpm test` passed with 639 tests plus 4
skipped. `pnpm api:test` passed with 937 tests. `pnpm build` passed with
existing CSS `::highlight`, browser externalization, plugin-timing, and
chunk-size warnings.

## Next Pickup

Continue with 8-3a - Hypa V3 settings + planner contract. Port the
Hypa V3 preset defaults and settings normalization into a server-side
pure module, preserve the locked standard-planner choice, and define the
pure planner input/output contract. Keep memory row mutations, job
enqueueing from planner output, provider calls, summary prompt building,
embedding, prompt-facing selection, and browser controls out of 8-3a.
