# Phase 7: Verification Budgets

Status: partially implemented / ongoing. The shared metric gates exist for the
targeted paths introduced through Phase 4; the open work is per-route budget
completeness and keeping the verification log current.

Goal: keep narrow writes narrow. Generalize the reference fix's
`dbJsonWriteMs: 0` metric gate and `tableRowidsById` rowid-stability assertion
into maintained per-route budgets. Keep the verification log current.

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
  `dbJsonWriteMs: 0` and a written-table-set assertion.
- Every narrowed route/family has an explicit range or rowid-stability budget;
  remaining gaps are recorded before Phase 7 is marked complete.
- [`../latest-verification.md`](../latest-verification.md) records the latest full
  or focused run; the gate set is the same across phases.

## Validation

- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/commandMetrics.test.ts`
- `pnpm api:test`
- `pnpm client-thinning:audit`
