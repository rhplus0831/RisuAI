# Phase 8 Memory - 8-3b Closeout

Date: 2026-05-24

## Scope Landed

- Added `cleanupOrphanedMemory()` to
  `server/fastify/src/memoryRepository.ts`.
- The cleanup pass accepts `chatId`, the current source chat memos, and
  `preserveOrphanedMemory`.
- Summary metadata is inspected for `chatMemos`; summaries without a
  usable `chatMemos` array are preserved because the server cannot prove
  they are orphaned.
- When cleanup is enabled, summaries whose `chatMemos` are not a subset
  of current chat memos are deleted.
- Parent `memory_chunks` rows for orphaned summaries are deleted in the
  same transaction, and matching `memory_embeddings` rows cascade through
  the existing `chunk_id` foreign key.
- Added repository tests for deleted rows, preserved rows, partially
  matching memo sets, chat scoping, embedding cascade, and idempotency.

## Boundaries

- No summary-window planning changes landed here.
- No memory prompt selection, job enqueueing, provider calls, summary
  prompt construction, embedding generation, browser listeners, or
  browser list/cancel controls landed here.
- The cleanup helper is repository-owned and deterministic so 8-3c/8-3d
  can call it without introducing route or worker behavior.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryRepository.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Focused repository verification passed with 15 tests. `pnpm check` was
clean. `pnpm test` passed with 639 tests plus 4 skipped. `pnpm api:test`
passed with 946 tests. `pnpm build` passed with existing CSS
`::highlight`, browser externalization, plugin-timing, and chunk-size
warnings.

## Next Pickup

Continue with 8-3c - Pure summarization window planner. Port the pure
summarization window behavior from the standard Hypa V3 path, returning
planned windows and token deltas only. Keep DB writes, job enqueueing,
provider calls, prompt construction, embedding, prompt-facing selection,
and browser wiring out of scope.
