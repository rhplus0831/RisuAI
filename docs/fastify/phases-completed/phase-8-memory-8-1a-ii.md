# Phase 8 8-1a-ii - Memory Tables

Date: 2026-05-24

## Result

Closed. Fastify now has the current Hypa V3 memory table schema in
`risu.db`.

Landed:

- `CURRENT_SCHEMA_VERSION` advanced from 1 to 2.
- `server/fastify/src/db.ts` creates `memory_chunks`,
  `memory_summaries`, `memory_embeddings`, and `memory_jobs`.
- Fresh database opens create the current memory tables directly; the
  ordered migration registry also contains version 2 so the runner stays
  contiguous in tests and development databases.
- `memory_chunks` has status and range checks plus chat/range/status
  indexes.
- `memory_summaries` and `memory_embeddings` cascade on `chunk_id` and
  enforce one row per chunk/model.
- `memory_embeddings` includes nullable `group_id` and `group_index`
  columns for the later contextual embedding adapter.
- `memory_jobs` stores inert queue rows with kind/status checks,
  `json_valid(payload_json)`, and status/created-time indexes.
- Bootstrap and health route expectations now report schema version 2.
- `server/fastify/__tests__/db.test.ts` covers fresh table creation,
  upgrade/reopen idempotence, status/kind/payload constraints, and
  summary/embedding cascade deletion.

Out of scope and still not landed:

- Memory repositories and row mappers.
- Legacy `hypaV3Data` import/backfill.
- Queue state-machine behavior, workers, routes, provider calls, SSE
  progress, prompt memory selection, and browser UI.

## Verification

Focused verification passed:

```bash
pnpm exec vitest run server/fastify/__tests__/db.test.ts server/fastify/__tests__/bootstrap.test.ts server/fastify/__tests__/smoke.test.ts --config server/fastify/vitest.config.ts
```

Result: 3 files passed, 14 tests passed.

Full closeout verification also passed:

- `pnpm check` - clean.
- `pnpm test` - 639 passed, 4 skipped.
- `pnpm api:test` - 902 passed.
- `pnpm build` - passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Next

Pick up **8-1b - Memory repositories + row mappers**. Add typed create /
read / update methods and validation over the tables from this slice.
Jobs remain inert data rows until 8-2a.
