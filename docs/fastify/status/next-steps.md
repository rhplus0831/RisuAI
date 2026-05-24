# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

## Last Done

8-5c added Voyage contextual embeddings to the server-side embed path.
Fastify now resolves `voyageContext3` through the embedding model
contract with `voyageApiKey`, calls Voyage's contextualized embeddings
endpoint with ordered document groups, and persists each returned vector
through the flat `memory_embeddings` repository surface with populated
`group_id` / `group_index`. Standard OpenAI-compatible/custom embedding
behavior remains unchanged and idempotent.

## Immediate Pickup

Continue Phase 8 with **8-5d - Pure similarity ranking**.

Expected scope:

- Port the deterministic similarity scoring helper over supplied query
  vectors, memory summary/chunk records, and persisted embedding vectors.
- Keep the helper pure: no provider calls, database writes, jobs, or
  prompt assembly reads.
- Support standard embeddings and contextual Voyage embeddings from the
  same flat `memory_embeddings` row shape.
- Define deterministic tie-breaking for equal similarity scores so the
  next allocator slice has stable inputs.
- Add focused tests for cosine scoring, missing-vector handling,
  contextual rows, deterministic ordering, and empty inputs.

Out of scope for 8-5d:

- Memory budget allocation.
- Prompt assembly reads from memory summaries or embeddings.
- Browser progress UI, browser listeners, and browser list/cancel
  controls.
- Provider dispatch, embedding generation, and browser-local embedding
  runtimes.

Implementation notes:

- Start with a new pure module under `server/fastify/src/` rather than
  adding ranking logic to the repository or job handler.
- Use `memoryRepository` types as inputs where helpful, but keep the
  ranking function independent from SQLite.
- Treat embeddings as already-normalized inputs only if the source data
  proves that invariant; otherwise compute cosine similarity defensively
  and skip invalid zero-length vectors.
- Preserve the no-compatibility-migrations policy: update current
  Fastify shapes directly if the contract needs a tighter shape.

## Queue After 8-5c

1. 8-5e - Pure memory budget allocator.
2. 8-5f - Memory selection service facade.

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

Last recorded full baselines after 8-5c: `pnpm check` clean,
`pnpm test` 639 tests plus 4 skipped, `pnpm api:test` 1010 tests, and
`pnpm build` passing with existing CSS `::highlight`, browser
externalization, plugin-timing, and chunk-size warnings.

Focused 8-5c verification:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryEmbeddingModel.test.ts server/fastify/__tests__/memoryEmbeddingAdapter.test.ts server/fastify/__tests__/memoryEmbedJobHandler.test.ts --config server/fastify/vitest.config.ts
```

## References

- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-8-memory-8-5c.md`](../phases-completed/phase-8-memory-8-5c.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Phase 7 final summary:
  [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
