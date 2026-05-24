# Phase 8 - Hypa V3 Memory Server-Side

Date: 2026-05-24

## Goal

Move Hypa V3 chunking, embedding fetch, and summary generation off
the browser and into the server as an async job queue. Phase 7's
prompt assembly reads summaries from server tables instead of from
browser localForage.

Status: in progress. Next slice: **8-1b - Memory repositories + row
mappers**.

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

Policy note: there are no actual Fastify users yet. Do not write
compatibility migrations for intermediate Fastify database shapes; update
the current schema and import paths directly.

- **8-1 — Memory storage foundation.** Establish the SQL tables,
  repository surface, and legacy import/backfill path before worker or
  provider behavior lands. Close the sub-slices below in order.
  - **8-1a — Memory schema foundation.** Split this slice into two so
    the table DDL doesn't get bundled with framework work:
    - **8-1a-i — Migration runner + version bump.** Closed on
      2026-05-24. `CURRENT_SCHEMA_VERSION = 1`, `openDatabase()` applies
      ordered migrations through `applyMigrations(db, fromVersion)`, the
      existing `schema_version` row remains the source of truth, and
      tests cover version bumping, idempotent reapply, and newer-schema
      rejection, plus the missing singleton-row guard. No memory tables
      landed in this slice.
    - **8-1a-ii — Memory tables in the current schema.** Closed on
      2026-05-24. `CURRENT_SCHEMA_VERSION = 2`, fresh opens create
      `memory_chunks`, `memory_summaries`, `memory_embeddings`, and
      `memory_jobs` with indexes, check constraints, and `chunk_id`
      cascade behavior. `memory_embeddings` includes nullable
      `group_id` and `group_index` for the later contextual embedding
      adapter. No repository, import backfill, route, worker, provider,
      or browser behavior landed in this slice.
  - **8-1b — Memory repositories + row mappers.** Add typed repository
    methods and JSON / blob mappers for chunks, summaries, embeddings,
    and jobs. Cover create / read / update primitives, vector
    encode/decode, status filtering, and validation errors. Jobs remain
    inert data rows; no polling, retries, SSE, or handler dispatch yet.
  - **8-1c — Legacy `hypaV3Data` import/backfill.** Add the
    memory-specific mapper for existing chat `hypaV3Data` during JSON
    import and any one-time boot backfill. Preserve summary text,
    `chatMemos`, important/category/tag metadata where possible, define
    how legacy summaries map to chunk rows, and keep bootstrap stitching
    compatible until Phase 9 removes whole-database reads. Do not create
    embeddings or summary jobs during import.
- **8-2 — Memory queue and progress.** Build queue mechanics, worker
  lifecycle, progress events, and routes before provider-backed memory
  handlers. Close the sub-slices below in order.
  - **8-2a — Memory job queue state machine.** Add enqueue, list,
    claim, complete, fail, and cancel primitives over `memory_jobs`.
    Cover payload validation, status filtering, legal transitions, and
    deterministic repository tests. No timers, worker loop, retries,
    SSE, or handler dispatch yet.
  - **8-2b — Worker lifecycle + stub dispatch.** Add the single
    in-process worker, Fastify startup/shutdown integration, polling,
    one-at-a-time job claiming, and kind-based handler dispatch. Keep
    `chunk`, `embed`, and `summarize` handlers as no-op stubs that only
    prove lifecycle behavior.
  - **8-2c — Retry, backoff, cancel, and boot recovery.** Add attempt
    tracking, exponential backoff scheduling, max-retry failure
    persistence, cancellation for pending/running jobs, and startup
    handling for abandoned `running` jobs. Keep provider calls and real
    memory mutations out of scope.
  - **8-2d — Memory progress event contract.** Decide and implement the
    smallest server event surface for memory progress: `memory.job`
    events for queue state and Phase-7-compatible `hypav3_progress`
    side effects where chat generation needs them. Do not wire browser
    UI listeners here; that remains 8-7.
  - **8-2e — Memory job routes.** Wire the auth-gated backend job API:
    `POST /api/v1/memory/jobs`, `GET /api/v1/memory/jobs`, and
    `DELETE /api/v1/memory/jobs/:id`. Route tests cover enqueue, list,
    cancel, validation failures, and unauthorized access. Browser list /
    cancel UI paths remain 8-7.
- **8-3 — Memory planning.** Port the Hypa V3 settings, cleanup,
  planner, and chunk/job bridge as pure or deterministic services
  before any provider calls. Close the sub-slices below in order.
  - **8-3a — Hypa V3 settings + planner contract.** Port the Hypa V3
    preset defaults, settings normalization, and ratio validation.
    **Lock the planner choice up front: port the standard planner
    (`hypaMemoryV3Main` at `src/ts/process/memory/hypav3.ts:873-1494`,
    selected by default when `HypaV3Settings.useExperimentalImpl === false`
    per the dispatcher at `hypav3.ts:113-162`).** The experimental
    planner (`hypaMemoryV3MainExp` at `hypav3.ts:164-871`, ~700 LOC)
    has divergent empty-memory token reservation and is deferred to
    Phase 9 or dropped; settings carrying `useExperimentalImpl: true`
    fall back to the standard path with a one-time migration warning.
    Define the pure planner input/output contract, including token
    deltas, planned windows, errors, and skipped-message reasons. Do
    not mutate memory rows or enqueue jobs yet.
  - **8-3b — Orphan cleanup.** Implement the server-side cleanup pass
    for summaries/chunks whose source chat memos no longer exist.
    Respect `preserveOrphanedMemory`, keep cleanup idempotent, and cover
    repository tests for deleted, preserved, and partially matching
    memo sets. Do not perform summary-window planning in this slice.
    **Cascade behavior locked 2026-05-24 (option b):** when a summary is
    orphaned, delete its `memory_summaries` row, then its parent
    `memory_chunks` row, then cascade-delete the matching
    `memory_embeddings` rows (by `chunk_id` FK). Re-summarizing the same
    range later re-creates chunk + re-embeds — accepted trade-off in
    exchange for a clean data model. SPA `cleanOrphanedSummary`
    (`src/ts/process/memory/hypav3.ts:1519-1534`) only filters
    in-memory summaries because it has no separate chunk store; the
    server cascade is the schema-aware equivalent.
  - **8-3c — Pure summarization window planner.** Port start-index
    selection, memory-token reservation, summary-window selection,
    skip rules for examples/new/empty/user messages, target-token
    stopping, and "cannot summarize further" guards. Return planned
    windows and token deltas only; no DB writes, provider calls, or job
    enqueueing.
  - **8-3d — Chunk/job planning bridge.** Convert pure planner windows
    into deterministic `memory_chunks` rows and planned `summarize` jobs.
    Cover idempotency, payload shape, status transitions expected by
    8-4, and batching behavior. Still do not call providers.
- **8-4 — Summary generation.** Bring over prompt construction,
  provider-backed summary calls, job handling, and legacy ordering/rate
  limits after the planner bridge exists. Close the sub-slices below in
  order.
  - **8-4a — Summary prompt builder.** Port the pure summary prompt
    construction path: message sanitization, default summarize /
    re-summarize prompts, `{{slot}}` replacement, ChatML parsing
    fallback, provider-neutral options, and `<think>` / `<Thoughts>`
    output scrubbing. Cover with deterministic unit tests. Do not call
    providers, mutate memory rows, update jobs, or apply rate limiting
    in this slice.
  - **8-4b — Provider-backed summary adapter.** Add the server-side
    non-streaming summary provider adapter for the supported API-backed
    summarization model path. **Approach locked 2026-05-24 (option a):**
    extract a `summarizeOnce(messages, opts)` helper that wraps
    `runOpenAI` (imported at `server/fastify/src/routes/generation.ts:34`)
    directly. **Do not** call or refactor `handleOpenAICompatibleBuffered`
    (`generation.ts:1215-1251`) — it is route-handler-shaped (takes
    `req`/`reply` and writes to the reply) and cannot be invoked from
    inside a job handler. `runOpenAI` already returns
    `{ type, result, model, aborted? }`; the helper normalizes that into
    `{ text, tokens } | { error }`, swallows the aborted case as an
    error, and resolves the provider variant the same way the route
    does. The SPA's `requestChatData` (`src/ts/process/request/request.ts`,
    SPA summarize call site `hypav3.ts:1590-1598`) is **not** ported —
    it is provider-routing logic, not a reusable adapter. **Local MLC /
    ONNX / WebLLM summary runtimes stay out of scope** (matches the
    "no local runtimes server-side" boundary). Do not wire the memory
    worker or write summaries yet.
  - **8-4c — Summarize job handler.** Wire the `summarize` memory job
    handler against the planned chunks from 8-3d: load the chunk
    payload, build the prompt, call the summary adapter, persist
    `memory_summaries`, mark chunks summarized, and complete or fail the
    job through the 8-2 queue primitives. Cover idempotent re-runs,
    missing chunk / chat rows, and summary write validation. Keep
    embedding, similarity selection, prompt assembly reads, and browser
    progress UI out of scope.
  - **8-4d — Summary rate limiting and ordered writes.** Apply
    `summarizationRequestsPerMinute`, `summarizationMaxConcurrent`, and
    fail-fast cancellation semantics to batches of `summarize` jobs.
    Preserve the legacy consecutive-success write behavior: summaries
    are committed in planned order only until the first failed / empty
    result, with later successes left uncommitted for retry. Persist
    failure details through the queue state machine and cover ordering,
    cancellation, and retry handoff tests.
- **8-5 — Embeddings and selection.** Build embedding persistence and
  pure ranking/allocation helpers before exposing the prompt-facing
  selection facade. Close the sub-slices below in order.
  - **8-5a — Embedding provider contract.** Define the server-side
    embedding model contract, supported model ids, credential lookup,
    request/response normalization, vector dimension validation, and
    typed error shape. Support API-backed OpenAI-compatible embeddings
    and custom embedding endpoints; explicitly keep browser-local
    transformers / WebGPU runtimes out of scope. Do not persist vectors,
    dispatch jobs, rank summaries, or alter prompt assembly in this
    slice. **Row shape locked 2026-05-24 (option a + grouping
    metadata):** `memory_embeddings` stores one row per chunk-level
    vector (flat) with two extra columns `group_id TEXT NULL` and
    `group_index INTEGER NULL`. Standard providers (OpenAI / Cohere /
    custom) write rows with `group_id = NULL` and one row per chunk.
    Voyage `voyage-context-3` (`src/ts/process/memory/contextualEmbedding.ts`)
    contextualizes chunks against their group siblings but still returns
    one vector per chunk; the 8-5c adapter writes one flat row per
    chunk with `group_id = <document-group-uuid>` and `group_index =
<0-based position within group>` so the original grouping can be
    reconstructed for query-time context. Selection in 8-5d treats rows
    with `group_id` and rows without identically (dot-product over the
    vector blob); the metadata is preserved for future re-querying or
    cache-key derivation but is not load-bearing for 8-5d/e.
  - **8-5b — Embed job handler + vector persistence.** Wire the `embed`
    memory job handler through the 8-2 queue primitives: load planned
    chunks, fetch embeddings through the provider contract, store
    `memory_embeddings`, mark work completed or failed, and make reruns
    idempotent when vectors already exist. Apply
    `embeddingRequestsPerMinute` and `embeddingMaxConcurrent`; keep
    contextual Voyage grouping, similarity ranking, and prompt selection
    out of scope.
  - **8-5c — Voyage contextual embeddings.** Add the optional
    `voyage-context-3` path if the setting is still present: grouped
    document embeddings, query embeddings, batching limits, context hash
    / cache-key behavior, Voyage API errors, and model-specific tests.
    This slice must still write through the same `memory_embeddings`
    repository surface from 8-5b. Do not add selection logic here.
  - **8-5d — Pure similarity ranking.** Port the deterministic ranking
    helpers for memory selection: summary text chunking by
    `summaryChunkSeparator`, query construction from the recent chat
    window, weighted multi-query scoring, dot-product similarity,
    chunk-to-summary parent ranking, and empty / missing-vector handling.
    This is a pure service over supplied summaries, chunks, and vectors;
    no provider calls, DB writes, job enqueueing, or prompt assembly.
  - **8-5e — Pure memory budget allocator.** Port the budget-sensitive
    summary selection order: important summaries first, then recent,
    similar, and random summaries with unused-token carryover and token
    accounting against `availableMemoryTokens`. Inject deterministic
    randomness for tests. This slice returns selected summary ids and
    accounting details only; it does not fetch embeddings or read from
    the prompt assembler.
  - **8-5f — Memory selection service facade.** Combine repository reads,
    the 8-5d ranker, and the 8-5e allocator into the server service that
    8-6a / 8-6b can call. Return selected summaries plus diagnostics for
    missing summaries / embeddings so 8-6d can enqueue follow-up jobs
    without doing summarization or embedding work in the prompt request
    hot path.
- **8-6 — Prompt memory integration.** Add the adapter seam, assemble
  canonical prompt rows, replace the Phase 7 browser bridge, and queue
  missing-memory follow-up work. Close the sub-slices below in order.
  - **8-6a — Prompt memory adapter contract.** Add the server-side
    `prompt/memory.ts` adapter seam that Phase 7's memory bridge can
    call. Define Hypa V3 enable/disable rules, input context,
    selected-summary output, diagnostics, and the no-hot-path-work
    guarantee. Cover disabled memory, empty selection, and facade errors
    with deterministic tests. Do not read SQL directly, mutate prompt
    slots, or enqueue jobs in this slice.
  - **8-6b — Summary prompt-row assembly.** Use the 8-5f memory selection
    facade through the adapter contract and convert selected summaries
    into the canonical memory rows expected by the template renderer:
    `memo: "hypaMemory"` rows containing the `<Past Events Summary>`
    payload. Preserve prompt-template `memory` card behavior versus the
    non-template previous-conversation wrapper. Do not enqueue follow-up
    work or alter queue state yet.
  - **8-6c — Assemble integration.** Replace the Phase 7/browser Hypa V3
    bridge inside the root prompt assembler with the 8-6 adapter.
    Preserve the existing memory-window accounting, `memoryCardUsed`
    handling, `memories[]` split, non-memory removable marking,
    `lastChat` promotion, and final-render inputs. The prompt request
    still only reads ready summaries; missing memory is tolerated.
  - **8-6d — Missing-memory follow-up enqueue.** Use the diagnostics from
    8-5f / 8-6a to enqueue idempotent `chunk`, `summarize`, and `embed`
    follow-up jobs when the prompt request discovers missing summaries or
    embeddings. The enqueue path must be best-effort, deduplicated, and
    non-blocking for prompt assembly. Do not run summarization or
    embedding calls in the prompt request hot path.
- **8-7 — Browser memory surfaces.** Expose read routes, the browser
  adapter, progress UI wiring, job list/cancel controls, and fixture
  parity after server prompt integration exists. Close the sub-slices
  below in order.
  - **8-7a — Chunk + summary read routes.** Wire the auth-gated backend
    read API: `GET /api/v1/memory/chunks/:chatId` and
    `GET /api/v1/memory/summaries/:chatId?model=...`. Route tests cover
    auth, chat scoping, model filtering, empty chats, validation failures,
    and the response shape expected by the browser adapter. Do not add
    browser fetch code, UI wiring, job mutation routes, or fixture parity
    in this slice.
  - **8-7b — Browser memory API adapter.** Add the thin server-backed
    browser client for memory chunks, summaries, job listing, and job
    cancellation. Reuse the existing Fastify auth helper pattern,
    normalize API failures into typed adapter errors, and cover the
    adapter with fetch-mocked tests. Do not change the Hypa V3 modal UI,
    progress listener, prompt assembly, or local-browser/Tauri behavior
    here.
  - **8-7c — Browser progress listener.** Wire Phase-7-compatible
    `side_effect: { kind: "hypav3_progress" }` payloads and any queue
    progress signal exposed by 8-2d into the existing
    `hypaV3ProgressStore` shape (`open`, `miniMsg`, `msg`, `subMsg`).
    Cover open/update/close behavior and malformed payload tolerance. Do
    not add list/cancel controls or change the memory read APIs in this
    slice.
  - **8-7d — Memory job list/cancel UI path.** Add the minimal browser UI
    path for viewing pending/running memory jobs and cancelling them
    through the 8-7b adapter. Cover loading, empty, error, and cancel
    states. **Scope locked 2026-05-24 (option c, deferral):** in
    server-backed mode, hide or disable the entire bulk-re-summary
    surface in `HypaV3Modal.svelte` (the `resummarizeBulkSelected` /
    `applyBulkResummary` / `rerollBulkResummary` / `cancelBulkResummary`
    / `toggleBulkResummaryTranslation` flow at lines 207-340 and the
    `BulkResummaryResult` / `BulkEditActions` sub-components). Per-summary
    metadata edits (category/tag, important toggle, delete/reset, manual
    text editing, translation) also stay disabled in server-backed mode
    because they would write directly to the local `hypaV3Data` and
    diverge from the server's `memory_summaries` table. Tauri / local
    mode keeps the full modal as-is. Memory write routes (preview-only
    re-summarize jobs, per-summary metadata commands, manual text
    overrides) are deferred to a follow-up phase and explicitly out of
    Phase 8 scope.
  - **8-7e — `hypav3-memory` fixture parity.** Add server-backed fixture
    coverage for `hypav3-memory` once the read routes, browser adapter,
    progress listener, and Phase 8 prompt-memory integration are in
    place. Pin the canonical `memo: "hypaMemory"` prompt row,
    memory-card versus previous-conversation wrapping, tolerated
    missing-memory diagnostics, and the observable progress/list-cancel
    side effects needed by the browser. Do not broaden provider coverage
    or reopen Phase 8 memory selection algorithms here.
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
