# Slice: Memory Summary Fetch Sharing

Phase: [8](../../phase-8-server-bounds.md). Finding: L20. Runtime change.
Status: done on 2026-06-06 KST.

## Scope

Avoid parsing the same memory summaries twice during generation by sharing one
summary metadata read between orphan cleanup and memory selection.

This slice does not own memory job retention, embedding chunk bounds, selection
ranking changes, or the existing zero-summary guard from v1-L16.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L20.
- `server/fastify/src/memoryRepository.ts`: `cleanupOrphanedMemory`, summary
  row readers, metadata parsing, and v1-L16 guard tests.
- `server/fastify/src/prompt/assemble.ts`: generation assembly sequence around
  cleanup and selection.
- `server/fastify/src/prompt/memoryAdapter.ts` and selection services if the
  shared summary snapshot needs a typed adapter boundary.
- Existing focused suites:
  `server/fastify/__tests__/memoryRepository.test.ts`,
  `server/fastify/__tests__/assemble.test.ts`,
  `server/fastify/__tests__/promptMemoryAdapter.test.ts`,
  `server/fastify/__tests__/memorySelectionService.test.ts`, and
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`.

## Target Shape

- Add a repository or adapter API that can read summaries once for a
  chat/model/generation path and pass that parsed snapshot to both orphan
  cleanup and selection.
- Keep the zero-summary fast path from v1-L16: chats with no summaries should
  still avoid opening a write transaction.
- Ensure cleanup uses the same parsed metadata shape as selection, or prove via
  tests that the two paths agree on orphaned/kept summaries.
- Avoid adding a broad persisted database load or full message-corpus parse.
- Add a counting/load-cost test proving one summary parse/read for the normal
  "summaries exist but none orphaned" generation path.
- Preserve selected memory prompt output and cleanup results.
- Register L20 as `DONE` in the v2 gate with focused tests, and flip its row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Orphan cleanup must delete the same summaries and chunks as before.
- Memory selection ranking, token budgeting, diagnostics, and prompt rows remain
  unchanged for the same database state.
- No write transaction is opened when there is nothing to delete.
- The shared snapshot must not become stale across unrelated mutations.

## Done Criteria

- A generation path with summaries parses/loads summary metadata once for
  cleanup plus selection.
- Cleanup behavior and selected memory output are byte-for-byte or
  structure-equivalent to the previous behavior.
- Load-cost tests fail if the path regresses to duplicate summary parsing.
- The L20 v2 gate entry points at real focused tests and the risk-map row is
  `DONE`.

## Proof

- Runtime:
  `server/fastify/src/memoryRepository.ts` exposes a chat-scoped parsed
  summary snapshot and a cleanup path that returns the retained snapshot after
  deletes; `server/fastify/src/prompt/assemble.ts` loads that snapshot once,
  uses it for orphan cleanup and Hypa planning, then passes it through
  `prompt/memoryAdapter.ts` into `memorySelectionService.ts` for model-filtered
  selection.
- Regression proof:
  `server/fastify/__tests__/serverLoadCostHarness.test.ts` /
  `L20: prompt memory cleanup and selection share one summary payload read`;
  `server/fastify/__tests__/memoryRepository.test.ts` /
  `L20: cleans orphaned rows from a shared summary snapshot and returns retained summaries`;
  `server/fastify/__tests__/assemble.test.ts` /
  `L20: selects retained memory from the shared post-cleanup summary snapshot`;
  `server/fastify/__tests__/memorySelectionService.test.ts` /
  `L20: selects from a shared summary snapshot without rereading summaries`;
  `server/fastify/__tests__/promptMemoryAdapter.test.ts` /
  `L20: passes a shared summary snapshot through to the selection facade`.
- Gate proof:
  `src/ts/__tests__/fixCompletenessGateV2.test.ts` registers L20 `DONE` with
  the focused proof paths above;
  `.archived-docs/performance-and-stability/stability-audits/v2/active-risk-analysis.md`
  marks L20 `DONE`.
- Validation:
  `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/memoryRepository.test.ts server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/promptMemoryAdapter.test.ts server/fastify/__tests__/memorySelectionService.test.ts server/fastify/__tests__/serverLoadCostHarness.test.ts`
  passed, 5 files / 135 tests.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/memoryRepository.test.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/promptMemoryAdapter.test.ts \
  server/fastify/__tests__/memorySelectionService.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
