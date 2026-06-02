# Next Steps

Date: 2026-06-03

Read this when choosing the next batch. Prefer one narrow write path or one proof
batch. Avoid broad cleanup passes.

## Start Point

- Start with the per-tier findings in
  [`active-risk-analysis.md`](active-risk-analysis.md) and the route table in
  [`mutation-range-mismatch.md`](mutation-range-mismatch.md).
- Before editing runtime code, add a compact scope to the active slice: routes
  and line numbers, target SQLite tables, settings co-write condition,
  revision/event behavior, normalization-drop decision, and proof command.
- The Phase 0 writer kit, the `TARGETED_MUTATION_PATHS` vehicles, and the
  review-gate template (`__tests__/helpers/commandMetricGates.ts` /
  `rowStability.ts`) all exist now; a Tier write slice imports them rather than
  rebuilding them. The floor sweep (Phase 1) is the only tier that needs no Phase
  0 helper.

## Current Best Targets

Phase 0 (baseline foundations), Phase 1 (the message-free floor sweep,
`208e538a`), and Phase 2 (settings + plugin storage, `56ddd865`) are implemented.
Recommended order from here:

1. Phase 3 single-row paths, landing the matching Phase 5 character/chat
   projection branches in the same batches.
2. Phase 4 collection families, plugins first (projection already narrow),
   then the rest with their pointer-settings co-writes and the Phase 5
   projection-field bug co-fixes.
3. Phase 5 `lorebook` resource split once a global-lorebook command is
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

1. Phase 0 baseline metric + gates and writer kit + targeted paths — done.
2. Phase 1 floor — done (`208e538a`).
3. Phase 2 settings + plugin storage — done (`56ddd865`).
4. Phase 3 (next, + its projection branches), then Phase 4 (plugins first) with
   Phase 5 co-fixes.
5. Phase 5 `lorebook` split.
6. Refresh [`latest-verification.md`](latest-verification.md) after each tier's
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
