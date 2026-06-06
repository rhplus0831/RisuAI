# Slice: Prefix Token Memo

Phase: [3](../../phase-3-memory-subsystem.md). Finding: L15. Runtime
performance change.

## Scope

Memoize token counts for the immutable already-summarized Hypa V3 prefix so
repeated memory-enabled sends do not re-run tiktoken over the same summarized
history rows.

This slice does not change which windows are summarized, which prompt rows are
selected, or how summary rows are budgeted. The per-window tokenization that
only fires while creating new summary windows is out of scope unless it can
reuse the same helper without changing behavior.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L15.
- `server/fastify/src/memoryPlanner.ts`: `planStandardHypaV3Memory`,
  `determineStartIndex`, and `sumChatTokens(chats.slice(0, startIndex), ...)`.
- `server/fastify/src/prompt/assemble.ts`: `planPromptMemoryChunksForAssembly`
  and the `tokenizeChat` callback supplied to the planner.
- `server/fastify/src/prompt/tokens.ts`: `tokenize`, `tokenizeChat`, and
  encoder cache.
- `server/fastify/src/prompt/scripts.ts`: `PreparedScript` memo pattern for a
  small, identity-aware cache with explicit invalidation inputs.
- Focused tests:
  `server/fastify/__tests__/memoryPlanner.test.ts` and
  `server/fastify/__tests__/generation.chat.test.ts`.

## Target Shape

- Add a small per-row token memo for Hypa V3 planner tokenization. A WeakMap is
  acceptable only if the repeated-send test proves row identity is stable on
  the live path; otherwise use a content-keyed memo.
- Include all token-affecting inputs in the cache key or invalidation guard:
  encoding, `TokenizeChatOptions`, role, content, name, counted thoughts, and
  any row identity fields used for fast equality.
- Wire the memo through the `tokenizeChat` callback used by
  `planStandardHypaV3Memory` during prompt-memory chunk planning.
- Add a focused count probe around raw tokenization. The proof should run two
  memory-enabled sends or planner passes with an unchanged summarized prefix
  and show that the second pass performs zero raw encodes for prefix rows.
- Keep a miss test for edited content and changed tokenizer options so stale
  counts cannot survive a prompt-affecting change.
- If the memo is module-level or content-keyed, bound it or scope it to loaded
  database/assembly state so long-running servers cannot accumulate unlimited
  arbitrary text keys.
- Register L15 as `DONE` in `src/ts/__tests__/fixCompletenessGateV3.test.ts`
  and flip only the L15 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  implementation change.

## Invariants

- Planner outputs, warnings, errors, and token deltas remain identical for the
  same inputs.
- Editing any summarized-prefix message content must miss the memo and use the
  new token count.
- Changing model encoding or chat-tokenization options must miss the memo.
- The memo must not hide tokenizer exceptions or validation failures.
- No prompt-memory selection or persistence behavior changes belong to this
  slice.

## Done Criteria

- Repeated sends on an unchanged summarized prefix perform zero raw token
  encodes for the prefix rows after warm-up.
- A changed prefix row or tokenizer option re-encodes and produces the updated
  planner token delta.
- L15 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/memoryPlanner.test.ts \
  server/fastify/__tests__/generation.chat.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
