# Phase 7: Verification Budgets

Status: implemented; the verification-log maintenance rule stays standing. The
shared metric gates cover every emittable `mutationPath`, every narrowed family
has its written-table + rowid-stability budget, and
`commandMutationBudget.test.ts` fails on any gate-map drift (a new route, a
renamed label, or a loosened narrow gate). The only ongoing work is replacing the
`latest-verification.md` "Latest Run" section on each subsequent run.

Goal: keep narrow writes narrow. Generalize the reference fix's
`dbJsonWriteMs: 0` metric gate and `tableRowidsById` rowid-stability assertion
into maintained per-route budgets. Keep the verification log current.

## Implementation

- `server/fastify/__tests__/helpers/commandMetricGates.ts` carries one review
  gate per emittable `mutationPath`. Every `targeted-*` gate fixes
  `dbJsonWriteMs: 0` and declares a written-table budget (`expectedTables` /
  `maxTables` / `forbiddenTables`); the broad `hydrated` / `message-free`
  baselines keep their documented table budgets. The Phase 7 pass added the
  missing `targeted-assembly` gate (the `/generate/chat` scriptstate + transcript
  persistence path).
- `server/fastify/__tests__/commandMutationBudget.test.ts` (6 tests) makes the
  gate map a self-checking budget surface: it scans the server source for every
  emittable label and requires the gate set and the emitted set to be exactly
  equal, every `targeted-*` gate to hold the `dbJsonWriteMs: 0` floor + a table
  budget, the baselines to keep theirs, and no budget to name a table outside the
  physical universe.
- The per-family written-table + rowid-stability budgets live in
  `commandCollectionRange.test.ts`, `commandSingleRowPaths.test.ts`,
  `commandSettingsAndPluginStorageRange.test.ts`, and `commandMetrics.test.ts`;
  `generation.chat.test.ts` asserts the `targeted-assembly` budget against its
  real runtime metric.

## Source Anchors

- `server/fastify/__tests__/helpers/commandMetricGates.ts` - the
  `mutationPath` review gate map and `dbJsonWriteMs` checks.
- `server/fastify/__tests__/command*Range.test.ts` and
  `server/fastify/__tests__/commands.test.ts` - route/family rowid-stability and
  written-table assertions.
- [`../latest-verification.md`](../latest-verification.md) - the maintained
  verification record.

## Slices

- [`mutation-range-budgets.md`](slices/phase-7-verification-budgets/mutation-range-budgets.md) -
  a written-table-set + rowid-stability + `dbJsonWriteMs: 0` gate per new narrow
  `mutationPath`, asserting each route writes only the tables the audit names.
- [`latest-verification-log.md`](slices/phase-7-verification-budgets/latest-verification-log.md) -
  the maintenance rule for [`../latest-verification.md`](../latest-verification.md):
  replace (not append) on each full or focused run.

## Exit Criteria

- Every narrow `mutationPath` introduced in Phases 2-4 has a review gate with
  `dbJsonWriteMs: 0` and a written-table-set assertion. Met — enforced by
  `commandMutationBudget.test.ts`, which also covers `targeted-assembly` and the
  reference `targeted-character-selection` path.
- Every narrowed route/family has an explicit range or rowid-stability budget;
  remaining gaps are recorded before Phase 7 is marked complete. Met — the
  per-family `command*Range` tests carry the exact written-table + rowid-stability
  assertions; no gaps remain. The known broad-by-design floors (`hydrated` /
  `message-free` Tier-5 routes, `targeted-assembly`'s chat-var fallback) are
  documented in their gates, not silently loose.
- [`../latest-verification.md`](../latest-verification.md) records the latest full
  or focused run; the gate set is the same across phases. Met — refreshed for the
  Phase 7 run.

## Validation

- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/commandMetrics.test.ts`
- `pnpm api:test`
- `pnpm client-thinning:audit`
