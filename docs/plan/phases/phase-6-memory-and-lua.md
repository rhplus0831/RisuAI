# Phase 6: Memory & Lua

Status: not started. Bounds memory worker batches and Lua execution. L18 depends
on the Phase 2 scoped/memoized loader.

Goal: make memory work bounded and fair, skip empty orphan cleanup writes, reuse
the Phase 2 loader, and add Lua execution budgeting / safe engine reuse.

Findings: M7, L16, L17, L18, L19, L21.

## Source Anchors

- [`../audit-stability-and-performance.md`](../audit-stability-and-performance.md) -
  M7, L16, L17, L18, L19, L21.
- `server/fastify/src/memoryEmbedJobHandler.ts` (uncapped claim loop :91,
  contextual single request :294, `loadDatabase` :456),
  `server/fastify/src/memoryEmbeddingAdapter.ts` (`embedTextGroups` :143),
  `server/fastify/src/memorySummarizeJobHandler.ts` (claim loop, `loadDatabase`),
  `server/fastify/src/memoryWorker.ts` (single-in-flight tick),
  `server/fastify/src/memoryRepository.ts` (`cleanupOrphanedMemory` :594).
- `server/fastify/src/prompt/luaRuntime.ts` (`runServerLua` :911, prelude
  recompile :926, `runLuaEditTrigger` loop :1064), `server/fastify/src/prompt/triggers.ts`
  (`runTrigger` triggerlua arm :846).

## Slices

- [`memory-and-lua.md`](slices/phase-6-memory-and-lua/memory-and-lua.md) - full
  batch:
  - M7: cap the drained embed batch and slice the `voyageContext3` contextual
    request into token-aware sub-batches, committing each independently so one
    oversized request cannot fail unrelated chunks; keep `groupId` consistent per
    sub-batch.
  - L16: skip the orphan-cleanup `BEGIN IMMEDIATE` write transaction + summary
    re-parse when nothing is orphaned [known-leftover: memory-bridge].
  - L17: round-robin / bound per-chat memory job batches so one chat's long batch
    does not starve others.
  - L18: reuse the Phase 2 scoped/memoized loader instead of a full
    `loadPersisted` per embed/summarize batch.
  - L19: aggregate Lua exec-time/engine budget across triggers + edit-hook phases
    so a card cannot stall assembly [known-leftover: hosted-Lua].
  - L21: reuse/pool the wasmoon engine or cache the compiled prelude within the
    per-call isolation model (the engine boot + prelude recompile is per
    triggerlua run).

## Planned Shape

- M7: split by token size, not just count; chunk text lengths vary.
- L16: gate the transaction on a cheap orphan pre-check.
- L21: engine reuse must preserve per-call isolation. If pooling is unsafe, cache
  only the compiled prelude/factory.

## Exit Criteria

- [ ] M7: a large first-pass embed run is sliced into bounded sub-batches; one
      oversized sub-batch failing does not fail unrelated chunks (test the split +
      independent commit).
- [ ] L16: orphan cleanup opens no write transaction when nothing is orphaned.
- [ ] L17: a long batch for one chat does not block other chats' memory jobs
      indefinitely (fairness test).
- [ ] L18: memory batches reuse the Phase 2 loader; no extra full `loadPersisted`
      per batch.
- [ ] L19: a runaway Lua hook hits an aggregate budget instead of stalling
      assembly indefinitely.
- [ ] L21: the wasmoon engine/prelude is reused or cached without weakening
      per-call isolation; output identical.
- [ ] Gates registered in Phase 8; memory + Lua tests + audit + TypeScript checks
      green.

## Validation

- `pnpm api:test -- server/fastify/__tests__/memory*.test.ts` (M7, L16, L17, L18).
- `pnpm api:test -- server/fastify/__tests__/luaRuntime*.test.ts` (L19, L21).
- `pnpm api:test`, both TypeScript checks.
