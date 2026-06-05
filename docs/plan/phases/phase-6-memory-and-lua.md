# Phase 6: Memory & Lua

Status: COMPLETE. M7, L16, L17, L18, L19, L21 DONE (`ca798c01`, one batch).

Goal: make memory work bounded and fair, skip empty orphan cleanup writes, reuse
a scoped loader, and add Lua execution budgeting / safe engine reuse.

Findings: M7, L16, L17, L18, L19, L21.

## Source Anchors

- [`../audit-stability-and-performance.md`](../audit-stability-and-performance.md) -
  M7, L16, L17, L18, L19, L21.
- `server/fastify/src/memoryEmbedJobHandler.ts` (bounded claim loop,
  `planContextualSubBatches`, scoped `loadDatabase`),
  `server/fastify/src/memorySummarizeJobHandler.ts` (bounded claim loop, scoped
  `loadDatabase`), `server/fastify/src/memoryWorker.ts`
  (`MEMORY_JOB_BATCH_MAX_JOBS`, `claimNextJobFairly`),
  `server/fastify/src/memoryRepository.ts` (`cleanupOrphanedMemory` pre-checks,
  `listPendingMemoryJobChatIds`), `server/fastify/src/repository.ts`
  (`loadPersistedDatabaseForMemoryJob`).
- `server/fastify/src/prompt/luaRuntime.ts` (`LuaExecBudget`,
  `acquirePreparedEngine`/`refillLuaEnginePoolWhenIdle`, static `LUA_PRELUDE`),
  `server/fastify/src/prompt/assemble.ts` (`luaExecBudget` threading).

## Slices

- [`memory-and-lua.md`](slices/phase-6-memory-and-lua/memory-and-lua.md) - full
  batch, DONE (`ca798c01`):
  - M7: the embed/summarize batch handlers drain at most
    `MEMORY_JOB_BATCH_MAX_JOBS` (32) jobs per tick, and the `voyageContext3`
    contextual request is sliced into token-aware sub-batches (~12k-token
    budget at ~4 chars/token; oversized chunks travel alone; unresolvable jobs
    isolated), each executed and committed independently; `groupId` stays
    consistent per sub-batch.
  - L16: `cleanupOrphanedMemory` exits before the summary metadata re-parse
    when the chat has no summaries (id-only EXISTS probe) and opens no
    `BEGIN IMMEDIATE` when nothing is orphaned.
  - L17: the worker claims round-robin across pending chats
    (least-recently-served first; never-served chats keep FIFO order), so one
    chat's long backlog cannot starve other chats.
  - L18: the handlers' default loader is `loadPersistedDatabaseForMemoryJob`
    (settings row + `hypa_v3_presets` table + id-only character/chat stubs);
    uninitialized/pre-extraction states keep the broad fallback.
  - L19: `runServerLua` charges each run's wall clock against a shared
    `LuaExecBudget` (per assembly, threaded through every hook seam); a
    constrained run gets `min(execTimeoutMs, remaining)` and an exhausted
    budget short-circuits before any engine boots (~30s aggregate default).
  - L21: the static prelude pre-runs on pooled engines with the host-fn
    surface declared once and the per-call state bound via a binder; each call
    still gets an engine of its own and closes it (isolation by
    construction). Every engine boot — background refill *and* a run's fresh
    boot (empty pool or custom limit) — serializes behind a shared boot gate
    and starts only while no run is in flight, with the run counted active
    atomically with its engine claim; engine boots during a pending Lua
    continuation crash wasmoon (completion-audit closeout).

## Landed Shape Notes

- M7 splits by approximate token size (`ceil(chars/4)`), not job count; the
  budget is a test seam (`contextualSubBatchTokenBudget`).
- L16 gates the transaction on the cheap orphan pre-check (EXISTS probe + the
  in-memory orphan filter).
- L21 pooling is safe because pooled engines have never run user code and are
  discarded after exactly one call; only the boot + prelude compile moves off
  the hot path. The prelude and user code now load as two chunks — the only
  observable deltas are error-message chunk names/line offsets and that user
  top-level code can no longer see the wrapper's internal locals.
- L21 fresh boots park behind active runs (completion-audit closeout): a run
  that cannot be served from the pool waits for `activeLuaRuns` to drain, then
  holds the boot gate while it boots, so no boot ever overlaps a pending
  `:await()` continuation. The wait is bounded by the in-flight runs' exec
  limits; sustained pooled traffic could in principle delay a parked
  fresh-booter, which is acceptable on this single-user host.

## Exit Criteria

- [x] M7: a large first-pass embed run is sliced into bounded sub-batches; one
      oversized sub-batch failing does not fail unrelated chunks (test the split +
      independent commit).
- [x] L16: orphan cleanup opens no write transaction when nothing is orphaned.
- [x] L17: a long batch for one chat does not block other chats' memory jobs
      indefinitely (fairness test).
- [x] L18: memory batches reuse a scoped loader; no extra full `loadPersisted`
      per batch.
- [x] L19: a runaway Lua hook hits an aggregate budget instead of stalling
      assembly indefinitely.
- [x] L21: the wasmoon engine/prelude is reused or cached without weakening
      per-call isolation; output identical.
- [x] Gates registered in Phase 8; memory + Lua tests + audit + TypeScript checks
      green.

## Validation

- `pnpm api:test -- server/fastify/__tests__/memory*.test.ts` (M7, L16, L17, L18).
- `pnpm api:test -- server/fastify/__tests__/luaRuntime*.test.ts` (L19, L21).
- `pnpm api:test`, both TypeScript checks. See
  [`../latest-verification.md`](../latest-verification.md).
