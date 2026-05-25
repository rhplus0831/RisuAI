# Phase 8 - Hypa V3 Memory Server-Side

Date: 2026-05-25

Status: in progress. Completed through
**8-8 - live chunk-planning hook**.
Next slice: **8-9 - Phase 8 closeout**.

## Goal

Move Hypa V3 chunking, embedding fetch, and summary generation off the
browser and into the server as an async job queue. Phase 7's prompt
assembly reads summaries from server tables instead of browser
localForage.

Policy note: there are no actual Fastify users yet. Do not write
compatibility migrations for intermediate Fastify database shapes; update
the current schema and import paths directly.

## Preconditions

- Phase 0 closed: Supa, Hypa V2, and Hanurai are gone.
- Phase 2 closed: server has the data-dir / repository foundation.
- Phase 7 closed: prompt assembly is server-side and needs ready memory
  summaries to read.

## Current State

Detailed closeouts live in [`../phases-completed/`](../phases-completed/).
This active file keeps only the pickup-relevant summary.

Completed highlights:

- **8-1 - Memory storage foundation:** migration runner, memory tables,
  typed repositories / row mappers, and legacy `hypaV3Data`
  import/backfill.
- **8-2 - Memory queue and progress:** queue state machine, worker
  lifecycle, retry/backoff/cancel/boot recovery, progress event contract,
  and job routes.
- **8-3 - Memory planning:** Hypa V3 settings, standard planner contract,
  orphan cleanup, pure summary-window planner, and chunk/job bridge.
- **8-4a through 8-4d - Summary generation foundation:** summary prompt
  builder, API-backed summary adapter, single-job summarize handler,
  summarize batch rate limiting, and ordered writes.
- **8-5a - Embedding provider contract:** server-side embedding model
  resolver, OpenAI-compatible/custom endpoint adapter, response
  normalization, vector dimension validation, and typed provider errors.
- **8-5b - Embed job handler + vector persistence:** embed jobs resolve
  providers through the 8-5a contract, fetch standard embeddings, persist
  one vector row per chunk/model, preserve queue retry/cancel behavior,
  batch by chat, and apply embedding concurrency/rate settings.
- **8-5c - Voyage contextual embeddings:** `voyageContext3` resolves
  server-side Voyage credentials, batches ordered chunk texts into
  contextual document groups, calls Voyage contextualized embeddings, and
  persists vectors in `memory_embeddings` with `group_id` /
  `group_index`.
- **8-5d - Pure similarity ranking:** supplied query vectors, memory
  summaries/chunks, and flat embedding rows are ranked through defensive
  cosine similarity with deterministic tie-breaking and diagnostics for
  invalid or incomplete inputs.
- **8-5e - Pure memory budget allocator:** supplied summaries and ranked
  similar rows are selected across important, recent, similar, and
  deterministic-random buckets with duplicate suppression and
  budget-pressure diagnostics.

Carry-forward decisions from completed work:

- Use the standard Hypa V3 planner. The experimental planner remains
  deferred or dropped.
- Orphan cleanup deletes orphaned summary rows, then parent chunks, then
  cascades embeddings by `chunk_id`.
- `summarizeOnce` wraps `runOpenAI` directly; route-handler-shaped
  generation helpers are not called from job handlers.
- Local MLC / ONNX / WebLLM summary runtimes stay out of server scope.
- Summary writes converge on `{ chatId, chunkId, model }` for idempotent
  re-runs.
- Summary batches stage successful provider results, then commit in
  planned order only until the first failed, cancelled, or empty result.
  Later staged successes remain uncommitted and are handed back to queue
  retry/fail primitives.
- Embedding provider calls are supported for API-backed OpenAI embedding
  aliases, custom embedding endpoints, and Voyage contextual document
  embeddings. Browser-local transformers / WebGPU models remain out of
  server scope.
- Standard embedding writes are idempotent by `{ chatId, chunkId,
model }` with empty `group_id` / `group_index`; contextual Voyage
  writes use the same uniqueness surface and populate group metadata.
- Similarity ranking and budget allocation are pure and facade-facing:
  they do not call providers, read or write repositories, enqueue jobs,
  or inspect prompt assembly state.
- The 8-5f memory selection facade composes repository reads, similarity
  ranking, and budget allocation. It accepts supplied query vectors and
  budget inputs, returns selected summaries plus repository/ranking/
  allocation diagnostics, and remains read-only.
- The 8-6a prompt memory adapter contract wraps that facade for prompt
  assembly with explicit enable/disable rules, selected-summary bucket
  passthrough, selection diagnostics, missing-memory hints for future
  follow-up jobs, and no-hot-path-work diagnostics. It remains read-only
  and does not assemble prompt rows.
- The 8-6b row assembly helper consumes `selectPromptMemory` results,
  preserves selected-summary order, trims summary text, skips empty
  summaries, emits canonical `role: "system"` / `memo: "hypaMemory"`
  rows, and reports separate row-assembly diagnostics while preserving
  selection diagnostics.
- The 8-6c assembler integration resolves active Hypa V3 settings,
  selects ready summaries through the prompt-memory adapter, assembles
  canonical `hypaMemory` rows, and feeds them into the existing
  memory-card split. Template memory cards consume rows through
  `memories`; no-memory-card paths wrap them inline as previous
  conversation. Query vectors are supplied by the assembler dependency
  boundary, and the integration remains read-only.
- The 8-6d follow-up enqueue slice converts prompt-memory missing-memory
  diagnostics into best-effort queue writes after row assembly.
  `summarize` jobs are enqueued for chunks missing summaries and `embed`
  jobs are enqueued for chunks missing embeddings. Prompt assembly
  remains non-blocking, and enqueue failures are captured in
  `promptMemoryFollowUpDiagnostics`. Orphan summaries with missing chunks
  are skipped because current diagnostics do not contain enough source
  window data to recreate missing chunks safely; `chunk` is still a queue
  kind without a concrete production handler.
- The 8-7a read-route slice exposes auth-gated chunk and summary reads
  through `GET /api/v1/memory/chunks/:chatId` and
  `GET /api/v1/memory/summaries/:chatId?model=...`. The routes return
  current repository row shapes in `{ chunks }` / `{ summaries }`
  envelopes, preserve repository ordering, and validate empty model
  filters.
- The 8-7b browser adapter slice exposes a gated Fastify memory client
  from `src/ts/process/request/serverMemory.ts`. It authenticates with
  `getNodeServerProxyAuth`, preserves `{ chunks }`, `{ summaries }`,
  `{ jobs }`, and `{ job }` envelopes directly, and hides route details
  from later browser progress/list UI slices.
- The 8-7c browser progress listener slice adds a gated
  `applyServerHypaV3Progress` mapper to the same adapter. Server-backed
  chat terminal side effects with `kind: 'hypav3_progress'` now update
  `hypaV3ProgressStore` using only the existing browser progress fields:
  `open`, `miniMsg`, `msg`, and `subMsg`.
- The 8-7d memory job list/cancel UI slice adds a Fastify plus
  server-prompt-assembly gated job panel to the Hypa V3 modal. It lists
  pending/running jobs through the browser adapter, cancels jobs through
  `cancelServerMemoryJob`, refreshes on open/chat changes and
  periodically, and disables legacy local bulk/per-summary edit controls
  while server-backed memory mode is active.
- The 8-7e fixture parity slice pins the server-backed `hypav3-memory`
  prompt path, Fastify `hypav3_progress` browser side effect, memory
  job list/cancel envelopes, and missing-memory follow-up diagnostics.
- The 8-8 live chunk-planning hook runs the standard Hypa V3 planner from
  prompt assembly before prompt-memory selection. It creates deterministic
  chunks, enqueues idempotent `summarize` jobs, records
  `promptMemoryChunkPlanningDiagnostics`, and keeps planner validation
  failures non-blocking. The default `chunk` job handler remains a no-op
  by design; live chunk planning uses the prompt assembly context rather
  than a queued chunk snapshot.
- Current open gap: Phase 8 closeout needs full verification and handoff
  cleanup before Phase 9 client thinning starts.

## Scope

### Schema

Current schema includes:

- `memory_chunks(id, chat_id, message_id, range_start_seq,
range_end_seq, text, status, created_at, updated_at)`
- `memory_summaries(id, chat_id, chunk_id, model, text,
metadata_json, tokens, created_at)`
- `memory_embeddings(id, chat_id, chunk_id, model, vector_blob, dim,
group_id, group_index, created_at)`
- `memory_jobs(id, chat_id, kind, status, payload_json, error,
attempt_count, max_attempts, next_run_at, created_at, updated_at)`

`memory_chunks.text` and `memory_summaries.text` are large and do not
belong in `extension_fields`.

### Job Queue

- Jobs are kinds: `chunk`, `embed`, `summarize`; `chunk` remains
  reserved/no-op after 8-8 because live chunk planning is prompt-assembly
  driven.
- The server runs a single in-process worker over `memory_jobs`.
- Queue transitions emit memory progress events on the existing event
  stream.
- Failures retry up to the queue's max retry count, then mark failed
  without blocking chat.
- Default worker wiring in `server/fastify/src/app.ts` provides real
  batch handlers for `summarize` and `embed`.

### Routes

- `POST /api/v1/memory/jobs` - enqueue a job.
- `GET /api/v1/memory/jobs` - list pending / running jobs.
- `DELETE /api/v1/memory/jobs/:id` - cancel a job.
- `GET /api/v1/memory/chunks/:chatId` - list chunks for a chat.
- `GET /api/v1/memory/summaries/:chatId?model=...` - list summaries for
  a chat, optionally filtered by model.

### Prompt-Assembly Hook

`prompt/memory.ts` from Phase 7 stops calling the browser's
`hypaMemoryV3` and reads selected `memory_summaries` rows for the active
chat. `prompt/assemble.ts` now runs the live chunk-planning hook before
prompt-memory selection, so fresh chat history can create
`memory_chunks` and enqueue `summarize` jobs after crossing the Hypa V3
window. Summarization and embedding provider calls remain out of the
prompt request hot path; missing summaries and embeddings for existing
chunks queue follow-up work best-effort.

### Browser Changes

The server-backed send path bypasses local `hypaMemoryV3` prompt
assembly. The legacy browser module remains for local/Tauri mode and
local Hypa V3 editing outside server-backed mode. Server Hypa V3
progress is surfaced through terminal side effects and mapped into the
existing browser progress store.

## Remaining Slice Plan

- **8-9 - Phase 8 closeout.** Run the full verification matrix, confirm
  the supported/unsupported memory provider paths below, and flip handoff
  docs to Phase 9 once exit criteria are satisfied.

## Supported Memory Provider Paths

- Summary generation: `subModel` only, when it resolves to an
  API-backed OpenAI-compatible provider (`openai`, `nanogpt`, or
  `openrouter`).
- Standard embeddings: `ada`, `openai3small`, `openai3large`, and
  `custom` endpoints that expose an OpenAI-compatible `/embeddings`
  route.
- Contextual embeddings: `voyageContext3` through Voyage contextualized
  embeddings.
- Unsupported server-side: MiniLM, Nomic, BGE, transformers.js/WebGPU,
  MLC, ONNX, WebLLM, browser-local summary runtimes, bulk re-summary,
  and per-summary metadata edits in server-backed mode.

## Boundaries

- **Do not bring back Supa / Hypa V2 / Hanurai.** Only Hypa V3 survives.
- **Do not introduce a second memory model.** One engine, one schema, one
  set of jobs.
- **Do not run summarization or embedding in the prompt request hot
  path.** Prompt assembly reads ready summaries and queues missing-memory
  follow-up work best-effort.
- **No external job queue.** SQLite plus a single in-process worker is
  enough for current single-user deployments.

## Exit Criteria

- Phase 4 fixtures that exercise Hypa V3 (`hypav3-memory`) run through
  the server-side adapter.
- `pnpm api:test` covers chunk creation, embedding fetch, summary
  generation, retry, and cancel.
- A chat with no memory rows boots, chats, and accumulates summaries over
  time as messages cross the chunk window.
- Imported Hypa V3 data loads into `memory_summaries` on import.
- `pnpm test`, `pnpm check`, `pnpm build`, and `pnpm api:test` are green.

## Reference

- Active runbook: [`../status/next-steps.md`](../status/next-steps.md)
- Completed closeouts: [`../phases-completed/`](../phases-completed/)
- `move-to-fastify` ships a worked memory schema + queue reference.
- `risuai-metatron` has the closest implementation at scale; this
  TypeScript port intentionally omits local MLC / ONNX summary runtimes.
