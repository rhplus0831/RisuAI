# Slice: Phase 7 Verification Refresh

Phase: [7](../../phase-7-assembly-and-trigger-hot-paths.md). Depends on
all Phase 7 implementation slices. Proof-only slice.

## Scope

Re-run the Phase 7 proof set after async asset reads, dispatch clone
narrowing, per-assembly invariant hoists, trigger clone narrowing, user regex
bounds, and history memo chat-var bumps land. Record the refreshed results in
[`../../../latest-verification.md`](../../../latest-verification.md).

This slice should not introduce runtime behavior. It may correct
documentation, gate registration, or active-risk status drift discovered
during verification.

## Anchors

- [`../../phase-7-assembly-and-trigger-hot-paths.md`](../../phase-7-assembly-and-trigger-hot-paths.md):
  Phase 7 exit criteria and validation list.
- `docs/plan/latest-verification.md`.
- `docs/plan/active-risk-analysis.md`: L1, L3, L6, L7, L8, L9, L10, K3,
  and any landed riding notes for I5 or I7.
- `src/ts/__tests__/fixCompletenessGateV3.test.ts`: Phase 7 `DONE`
  registrations and proof text once Phase 0 has authored the v3 gate.
- Focused proof suites from the implementation slices:
  asset async read/count tests, dispatch clone-count tests, restoration
  payload identity tests, asset table/lorebook allocation probes, trigger
  clone-count and isolation tests, regex bound tests, and stale chat-var memo
  regressions.
- TypeScript workflow from `AGENTS.md`.

## Target Shape

- Add a dated Phase 7 run-log entry to `latest-verification.md`.
- Record exact commands run, pass/fail outcomes, and any focused diagnostic
  reruns used to explain failures.
- Confirm the v3 gate has L1, L3, L6, L7, L8, L9, L10, and K3 as `DONE` with
  concrete test paths and test names.
- Confirm `active-risk-analysis.md` matches those statuses and has no
  unrelated Phase 7+ status flips.
- If I5 or I7 landed as riding items, make sure proof text names the coverage
  and the active-risk table wording follows the established informational-item
  convention.
- Confirm the parent Phase 7 exit criteria can be checked against recorded
  proof:
  zero sync asset reads, zero default dispatch/restoration clones, invariant
  allocation hoists, trigger clone narrowing per phase, bounded regex failure,
  fresh history chat-var rendering, and unchanged outputs.
- If a proof is skipped or fails, keep that visible in
  `latest-verification.md` and leave the matching parent exit criterion
  incomplete.

## Invariants

- Do not silently replace a failing full command with a narrower focused
  command. Narrow commands may be added as diagnostics, but the full result
  stays recorded.
- Run the client-lib TypeScript build before the strict server check.
- Do not mark an implementation finding `DONE` unless its slice landed with a
  focused regression proof.
- Preserve earlier verification entries; append a new Phase 7 entry.
- Do not edit runtime code in this verification slice.

## Done Criteria

- `latest-verification.md` has a fresh Phase 7 verification entry with
  command outcomes.
- Phase 7 parent exit criteria are satisfied or the remaining gaps are
  explicitly listed.
- The v3 gate and active-risk table agree for L1, L3, L6, L7, L8, L9, L10,
  and K3.
- Focused server prompt, lorebook, trigger, load-cost, gate, API, and
  TypeScript checks are green or failures are documented as blockers.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/lorebook.test.ts \
  server/fastify/__tests__/triggers.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
