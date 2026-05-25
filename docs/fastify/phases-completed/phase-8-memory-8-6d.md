# Phase 8 Memory - 8-6d Closeout

Date: 2026-05-25

## Scope Landed

- Added `prompt/memoryFollowups.ts` as the prompt-facing follow-up
  enqueue helper.
- Extended `AssembleDeps` with `enqueuePromptMemoryFollowUpJob` for
  focused tests and alternate route bindings.
- Stored `promptMemoryFollowUpDiagnostics` on `AssemblyState`.
- Enqueued idempotent `summarize` jobs for chunks reported in
  `chunkIdsMissingSummaries`.
- Enqueued idempotent `embed` jobs for chunks reported in
  `chunkIdsMissingEmbeddings`.
- Kept prompt assembly non-blocking: enqueue failures are recorded in
  diagnostics and do not throw through `fillMemoryAndPostHistory`.
- Exported `buildSummarizeJobId` so follow-up enqueue uses the same
  deterministic summarize job IDs as chunk planning.

## Boundaries

- No schema change was needed.
- No provider-backed query embedding generation landed.
- No summaries, embeddings, or query vectors are generated in the prompt
  request hot path.
- `summaryIdsMissingChunks` is intentionally skipped and recorded in
  diagnostics. The current missing-memory diagnostic only identifies the
  orphan summary; it does not contain the source chat window needed to
  recreate a chunk safely.
- No decorative `chunk` jobs were enqueued. `chunk` is still a valid
  queue kind, but there is no concrete production chunk-job handler yet.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/promptMemoryAdapter.test.ts --config server/fastify/vitest.config.ts
pnpm check
```

Focused 8-6d verification passed with 52 tests, and `pnpm check` was
clean.

The last full baseline remains the 8-6c run: `pnpm test` with 639 tests
plus 4 skipped, `pnpm api:test` with 1039 tests, and `pnpm build` with
the existing CSS `::highlight`, browser externalization, plugin-timing,
and chunk-size warnings.

## Next Pickup

Continue with 8-7a - Chunk + summary read routes. Add auth-gated
`GET /api/v1/memory/chunks/:chatId` and
`GET /api/v1/memory/summaries/:chatId?model=...`, using the current
Fastify schema and repository shapes directly.
