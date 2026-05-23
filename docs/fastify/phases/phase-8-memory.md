# Phase 8 - Hypa V3 Memory Server-Side

Date: 2026-05-23

## Goal

Move Hypa V3 chunking, embedding fetch, and summary generation off
the browser and into the server as an async job queue. Phase 7's
prompt assembly reads summaries from server tables instead of from
browser localForage.

## Preconditions

- Phase 0 closed (Supa, Hypa V2, Hanurai are already gone).
- Phase 2 closed (server has the data-dir/repository foundation;
  chat-specific SQL shape still lands with the extraction that needs
  it).
- Phase 7 closed (prompt assembly is server-side and needs
  somewhere to read summaries from).

## Scope

### Schema

Migration adds:

- `memory_chunks(id, chat_id, message_id, range_start_seq,
range_end_seq, text, status, created_at, updated_at)` -
  one row per chunk, status is `pending | summarized | failed`.
- `memory_summaries(id, chat_id, chunk_id, model, text, tokens,
created_at)` - the summary text for a chunk; one row per
  model used for that chunk.
- `memory_embeddings(id, chat_id, chunk_id, model, vector_blob,
dim, created_at)` - the embedding for similarity queries.
- `memory_jobs(id, chat_id, kind, status, payload_json, error,
created_at, updated_at)` - the async queue.

`memory_chunks.text` and `memory_summaries.text` are large; they
do not belong in `extension_fields`.

### Job queue

- Jobs are kinds: `chunk`, `embed`, `summarize`.
- The server runs a single in-process worker that polls
  `memory_jobs` ordered by created_at.
- Each transition (`pending` -> `running` -> `completed | failed`)
  emits an SSE event `{ type: "memory.job", chatId, jobId,
status }` on the existing event stream.
- Failures retry up to 3 times with exponential backoff. After
  that the job is marked failed; the chat keeps working without
  the missing memory.

### Routes

- `GET /api/v1/memory/chunks/:chatId` - list chunks + statuses.
- `GET /api/v1/memory/summaries/:chatId?model=...` - read
  summaries for a chat.
- `POST /api/v1/memory/jobs` - enqueue a job (chunk / embed /
  summarize).
- `GET /api/v1/memory/jobs` - list pending / running jobs.
- `DELETE /api/v1/memory/jobs/:id` - cancel.

### Prompt-assembly hook

`prompt/memory.ts` from Phase 7 stops calling the browser's
`hypaMemoryV3` and reads `memory_summaries` rows for the active
chat. The same selection algorithm (similarity-based + bounded
recent-window) lives in the server.

### Browser changes

The browser stops importing `src/ts/process/memory/hypav3.ts`
once the server adapter is in place. Hypa V3's progress side
effects (the user-visible "summarizing..." banner) are emitted by
the server as `side_effect: { kind: "hypav3_progress" }` events;
the browser dispatches them as it does today.

## Difficulty re-check

The old phase label is too broad to treat as one implementation
slice. The browser source is `src/ts/process/memory/hypav3.ts`
(1907 LOC), plus `hypamemoryv2.ts` (490 LOC),
`taskRateLimiter.ts` (179 LOC), and `contextualEmbedding.ts`
(132 LOC). That surface includes two Hypa V3 implementations,
summary planning, rate-limited provider calls, embedding and
contextual-embedding adapters, similarity ranking, progress UI
events, legacy serialized memory data, and budget-sensitive prompt
selection. Phase 8 should therefore land as small server-owned
slices:

- **8-1 — Memory schema + repositories.** Add the migrations,
  repository methods, and JSON mappers for chunks, summaries,
  embeddings, and jobs. Include import/backfill mappers for existing
  `hypaV3Data`, but do not start workers yet.
- **8-2 — Job queue + progress events.** Implement the SQLite-backed
  queue, single in-process worker, transition/retry/cancel rules,
  and `memory.job` SSE / `hypav3_progress` side-effect emission.
  Keep job handlers as stubs.
- **8-3 — Summarization planner.** Port settings normalization,
  orphan cleanup, summary-window selection, "cannot summarize
  further" guards, and chunk batching. Return planned jobs and token
  deltas without calling providers.
- **8-4 — Summary generation worker.** Add the provider-backed
  summarization calls, prompt construction, rate limiting, failure
  persistence, and consecutive-success write behavior. Local
  MLC/ONNX summary runtimes stay out of scope.
- **8-5 — Embedding + similarity worker.** Add embedding fetch,
  vector storage, contextual Voyage `voyage-context-3` support if
  still configured, ranked chunk-to-summary selection, and the
  recent/similar/random/important budget allocation.
- **8-6 — Prompt memory adapter.** Replace the Phase 7/browser memory
  bridge with server reads from `memory_summaries`, assemble the
  `<Past Events Summary>` prompt row, and queue follow-up work when
  summaries or embeddings are missing. Do not run summarization in
  the prompt request hot path.
- **8-7 — Routes + browser adapter.** Wire the memory routes, browser
  progress listener, list/cancel UI paths, and fixture coverage for
  `hypav3-memory`.
- **8-8 — Phase 8 closeout.** Run the full verification matrix,
  document what exact model/provider memory paths are supported, and
  flip handoff docs to Phase 9.

## Boundaries

- **Do not bring back Supa / Hypa V2 / Hanurai.** They were
  removed in Phase 0. Persisted databases that set
  `supaMemory: true` read as "Hypa V3 enabled" or "memory off"
  depending on context. The current client still uses the
  `supaMemory` field as the per-chat Hypa V3 enable flag until the
  server schema gives that setting a clearer name.
- **Do not introduce a second memory model.** One engine, one
  schema, one set of jobs.
- **Do not run summarization in the request hot path.** The
  prompt assembly reads from `memory_summaries`; if a summary is
  not ready, the prompt is assembled without it and a follow-up
  job is queued.
- **No external job queue (Redis, BullMQ, etc.).** SQLite + a
  single worker is enough for single-user deployments. Revisit
  if multi-user lands; that is out of this roadmap.

## Exit criteria

- Phase 4 fixtures that exercise Hypa V3 (`hypav3-memory`) run
  through the server-side adapter.
- `pnpm api:test` covers chunk creation, embedding fetch, summary
  generation, retry, cancel.
- A chat that had no memory rows boots, chats, and accumulates
  summaries over time as messages cross the chunk window.
- A chat imported with existing Hypa V3 data loads its summaries
  into `memory_summaries` on import (the import path lives in
  Phase 2; this phase adds the memory-specific mapper).
- `pnpm test`, `pnpm check`, `pnpm build`, `pnpm api:test` green.

## Reference

- `move-to-fastify` ships `server/fastify/src/memory.ts` (644
  LOC) - the schema + job-queue scaffolding. The roadmap shape
  matches that work; we use it as a reference for table layout.
- `risuai-metatron`'s `chat_generation/hypa_v3.py` (1876 LOC),
  `local_embedding_runtimes.py`, `local_summary_runtimes.py` are
  the closest implementations at scale. The TypeScript port is
  intentionally smaller - we do not run local MLC / ONNX models
  server-side; embeddings + summaries come from the configured
  provider's API.
