# Memory & Lua

Status: DONE (`ca798c01`, one batch). Phase 6. Bundles memory-worker
bounds/fairness and Lua budget/engine reuse.

## Scope

Bound memory batches, make scheduling fair, skip empty orphan cleanup writes,
reuse a scoped loader, and bound Lua execution.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  M7, L16, L17, L18, L19, L21.
- `server/fastify/src/memoryEmbedJobHandler.ts` (bounded claim loop,
  `planContextualSubBatches`, `CONTEXTUAL_EMBED_SUB_BATCH_TOKEN_BUDGET`,
  scoped `loadDatabase`), `server/fastify/src/memoryEmbeddingAdapter.ts`
  (M7, L18).
- `server/fastify/src/memoryRepository.ts` (`cleanupOrphanedMemory`
  pre-checks — L16; `listPendingMemoryJobChatIds` — L17),
  `server/fastify/src/memoryWorker.ts` (`MEMORY_JOB_BATCH_MAX_JOBS`,
  `claimNextJobFairly`) + `memorySummarizeJobHandler.ts` (L17, L18).
- `server/fastify/src/repository.ts` (`loadPersistedDatabaseForMemoryJob` —
  L18).
- `server/fastify/src/prompt/luaRuntime.ts` (`LuaExecBudget` /
  `createLuaExecBudget` — L19; `LUA_PRELUDE`, `acquirePreparedEngine`,
  `refillLuaEnginePoolWhenIdle` — L21),
  `server/fastify/src/prompt/assemble.ts` (`luaExecBudget` threading — L19).

## Item Checklist

- [x] M7 — cap the drained embed batch (`MEMORY_JOB_BATCH_MAX_JOBS` = 32);
      slice the `voyageContext3` contextual request into token-aware
      sub-batches (~12k tokens at ~4 chars/token), committing each
      independently (`groupId` consistent per sub-batch).
- [x] L16 — skip the orphan-cleanup `BEGIN IMMEDIATE` write txn + summary
      re-parse when nothing is orphaned (EXISTS pre-check + empty-orphan
      early return).
- [x] L17 — round-robin per-chat memory job claims
      (least-recently-served pending chat first) + the bounded drain, so one
      chat's long batch does not starve others.
- [x] L18 — `loadPersistedDatabaseForMemoryJob` (settings row +
      `hypa_v3_presets` + id-only chat stubs) replaces the full
      `loadPersisted` per embed/summarize batch; broad fallback for
      uninitialized/pre-extraction states.
- [x] L19 — aggregate Lua exec-time budget (`LuaExecBudget`, 30s default)
      shared across triggers + edit-hook phases of one request.
- [x] L21 — pre-warmed engine pool with the static prelude pre-run and the
      host-fn surface declared once (state bound per call); per-call
      isolation preserved (one engine per call, never reused).

## Behavior / Invariants

- Memory work stays in the background worker.
- L21 does not weaken per-call isolation: pooled engines have never run user
  code and are discarded after exactly one call. The pool refills only while
  no run is in flight (engine boots during a pending Lua continuation crash
  wasmoon's shared wasm module).
- Embedding/summary outputs are unchanged; only batch sizing/scheduling
  changed (a contextual sub-batch boundary bounds the context window of the
  contextualized embedding request, which is the documented M7 fix).

## Done Criteria

- M7: a large first-pass embed run is sliced into bounded sub-batches; an
  oversized sub-batch failing does not fail unrelated chunks (split +
  independent commit proven).
- L16: no write txn when nothing is orphaned.
- L17: a long batch for one chat does not block other chats indefinitely.
- L18: no extra full `loadPersisted` per batch (load-cost harness proof).
- L19: a runaway hook hits an aggregate budget instead of stalling assembly.
- L21: engine/prelude reused without weakening isolation; output identical.
- Gates `M7, L16, L17, L18, L19, L21` registered DONE in Phase 8.

## Regressions

- `memoryEmbedJobHandler.test.ts` — M7 cap / sub-batch split / independent
  commit + L18 scoped-load.
- `memorySummarizeJobHandler.test.ts` — L18 scoped-load + unknown-chat error
  parity.
- `memoryRepository.test.ts` — L16 no-txn blocks (no summaries; none
  orphaned).
- `memoryWorker.test.ts` — L17 rotation + bounded-batch handoff.
- `luaRuntime.test.ts` — L19 short-circuit + aggregate trigger-loop bound;
  L21 warm-pool acquire (stats seam) + cross-run isolation.

## Validation

- `pnpm api:test -- server/fastify/__tests__/memory*.test.ts`
- `pnpm api:test -- server/fastify/__tests__/luaRuntime*.test.ts`
- `pnpm api:test`, both TypeScript checks. See
  [`../../../latest-verification.md`](../../../latest-verification.md).
