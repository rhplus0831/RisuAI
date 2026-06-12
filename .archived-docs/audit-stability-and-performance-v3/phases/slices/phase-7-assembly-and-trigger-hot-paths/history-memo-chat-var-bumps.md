# Slice: History Memo Chat-Var Bumps

Phase: [7](../../phase-7-assembly-and-trigger-hot-paths.md). Finding:
L10. Server prompt assembly correctness fix.

## Scope

Fix the history-callback memo generation so same-assembly chat-var writes
invalidate memoized history parsing before later history references render
stale `{{getvar}}` output.

This slice owns `bumpHistoryCallbackMemo` call sites around chat-var writes in
server prompt assembly. It does not change the history parser, variable
expansion semantics, transcript mutation capture, scriptstate persistence, or
memo-key shape outside the generation bump.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L10.
- `src/ts/cbs.ts`: `historyCallbackMemoKey` and
  `parserArgMemoIdentity`.
- `server/fastify/src/prompt/assemble.ts`: `bumpHistoryCallbackMemo`,
  `applyCurrentChatRunVars`, sticky-lorebook `writeChatVar`,
  `renderAndBudget`, and Lua var folding.
- `server/fastify/src/prompt/lorebook.ts`: sticky lorebook `writeChatVar`
  callback path.
- Focused tests:
  `server/fastify/__tests__/assemble.test.ts` and
  `server/fastify/__tests__/serverLoadCostHarness.test.ts`.

## Target Shape

- Bump the history-callback memo generation whenever a same-assembly chat-var
  write changes persisted chat scriptstate, even if no transcript row text
  changed.
- Cover all three un-bumped write folds called out by L10:
  sticky-lorebook `writeChatVar`, the run-var `chatVarDirty` branch in
  `applyCurrentChatRunVars`, and the Lua var fold in `renderAndBudget`.
- Keep existing bumps for transcript mutations. Avoid double-bumping in ways
  that break tests relying on memo hits when there was no variable or
  transcript change.
- Add a stale-var reproduction where two history references straddle a
  chat-var write. The second reference must render the fresh value for
  sticky-lorebook writes, run-var writes, and Lua writes.
- Add a memo-hit proof showing unchanged history references still reuse the
  memo when no transcript or chat-var change occurs.
- Ensure the fix applies before `buildMutationPayload` so the same chat-var
  delta remains persisted exactly as before.
- Register L10 as `DONE` in the v3 gate and flip only the L10 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  implementation change.

## Invariants

- Chat-var persistence deltas remain identical.
- History text changes only for the stale-var edge; unchanged inputs remain
  output-identical.
- Memo hits still occur when neither transcript contents nor chat vars changed.
- Transcript mutation capture continues to decide persisted message
  replacements, not the memo bump.
- Post-generation output-trigger handling is out of scope unless a test proves
  it can hit the same stale history path.

## Done Criteria

- Sticky-lorebook `writeChatVar` bumps the history memo before later history
  references render.
- Run-var chat-var writes bump the history memo even when message text did not
  change.
- Lua var writes folded during `renderAndBudget` bump the history memo.
- A three-path stale-var regression renders fresh values and preserves memo
  hits when nothing changed.
- L10 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
