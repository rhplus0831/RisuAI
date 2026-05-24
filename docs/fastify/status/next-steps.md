# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

## Last Done

8-5a added the server-side embedding provider contract. Fastify now has
an embedding model resolver for API-backed OpenAI embedding aliases and
custom embedding endpoints, plus an adapter that posts to
OpenAI-compatible `/embeddings` endpoints, normalizes vectors, preserves
indexed response order, validates dimensions, and returns typed adapter
errors. Browser-local embedding runtimes and Voyage contextual grouping
remain out of server scope for this slice.

## Immediate Pickup

Continue Phase 8 with **8-5b - Embed job handler + vector persistence**.

Expected scope:

- Fetch embeddings for planned `embed` jobs through
  `resolveMemoryEmbeddingModel` and `embedTexts`.
- Persist successful vectors into `memory_embeddings` through the
  existing repository surface.
- Mark embed jobs completed or failed through the memory queue
  primitives, preserving retry/cancel behavior.
- Make reruns idempotent by `{ chatId, chunkId, model }` for standard
  embeddings.
- Apply `embeddingMaxConcurrent` and `embeddingRequestsPerMinute`
  settings when dispatching provider calls.
- Add focused job-handler / worker tests for success, provider failure,
  cancellation, idempotent reruns, and persistence validation.

Out of scope for 8-5b:

- Voyage contextual embedding grouping.
- Similarity ranking and memory budget allocation.
- Prompt assembly reads from memory summaries or embeddings.
- Browser progress UI, browser listeners, and browser list/cancel
  controls.
- Browser-local embedding runtimes.

Implementation notes:

- Use `server/fastify/src/memoryEmbeddingModel.ts` for model/credential
  resolution and `server/fastify/src/memoryEmbeddingAdapter.ts` for the
  upstream provider call.
- The schema already has `memory_embeddings`; 8-5b should write it
  through `createMemoryEmbedding`.
- For non-contextual embeddings, one persisted row per chunk/model is
  expected. Leave `group_id` / `group_index` empty until Voyage grouping
  lands in 8-5c.
- Preserve the no-compatibility-migrations policy: update current
  Fastify shapes directly if the contract needs a tighter shape.

## Queue After 8-5a

1. 8-5c - Voyage contextual embeddings.
2. 8-5d - Pure similarity ranking.

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

Last recorded full baselines after 8-5a: `pnpm check` clean,
`pnpm test` 639 tests plus 4 skipped, `pnpm api:test` 994 tests, and
`pnpm build` passing with existing CSS `::highlight`, browser
externalization, plugin-timing, and chunk-size warnings.

Focused 8-5a verification:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryEmbeddingModel.test.ts server/fastify/__tests__/memoryEmbeddingAdapter.test.ts --config server/fastify/vitest.config.ts
```

## References

- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-8-memory-8-5a.md`](../phases-completed/phase-8-memory-8-5a.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Phase 7 final summary:
  [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
