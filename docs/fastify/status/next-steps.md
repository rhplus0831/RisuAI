# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

## Last Done

8-5b added the server-side embed job handler and vector persistence.
Fastify now claims `embed` jobs, resolves provider settings through the
8-5a embedding contract, dispatches provider requests under
`embeddingMaxConcurrent` / `embeddingRequestsPerMinute`, writes
non-contextual vectors to `memory_embeddings`, and treats reruns as
idempotent by `{ chatId, chunkId, model }`. Worker batch dispatch now
supports embed batches as well as summarize batches.

## Immediate Pickup

Continue Phase 8 with **8-5c - Voyage contextual embeddings**.

Expected scope:

- Extend the 8-5b embedding path for `voyageContext3` without changing
  the flat `memory_embeddings` repository surface.
- Resolve Voyage credentials/settings explicitly in the server-side
  embedding model contract.
- Group contextual input and persist each returned vector with
  `group_id` / `group_index` populated.
- Preserve existing standard embedding behavior and idempotence for
  non-contextual models.
- Add focused tests for contextual grouping, ordered persistence,
  provider failures, retry/cancel behavior, and standard-model
  regressions.

Out of scope for 8-5c:

- Similarity ranking and memory budget allocation.
- Prompt assembly reads from memory summaries or embeddings.
- Browser progress UI, browser listeners, and browser list/cancel
  controls.
- Browser-local embedding runtimes.

Implementation notes:

- Start from `server/fastify/src/memoryEmbedJobHandler.ts`; standard
  embeddings already write one row per chunk/model with empty
  `group_id` / `group_index`.
- Use `server/fastify/src/memoryEmbeddingModel.ts` for model/credential
  resolution and keep unsupported browser-local runtimes out of server
  scope.
- Keep 8-5c writes behind `createMemoryEmbedding`; do not introduce a
  parallel contextual embedding table.
- Preserve the no-compatibility-migrations policy: update current
  Fastify shapes directly if the contract needs a tighter shape.

## Queue After 8-5b

1. 8-5d - Pure similarity ranking.
2. 8-5e - Pure memory budget allocator.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for server-side
  string flattening.

## Verification

Run the relevant focused tests while implementing, then before closing a
slice run:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after 8-5b: `pnpm check` clean,
`pnpm test` 639 tests plus 4 skipped, `pnpm api:test` 1004 tests, and
`pnpm build` passing with existing CSS `::highlight`, browser
externalization, plugin-timing, and chunk-size warnings.

Focused 8-5b verification:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryEmbedJobHandler.test.ts server/fastify/__tests__/memoryWorker.test.ts --config server/fastify/vitest.config.ts
```

## References

- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-8-memory-8-5b.md`](../phases-completed/phase-8-memory-8-5b.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Phase 7 final summary:
  [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
