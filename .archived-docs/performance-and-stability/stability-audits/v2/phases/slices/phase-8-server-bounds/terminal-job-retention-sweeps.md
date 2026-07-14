# Slice: Terminal Job Retention Sweeps

Phase: [8](../../phase-8-server-bounds.md). Findings: L2 and L17. Runtime
change. Status: done 2026-06-06.

## Scope

Add bounded retention for terminal server-side job rows:
`generation_finalization_retries` rows that have reached a terminal failure and
`memory_jobs` rows in completed, failed, or cancelled states.

This slice does not own retry scheduling semantics, generation finalization
logic, memory job execution behavior, or legacy import wipes.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L2 and L17.
- `server/fastify/src/generationFinalizationRetry.ts`:
  `markGenerationFinalizationRetryFailure`, terminal retry selection, and retry
  worker cleanup.
- `server/fastify/src/memoryRepository.ts`: memory job create/list/update code
  near the current only-delete path.
- `server/fastify/src/memoryWorker.ts`: worker lifecycle if the sweep is wired
  to worker ticks.
- `server/fastify/src/app.ts`: startup/timer wiring if retention is app-level.
- Existing focused suites:
  `server/fastify/__tests__/durableGeneration.test.ts`,
  `server/fastify/__tests__/memoryRepository.test.ts`,
  `server/fastify/__tests__/memoryJobsRoutes.test.ts`, and
  `server/fastify/__tests__/memoryWorker.test.ts`.

## Target Shape

- Introduce explicit retention constants or config-backed defaults for terminal
  finalization retry rows and terminal memory jobs.
- Add repository helpers that delete only terminal rows older than the retention
  cutoff. Live pending, running, retryable, and recently-terminal rows must be
  untouched.
- Wire the sweeps to a bounded cadence: startup, existing worker maintenance,
  job creation/update, or a small app timer are all acceptable if the tests can
  prove the cadence is finite and deterministic.
- Keep finalization retry history long enough for observability before TTL
  deletion; avoid deleting rows that still need retry attempts.
- Preserve memory job route result shapes for non-pruned rows.
- Add tests with old terminal rows, recent terminal rows, and live rows for both
  tables.
- Register L2 and L17 as `DONE` in the v2 gate with focused tests, and flip
  both rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Retention cannot delete work that may still retry or resume.
- Job ids, timestamps, and route responses remain unchanged for retained rows.
- Legacy import behavior that clears memory jobs stays independent.
- Sweep failures must not crash generation or memory workers unless the
  existing caller already treats DB errors as fatal.

## Done Criteria

- Old terminal finalization retry rows are deleted; live and recent rows remain.
- Old completed, failed, and cancelled memory jobs are deleted; pending/running
  jobs remain.
- Focused tests cover both retention helpers and the selected sweep wiring.
- L2 and L17 v2 gate entries point at real focused tests and the risk-map rows
  are `DONE`.

## Proof

- `server/fastify/__tests__/durableGeneration.test.ts`: L2 helper coverage for
  old terminal, recent terminal, and pending rows; app retry-sweep wiring.
- `server/fastify/__tests__/memoryRepository.test.ts`: L17 helper coverage for
  old terminal, recent terminal, pending, running, and max-per-sweep rows.
- `server/fastify/__tests__/memoryWorker.test.ts`: worker startup maintenance
  sweep.
- `server/fastify/__tests__/memoryJobsRoutes.test.ts`: route shape for retained
  active and recent terminal rows after startup pruning.
- `src/ts/__tests__/fixCompletenessGateV2.test.ts`: L2/L17 registered `DONE`
  with the focused proof paths above.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/durableGeneration.test.ts \
  server/fastify/__tests__/memoryRepository.test.ts \
  server/fastify/__tests__/memoryJobsRoutes.test.ts \
  server/fastify/__tests__/memoryWorker.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
