# Latest Verification

Date: 2026-06-03

This file holds the latest verification result for this workstream. Replace the
latest-run section on each full or focused run; do not append history.

## Latest Run

- Runtime/code commit under test: none. No mutation-range narrowing slice has
  landed. This entry records the pre-implementation baseline.
- Scope: the seed audit [`mutation-range-mismatch.md`](mutation-range-mismatch.md)
  came from a fan-out classifier pass and an adversarial verifier. No route,
  helper, write range, projection, revision, or event behavior has changed. The
  only existing narrow path is `b57df5cd` (`characters/select`).
- Result: not yet run for this workstream — the first implementation slice must
  populate the gate set below.

| Command | Result |
| --- | --- |
| `pnpm api:test` | Baseline to capture on the first slice. |
| `pnpm test` | Baseline to capture on the first slice. |
| `pnpm client-thinning:audit` | Baseline to capture on the first slice. |
| `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose` | Baseline to capture on the first slice (before-state of the over-broad `mutationPath`s). |
| `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/projection.test.ts` | Baseline to capture on the first slice. |
| Type check (`tsconfig.client-lib.json` build, then `server/fastify/tsconfig.json --noEmit`) | Baseline to capture on the first slice. |

## Notes

- The audit's review gate for the reference fix is `mutationPath:
  'targeted-character-selection'` with `dbJsonWriteMs: 0`. Each new narrow path
  must add an equivalent `commandMetrics.test.ts` gate and a `tableRowidsById`
  rowid-stability assertion before it counts as verified.
- The mutation-range metric baseline (Phase 0) is the artifact that turns "the
  write narrowed" into a checkable claim: it records the set of tables a route
  physically writes, so the before/after table set is the proof, not just timing.
- Until a slice lands, treat the current `main`/`fastify` test baseline (the
  green state recorded in the project memory index) as the reference, and re-run
  the gate set above as the first act of the first slice.
