# Memory & Lua

Status: not started. Phase 6. Bundles the memory-worker bounding/fairness fixes
and the Lua exec-budget / engine-reuse fixes. L18 depends on the Phase 2 loader.

## Scope

Make memory batches size-bounded and fair, skip the orphan-cleanup write
transaction when nothing is orphaned, reuse the Phase 2 loader in memory batches,
and bound Lua execution cost.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  **M7, L16, L17, L18, L19, L21**.
- `server/fastify/src/memoryEmbedJobHandler.ts:91-95/:294-307/:456-466`,
  `server/fastify/src/memoryEmbeddingAdapter.ts:143-152` (M7, L18).
- `server/fastify/src/memoryRepository.ts:594-628` (L16),
  `server/fastify/src/memoryWorker.ts:101/:127-179` +
  `memorySummarizeJobHandler.ts` (L17).
- `server/fastify/src/prompt/luaRuntime.ts:911/:926-943/:1064-1080`,
  `server/fastify/src/prompt/triggers.ts:846` (L19, L21).

## Item Checklist

- [ ] **M7** — cap the drained embed batch; slice the `voyageContext3` contextual
      request into token-aware sub-batches, committing each independently (keep
      `groupId` consistent per sub-batch).
- [ ] **L16** — skip the orphan-cleanup `BEGIN IMMEDIATE` write txn + summary
      re-parse when nothing is orphaned (cheap pre-check) **[known-leftover]**.
- [ ] **L17** — round-robin / bound per-chat memory job batches so one chat's
      long batch does not starve others.
- [ ] **L18** — reuse the Phase 2 scoped/memoized loader instead of full
      `loadPersisted` per embed/summarize batch.
- [ ] **L19** — aggregate Lua exec-time/engine budget across triggers + edit-hook
      phases **[known-leftover: hosted-Lua]**.
- [ ] **L21** — reuse/pool the wasmoon engine or cache the compiled prelude
      **within the per-call isolation model**.

## Behavior / Invariants

- Memory work stays in the background worker (no UI hang, no chat-hot-path cost).
- L21 must not weaken the per-call isolation security property; if pooling is
  unsafe, cache only the compiled prelude/factory and keep a fresh engine per call.
- Embedding/summary outputs are unchanged; only batch sizing/scheduling changes.

## Done Criteria

- M7: a large first-pass embed run is sliced into bounded sub-batches; an
  oversized sub-batch failing does not fail unrelated chunks (test split +
  independent commit).
- L16: no write txn when nothing is orphaned.
- L17: a long batch for one chat does not block other chats indefinitely.
- L18: no extra full `loadPersisted` per batch.
- L19: a runaway hook hits an aggregate budget instead of stalling assembly.
- L21: engine/prelude reused without weakening isolation; output identical.
- Gates `M7, L16, L17, L18, L19, L21` registered in Phase 8.

## Validation

- `pnpm api:test -- server/fastify/__tests__/memory*.test.ts`
- `pnpm api:test -- server/fastify/__tests__/luaRuntime*.test.ts`
- `pnpm api:test`, both TypeScript checks.
