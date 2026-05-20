# Phase 8 - Hypa V3 Memory Server-Side

Date: 2026-05-20

## Goal

Move Hypa V3 chunking, embedding fetch, and summary generation off
the browser and into the server as an async job queue. Phase 7's
prompt assembly reads summaries from server tables instead of from
browser localForage.

## Preconditions

- Phase 0 closed (Supa, Hypa V2, Hanurai are already gone).
- Phase 2 closed (server holds the chat schema we extend).
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
