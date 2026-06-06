# Slice: Phase 3 Verification Refresh

Phase: [3](../../phase-3-memory-subsystem.md). Depends on the M2, L15, L16,
and K1 implementation slices. No runtime change.

## Scope

Re-run the Phase 3 proof set after the memory subsystem slices land, then
record the refreshed results in
[`../../../latest-verification.md`](../../../latest-verification.md).

This is a proof-only slice. It should not change runtime code except for
correcting gate or documentation status drift discovered during verification.

## Anchors

- [`../../phase-3-memory-subsystem.md`](../../phase-3-memory-subsystem.md):
  Phase 3 exit criteria and validation list.
- `docs/plan/latest-verification.md`.
- `docs/plan/active-risk-analysis.md`.
- `src/ts/__tests__/fixCompletenessGateV3.test.ts`.
- Focused proof suites from the implementation slices:
  memory budget/selection, planner token memo, memory job deadlines, embedding
  decode laziness, and memory worker progression.
- TypeScript workflow from `AGENTS.md`.

## Target Shape

- Add a dated Phase 3 run-log entry to `latest-verification.md`.
- Record the exact commands run, their pass/fail outcomes, and any focused
  diagnostic reruns used to explain failures.
- Confirm the v3 gate has M2, L15, L16, and K1 as `DONE` with concrete test
  paths/names.
- Confirm `active-risk-analysis.md` matches those statuses and has no
  unrelated Phase 3 status flips.
- Confirm the parent Phase 3 exit criteria can be checked against recorded
  proof:
  budget-capped summaries, zero repeated prefix re-encodes, bounded memory
  fetch hangs, zero empty-query vector decodes, and green gates.
- If any proof is skipped or fails, keep that visible in
  `latest-verification.md` and leave the matching parent exit criterion
  incomplete.

## Invariants

- Do not silently replace a failing full command with a narrower focused
  command. Narrow commands may be added as diagnostics, but the full result
  stays recorded.
- Run the client-lib TypeScript build before the strict Fastify server check.
- Do not mark an implementation finding `DONE` unless its slice landed with a
  focused regression proof.
- Do not edit runtime code in this verification slice.

## Done Criteria

- `latest-verification.md` has a fresh Phase 3 verification entry with command
  outcomes.
- Phase 3 parent exit criteria are satisfied or the remaining gaps are
  explicitly listed.
- The v3 gate and active-risk table agree for M2, L15, L16, and K1.
- Focused suites, API tests, gate tests, and TypeScript checks are green or
  failures are documented as blockers.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/memoryBudgetAllocator.test.ts \
  server/fastify/__tests__/memorySelectionService.test.ts \
  server/fastify/__tests__/promptMemoryAdapter.test.ts \
  server/fastify/__tests__/memoryPlanner.test.ts \
  server/fastify/__tests__/memoryRepository.test.ts \
  server/fastify/__tests__/memoryWorker.test.ts \
  server/fastify/__tests__/memoryEmbedJobHandler.test.ts \
  server/fastify/__tests__/memorySummarizeJobHandler.test.ts \
  server/fastify/__tests__/memorySimilarityRanking.test.ts \
  server/fastify/__tests__/generation.chat.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
