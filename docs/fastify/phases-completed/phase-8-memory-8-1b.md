# Phase 8 Memory - 8-1b Closeout

Date: 2026-05-24

## Scope Landed

- Added `server/fastify/src/memoryRepository.ts` with typed repository
  primitives and row mappers for `memory_chunks`,
  `memory_summaries`, `memory_embeddings`, and `memory_jobs`.
- Added Float32 embedding vector encode/decode helpers over SQLite BLOB
  storage, including dimension validation.
- Added job payload JSON serialization / parsing helpers while keeping
  jobs as inert data rows.
- Surfaced SQLite constraint and uniqueness failures as
  `ValidationError`.
- Covered create / read / update primitives, status / model / group
  filtering, uniqueness conflicts, vector validation, payload validation,
  and mapper validation in `memoryRepository.test.ts`.

## Boundaries

- No legacy `hypaV3Data` import/backfill.
- No queue state machine, worker polling, retries, routes, SSE progress,
  provider calls, prompt memory selection, or browser UI.
- `memory_embeddings.group_id` and `group_index` remain preserved for
  later contextual embedding support.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/memoryRepository.test.ts server/fastify/__tests__/db.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

`pnpm test` passed with 639 tests plus 4 skipped. `pnpm api:test`
passed with 909 tests. `pnpm build` passed with existing CSS
`::highlight`, browser externalization, plugin-timing, and chunk-size
warnings.

## Next Pickup

Continue with 8-1c - legacy `hypaV3Data` import/backfill. Use the new
memory repository rather than writing direct SQL where possible, and do
not create embeddings or memory jobs during import.
