# Slice: Message Diff Append Fast Path

Phase: [2](../../phase-2-server-corpus-ring-2.md). Finding: L14. Depends on
the v2 gate being present. Runtime change.

## Scope

Make active-message transcript persistence avoid re-stringifying the unchanged
prefix when the desired transcript is a pure append. Delete, truncate, edit,
and replacement paths should keep their existing semantics.

This slice does not own generation finalization read narrowing, message-store
schema changes, alternate-row behavior, or client transcript mutation logic.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L14.
- `server/fastify/src/messageStore.ts`: `replaceActiveChatMessages`,
  `applyChatMessageDiff`, `stableEqual`, `getChatMessages`.
- `server/fastify/src/routes/generationChat.ts`: caller around
  `submitTranscriptChanged`.
- Existing focused tests:
  `server/fastify/__tests__/messageStore.test.ts`,
  `server/fastify/__tests__/generation.chat.test.ts`,
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`.

## Target Shape

- Add an append fast path before the generic prefix-diff loop. Acceptable
  shapes include:
  - compare persisted row fingerprints/serialized JSON so unchanged prefix rows
    are not re-stringified; or
  - route proven append-only callers through an explicit helper that inserts
    only the new tail rows.
- Do not assume arbitrary `replaceActiveChatMessages(base, next)` calls are
  append-only unless the caller proves it. The generic edit/delete/truncate
  path must still find the first changed index correctly.
- Keep persisted rows byte-identical. New rows should be written with the same
  `uid`, `role`, `data`, `disabled`, `json`, `seq`, and `alternate` values as
  before.
- Preserve alternate rows: active-row deletes must not remove reroll
  alternates, and append inserts must use `alternate = 0`.
- Add performance/load coverage that proves appending one message to an
  N-message chat performs O(1) prefix comparisons/stringifies, while edit and
  truncate tests still exercise the generic diff path.
- Register L14 as `DONE` in the v2 gate with focused behavior and cost tests,
  and flip the L14 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in
  the same commit.

## Invariants

- Identical arrays still produce no writes.
- Edits at position `k` still delete active rows with `seq >= k` and reinsert
  the desired tail.
- Truncation and deletion behavior must remain unchanged.
- The fast path must not skip validation of newly inserted messages.

## Done Criteria

- Message-store tests prove byte-identical rows for append, edit, truncate,
  delete, unchanged, and alternate-preservation cases.
- Cost tests fail if a one-message append stringifies or deeply compares every
  existing prefix row.
- The v2 gate and active-risk row mark L14 `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/messageStore.test.ts \
  server/fastify/__tests__/generation.chat.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
