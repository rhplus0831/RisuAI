# Phase 8 Memory - 8-1c Closeout

Date: 2026-05-24

## Scope Landed

- Added `server/fastify/src/memoryLegacyImport.ts` for legacy
  `hypaV3Data` import/backfill.
- JSON import now replaces current SQLite memory rows from legacy
  summaries, matching whole-database import semantics.
- Fastify startup now performs an idempotent boot backfill from existing
  `db.json` data.
- Legacy summaries map to one summarized `memory_chunks` row plus one
  `memory_summaries` row using deterministic ids and the
  `legacy-hypav3` model marker.
- Chunk ranges are derived from `summary.chatMemos` matched against
  message `chatId` values; unresolved legacy summaries fall back to a
  stable high sequence range and preserve the summary text.
- Added nullable `memory_summaries.metadata_json` in the current schema
  and repository mapper so legacy `chatMemos`, important/category/tag
  metadata survive the import.
- Covered direct backfill idempotency, import replacement, boot
  backfill, and the no-embeddings/no-jobs import boundary in
  `memoryLegacyImport.test.ts`.

## Boundaries

- No memory job queue state machine.
- No worker polling, retries, routes, SSE progress, provider calls,
  prompt memory selection, or browser UI.
- Import/backfill does not create `memory_embeddings` or `memory_jobs`.
- Generic `applyImport` remains generic; only the JSON import route
  performs legacy memory replacement. Prompt-variable persistence and
  generation mutations that call `applyImport` do not rewrite memory
  rows.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryLegacyImport.test.ts server/fastify/__tests__/memoryRepository.test.ts server/fastify/__tests__/db.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm exec vitest run server/fastify/__tests__/memoryLegacyImport.test.ts --config server/fastify/vitest.config.ts
```

`pnpm test` passed with 639 tests plus 4 skipped. `pnpm api:test`
passed with 912 tests. `pnpm build` passed with existing CSS
`::highlight`, browser externalization, plugin-timing, and chunk-size
warnings.

## Next Pickup

Continue with 8-2a - memory job queue state machine. Add enqueue, list,
claim, complete, fail, and cancel primitives over `memory_jobs` with
deterministic repository tests. Keep timers, worker lifecycle, retries,
SSE, route wiring, provider calls, and memory mutation handlers out of
8-2a.
