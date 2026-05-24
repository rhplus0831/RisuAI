# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

## Last Done

8-5d added a pure `memorySimilarityRanking` helper. It ranks supplied
`MemorySummary` rows through their `MemoryChunk` and persisted
`MemoryEmbedding` rows, computes defensive cosine similarity for
standard and contextual Voyage vectors from the flat embedding shape,
skips invalid or incomplete inputs with diagnostics, and applies stable
tie-breaking for allocator-ready output. It does not call providers, read
or write SQLite, enqueue jobs, or touch prompt assembly.

## Immediate Pickup

Continue Phase 8 with **8-5e - Pure memory budget allocator**.

Expected scope:

- Port the pure memory summary allocator for important, recent, similar,
  and random selections over supplied summary records.
- Accept ranked similar summaries from `memorySimilarityRanking` as an
  input instead of recomputing provider embeddings or database reads.
- Keep allocation pure: no provider calls, database writes, jobs, prompt
  assembly reads, or repository calls.
- Preserve the Hypa V3 ratio semantics for recent/similar/random memory
  while making randomness deterministic for tests.
- Return selected summaries plus enough diagnostics for the 8-5f facade
  to report budget pressure and missing allocation categories.
- Add focused tests for budget exhaustion, important-memory priority,
  recent/similar/random ratio behavior, deterministic randomness,
  duplicate suppression, and empty inputs.

Out of scope for 8-5e:

- Similarity scoring or embedding provider dispatch.
- Prompt assembly reads from memory summaries or embeddings.
- Browser progress UI, browser listeners, and browser list/cancel
  controls.
- Provider dispatch, embedding generation, database reads/writes, jobs,
  and browser-local embedding runtimes.

Implementation notes:

- Start with a new pure module under `server/fastify/src/` rather than
  adding allocation logic to the repository or job handler.
- Reuse `memoryRepository` types and the `RankedMemorySummary` output
  from `memorySimilarityRanking` where helpful, but keep the allocator
  independent from SQLite.
- Treat token costs as supplied inputs or a caller-provided pure callback;
  do not make prompt assembly responsible for allocator internals in this
  slice.
- Keep duplicate suppression deterministic when a summary appears in more
  than one category.
- Preserve the no-compatibility-migrations policy: update current
  Fastify shapes directly if the contract needs a tighter shape.

## Queue After 8-5d

1. 8-5f - Memory selection service facade.
2. 8-6a - Prompt memory adapter contract.

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

Last recorded full baselines after 8-5d: `pnpm check` clean,
`pnpm test` 639 tests plus 4 skipped, `pnpm api:test` 1017 tests, and
`pnpm build` passing with existing CSS `::highlight`, browser
externalization, plugin-timing, and chunk-size warnings.

Focused 8-5d verification:

```bash
pnpm exec vitest run server/fastify/__tests__/memorySimilarityRanking.test.ts --config server/fastify/vitest.config.ts
```

## References

- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-8-memory-8-5d.md`](../phases-completed/phase-8-memory-8-5d.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Phase 7 final summary:
  [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
