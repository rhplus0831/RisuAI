# Phase 8 - Hypa V3 Memory Server-Side

Date: 2026-05-25

Status: in progress. Completed through **8-5c - Voyage contextual
embeddings**. Next slice: **8-5d - Pure similarity ranking**.

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

Completed through 8-5c:

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

## Scope

### Schema

Current schema includes:

- `memory_chunks(id, chat_id, message_id, range_start_seq,
range_end_seq, text, status, created_at, updated_at)`
- `memory_summaries(id, chat_id, chunk_id, model, text, tokens,
created_at)`
- `memory_embeddings(id, chat_id, chunk_id, model, vector_blob, dim,
group_id, group_index, created_at)`
- `memory_jobs(id, chat_id, kind, status, payload_json, error,
created_at, updated_at)`

`memory_chunks.text` and `memory_summaries.text` are large and do not
belong in `extension_fields`.

### Job Queue

- Jobs are kinds: `chunk`, `embed`, `summarize`.
- The server runs a single in-process worker over `memory_jobs`.
- Queue transitions emit memory progress events on the existing event
  stream.
- Failures retry up to the queue's max retry count, then mark failed
  without blocking chat.

### Routes

- `POST /api/v1/memory/jobs` - enqueue a job.
- `GET /api/v1/memory/jobs` - list pending / running jobs.
- `DELETE /api/v1/memory/jobs/:id` - cancel a job.
- `GET /api/v1/memory/chunks/:chatId` - planned in 8-7a.
- `GET /api/v1/memory/summaries/:chatId?model=...` - planned in 8-7a.

### Prompt-Assembly Hook

`prompt/memory.ts` from Phase 7 stops calling the browser's
`hypaMemoryV3` and reads selected `memory_summaries` rows for the active
chat. Summarization and embedding remain out of the prompt request hot
path; missing memory queues follow-up work best-effort.

### Browser Changes

The browser stops importing `src/ts/process/memory/hypav3.ts` in
server-backed mode once the server adapter is in place. Hypa V3 progress
is surfaced through server events and dispatched into the existing
browser progress store.

## Remaining Slice Plan

- **8-5 - Embeddings and selection.** Build embedding persistence and
  pure ranking/allocation helpers before exposing the prompt-facing
  selection facade.
  - **8-5b - Embed job handler + vector persistence.** Fetch embeddings
    through the provider contract, persist `memory_embeddings`, mark work
    completed or failed, make reruns idempotent, and apply embedding
    request rate/concurrency limits.
  - **8-5d - Pure similarity ranking.** Port deterministic summary
    ranking over supplied summaries, chunks, and vectors. No provider
    calls, DB writes, jobs, or prompt assembly.
  - **8-5e - Pure memory budget allocator.** Port important, recent,
    similar, and random summary selection with deterministic randomness
    for tests.
  - **8-5f - Memory selection service facade.** Combine repository
    reads, ranking, and allocation. Return selected summaries plus
    diagnostics for missing summaries / embeddings.
- **8-6 - Prompt memory integration.** Add the server prompt-memory
  adapter, assemble canonical memory prompt rows, replace the Phase 7
  browser bridge, and queue missing-memory follow-up work.
  - **8-6a - Prompt memory adapter contract.** Define enable/disable
    rules, input context, selected-summary output, diagnostics, and the
    no-hot-path-work guarantee.
  - **8-6b - Summary prompt-row assembly.** Convert selected summaries
    into canonical `memo: "hypaMemory"` prompt rows.
  - **8-6c - Assemble integration.** Replace the Phase 7/browser Hypa V3
    bridge inside the root prompt assembler.
  - **8-6d - Missing-memory follow-up enqueue.** Enqueue idempotent
    `chunk`, `summarize`, and `embed` follow-up jobs best-effort.
- **8-7 - Browser memory surfaces.** Expose read routes, the browser
  adapter, progress UI wiring, job list/cancel controls, and fixture
  parity.
  - **8-7a - Chunk + summary read routes.** Auth-gated
    `GET /api/v1/memory/chunks/:chatId` and
    `GET /api/v1/memory/summaries/:chatId?model=...`.
  - **8-7b - Browser memory API adapter.** Thin server-backed client for
    chunks, summaries, job listing, and cancellation.
  - **8-7c - Browser progress listener.** Wire server memory progress
    into the existing `hypaV3ProgressStore` shape.
  - **8-7d - Memory job list/cancel UI path.** Add minimal pending /
    running job list and cancel controls. Bulk re-summary and per-summary
    metadata edits stay disabled in server-backed mode.
  - **8-7e - `hypav3-memory` fixture parity.** Pin canonical memory prompt
    rows, missing-memory diagnostics, and browser-visible progress /
    list-cancel effects.
- **8-8 - Phase 8 closeout.** Run the full verification matrix, document
  supported model/provider memory paths, and flip handoff docs to Phase 9.

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
