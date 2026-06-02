# Next Steps

Date: 2026-06-03

Read this when choosing the next mutation-range narrowing batch. The best next
task is one coherent narrow write path (one tier slice) or one proof batch, not a
broad cleanup pass.

## Start Point

- Start with the per-tier findings in
  [`active-risk-analysis.md`](active-risk-analysis.md) and the route table in
  [`../mutation-range-mismatch.md`](mutation-range-mismatch.md).
- Before editing runtime code, write a compact scope in the active slice: the
  routes and their line numbers, the SQLite tables the write should touch, the
  settings co-write condition, the revision/event behavior, the
  normalization-drop decision, and the proof command.
- Confirm the Phase 0 writer kit and review-gate template exist before starting
  any Tier write slice; the floor sweep (Phase 1) is the only tier that needs no
  Phase 0 helper.

## Current Best Targets

Nothing is implemented yet. The recommended ordering:

1. **Phase 0 baseline + gates first.** Land the mutation-range metric baseline
   ([`mutation-range-metric-and-gates.md`](phases/slices/phase-0-baseline-foundations/mutation-range-metric-and-gates.md))
   so the before-state of the 71 over-broad routes is recorded, plus the
   rowid-stability / `dbJsonWriteMs: 0` review-gate template.
2. **Phase 1 mechanical floor.** The
   [`hydrated-to-message-free-sweep.md`](phases/slices/phase-1-message-free-floor/hydrated-to-message-free-sweep.md)
   is the safe, helper-free first commit across ~62 routes. It depends on no
   Phase 0 helper and can land before the writer kit is finished.
3. **Phase 0 writer kit + targeted paths.** Build
   [`targeted-writer-kit.md`](phases/slices/phase-0-baseline-foundations/targeted-writer-kit.md)
   and
   [`targeted-mutation-paths.md`](phases/slices/phase-0-baseline-foundations/targeted-mutation-paths.md);
   Phases 2-5 depend on them.
4. **Phase 2 settings + plugin storage.** Highest amplification, cleanest fix;
   projection already safe or sprawling-by-design.
5. **Phase 3 single-row paths**, landing the matching Phase 5 character/chat
   projection branches in the same batches.
6. **Phase 4 collection families**, plugins first (projection already narrow),
   then the rest with their pointer-settings co-writes and the Phase 5
   projection-field bug co-fixes.
7. **Phase 5 `lorebook` resource split** once a global-lorebook command is
   narrowed.

## Not First

- Do not narrow any Tier write before the Phase 0 writer kit and review gates
  exist; a narrow path without a rowid-stability test cannot prove it stopped
  rewriting unrelated rows.
- Do not narrow a Tier-5 route (2273, 2310, 2390, 2495, 2617, 3673, 4171, 4205)
  below the `message-free` floor before its normalization pass or message
  dependency is scoped; that is Phase 6's explicit blocker.
- Do not drop a global normalization repair without recording it as an accepted
  validate-only decision (Prerequisite 2) in the slice.
- Do not narrow a projection resource without first narrowing the write it
  serves, or you leave the refresh shipping fields the write no longer changes.

## Selection Order

1. Phase 0 baseline metric + gates, then the Phase 1 floor.
2. Phase 0 writer kit + targeted mutation paths.
3. Phase 2, then Phase 3 (+ its projection branches), then Phase 4 (plugins
   first) with Phase 5 co-fixes.
4. Phase 5 `lorebook` split.
5. Refresh [`latest-verification.md`](latest-verification.md) after each tier's
   focused and full run.

## Proof Commands

Use the smallest focused command first, then broaden only when the change
touches shared protocol behavior.

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test -- server/fastify/__tests__/commandMetrics.test.ts`
- `pnpm api:test -- server/fastify/__tests__/projection.test.ts`
- `pnpm api:test -- server/fastify/__tests__/db.test.ts`
- `pnpm test -- src/lib/Others/projectionGuard.test.ts`
- `pnpm test -- src/ts/server/projection.test.ts`
- `pnpm client-thinning:audit`
- `pnpm api:test`
- `pnpm test`
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
