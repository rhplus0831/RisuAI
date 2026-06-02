# Latest Verification Log

Status: planned. Maintenance rule for the workstream's verification record.

## Source Anchors

- [`../../../latest-verification.md`](../../../latest-verification.md) - the
  single maintained verification record.
- [`../../../next-steps.md`](../../../next-steps.md) - the proof-command set.

## Scope

Keep [`../../../latest-verification.md`](../../../latest-verification.md) as the
single maintained record of the latest full or focused verification run for the
mutation-range narrowing workstream. Replace its "Latest Run" section on each run;
do not append historical runs.

Each run records: the code commit/tier under test, the scope (which routes
narrowed, what did not change), the result, the gate-command table (pass/fail with
counts), and notes (the before/after written-table set for the narrowed routes and
any recorded normalization-drop decisions).

## Implementation Scope

- Source files: `docs/plan/latest-verification.md` (content only).
- The gate set is stable across phases: `pnpm api:test`, `pnpm test`,
  `pnpm client-thinning:audit`, the `RISU_COMMAND_METRIC_SUMMARY` command metric
  run, the focused `commands.test.ts` / `projection.test.ts` runs, and the
  type-check pair.
- Non-scope: per-run analysis belongs in the run notes, not in new files.

## Protocol Behavior

- The verification log is documentation; it changes no runtime behavior.
- A tier is not "implemented" in `status.md` until its run is recorded here with a
  passing gate set including the new mutation-range budget.

## Done When

- The first implementation slice replaces the pre-implementation baseline in
  `latest-verification.md` with a real run.
- Each later tier replaces (not appends to) the "Latest Run" section.

## Validation

- `pnpm api:test`
- `pnpm test`
- `pnpm client-thinning:audit`
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
