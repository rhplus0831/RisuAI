# Phase 8: Server Jobs, Memory & Import Bounds

Status: pending. Independent; order by pain. Bounded, mostly-local server
fixes grouped by subsystem; L15 is a cheap standalone win that can land any
time.

Goal: server jobs, memory, import/export, and outbound paths get retention,
fairness, durability, and deadline bounds; one scheduled semantic correction
(L22) is made explicit and observable.

Findings: L1, L2, L15, L17, L18, L19, L20, L21, L22, L23, L24, L25, L26,
L27, L28, L29, L30, L31. (I3's unused-index drop may ride along if free.)

## Slices

- L1:
  [`slices/phase-8-server-bounds/generation-deadline-bounds.md`](slices/phase-8-server-bounds/generation-deadline-bounds.md)
  - make durable and non-durable generation deadlines configurable or sliding
    without killing active streams.
- L2/L17:
  [`slices/phase-8-server-bounds/terminal-job-retention-sweeps.md`](slices/phase-8-server-bounds/terminal-job-retention-sweeps.md)
  - prune terminal finalization retry rows and terminal memory jobs while
    leaving live work untouched.
- L15:
  [`slices/phase-8-server-bounds/sqlite-wal-synchronous-normal.md`](slices/phase-8-server-bounds/sqlite-wal-synchronous-normal.md)
  - set `PRAGMA synchronous = NORMAL` after enabling WAL and record the
    durability trade-off.
- L18:
  [`slices/phase-8-server-bounds/memory-worker-backlog-drain.md`](slices/phase-8-server-bounds/memory-worker-backlog-drain.md)
  - reschedule the memory worker immediately after productive ticks.
- L19:
  [`slices/phase-8-server-bounds/memory-job-failure-cascade-scope.md`](slices/phase-8-server-bounds/memory-job-failure-cascade-scope.md)
  - keep transient failures from cascading across independent memory jobs.
- L20:
  [`slices/phase-8-server-bounds/memory-summary-fetch-sharing.md`](slices/phase-8-server-bounds/memory-summary-fetch-sharing.md)
  - share one summary metadata read between orphan cleanup and memory
    selection.
- L21/L22:
  [`slices/phase-8-server-bounds/memory-embedding-chunk-bounds.md`](slices/phase-8-server-bounds/memory-embedding-chunk-bounds.md)
  - enforce per-chunk embed size ceilings and make contextual split policy
    explicit and observable.
- L23/L24:
  [`slices/phase-8-server-bounds/realm-json-asset-batch-cleanup.md`](slices/phase-8-server-bounds/realm-json-asset-batch-cleanup.md)
  - batch JSON-card asset persistence and delete persisted assets if character
    append fails.
- L25:
  [`slices/phase-8-server-bounds/bundle-export-open-or-skip.md`](slices/phase-8-server-bounds/bundle-export-open-or-skip.md)
  - open bundle assets at stream time and degrade missing files into
    `missingFiles`.
- L26:
  [`slices/phase-8-server-bounds/legacy-storage-atomic-write.md`](slices/phase-8-server-bounds/legacy-storage-atomic-write.md)
  - use temp-file, fsync, and rename for legacy storage writes.
- L28:
  [`slices/phase-8-server-bounds/risusave-json-import-single-clone.md`](slices/phase-8-server-bounds/risusave-json-import-single-clone.md)
  - remove the extra full-corpus JSON clone from non-multipart `.risu` import.
- L29:
  [`slices/phase-8-server-bounds/realm-charx-download-cap.md`](slices/phase-8-server-bounds/realm-charx-download-cap.md)
  - cap Realm `.charx` staging downloads before they can grow toward 2 GB.
- L27:
  [`slices/phase-8-server-bounds/hub-forward-abort-timeout.md`](slices/phase-8-server-bounds/hub-forward-abort-timeout.md)
  - add abort, deadline, and bounded streaming behavior to hub forwards.
- L30:
  [`slices/phase-8-server-bounds/vertex-token-inflight-dedupe.md`](slices/phase-8-server-bounds/vertex-token-inflight-dedupe.md)
  - dedupe concurrent cold Vertex token exchanges with an in-flight promise.
- L31:
  [`slices/phase-8-server-bounds/proxy-default-deadline.md`](slices/phase-8-server-bounds/proxy-default-deadline.md)
  - apply a default proxy deadline when `risu-timeout-ms` is absent and cap
    excessive client values.
- Proof:
  [`slices/phase-8-server-bounds/phase-8-verification-refresh.md`](slices/phase-8-server-bounds/phase-8-verification-refresh.md)
  - refresh gates, focused server proofs, full validation, and latest
    verification.

## Source Anchors

- [`../audit-stability-and-performance-v2.md`](../audit-stability-and-performance-v2.md) -
  L1, L2, L15, L17-L31.
- Generation/jobs: `server/fastify/src/routes/generationChat.ts` +
  `streamJobs.ts` (L1 fixed durable deadline; pair with the non-durable twin
  in `requestAbort.ts` noted under Known-Item Overlaps),
  `generationFinalizationRetry.ts` (L2 terminal rows).
- SQLite: `server/fastify/src/db.ts` (L15 `PRAGMA synchronous = NORMAL`).
- Memory: `memoryRepository.ts` (L17 retention, L20 shared summaries fetch),
  `memoryWorker.ts` (L18 fast path), `memoryEmbedJobHandler.ts` +
  `memorySummarizeJobHandler.ts` (L19 cascade scope, L21 chunk ceiling,
  L22 contextual window), `memoryChunkPlanner.ts` (L21 chunk build).
- Import/export/assets: `routes/realmImport.ts` (L23 per-asset txn, L24
  orphaned assets, L29 download cap), `risuSave/bundleExport.ts` (L25
  open-or-skip), `routes/legacyStorage.ts` (L26 atomic write),
  `routes/save.ts` + `risuSave/importSnapshot.ts` (L28 double clone).
- Outbound: `routes/hub.ts` (L27), `generation/vertexAuth.ts` (L30),
  `routes/proxy.ts` + `proxy.ts` (L31 default deadline).

## Planned Shape

- L1: client-suppliable or config `timeoutMs` (bounded by
  `PROXY_STREAM_MAX_TIMEOUT_MS`) and/or a sliding deadline advanced on token
  activity — an actively-streaming generation is never killed. Apply the
  same decision to the non-durable 600 s twin.
- L22 is a documented semantic decision, not a silent tweak: size the
  contextual budget from the provider's context limit or fall back to
  non-contextual for unsplittable batches; at minimum emit a metric when a
  contextual batch is split.
- L24: compensating delete (mirroring `addAssets`' own `createdFiles`
  rollback) rather than widening transactions across network fetches.
- L26: temp-file + fsync + rename in the same directory.
- L31: mirror `NON_DURABLE_REQUEST_DEADLINE_MS` as the backstop when the
  header is absent; cap excessive client-supplied values.
- All bounds are additive: valid success paths unchanged, new failure modes
  tested explicitly.

## Exit Criteria

- [x] L1: a >deadline actively-streaming generation survives (sliding) or
      honors the raised configured cap; runaway no-token jobs still die.
- [x] L2/L17: terminal retry rows and terminal memory jobs are swept; live
      rows untouched (retention tests).
- [x] L15: `synchronous = NORMAL` set after WAL; durability note recorded.
- [ ] L18/L19/L20/L21/L22: worker drains a backlog without idle gaps;
      transient failures retry only the failed jobs; one summaries fetch per
      assembly; oversized chunks fail fast with a clear error; contextual
      splits are observable and the window policy is documented.
- [ ] L23-L29: batched asset persists, compensating cleanup, open-or-skip
      streaming, atomic legacy writes, single-clone import, bounded charx
      download — each with a behavior test; import/export bytes unchanged.
- [ ] L27/L30/L31: hub abort/deadline, Vertex in-flight dedupe, proxy
      default deadline — each with a focused test.
- [ ] Gates registered; focused suites + TypeScript checks green;
      [`../latest-verification.md`](../latest-verification.md) updated.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/db.test.ts \
  server/fastify/__tests__/streamJobs.test.ts \
  server/fastify/__tests__/durableGeneration.test.ts \
  server/fastify/__tests__/memoryWorker.test.ts \
  server/fastify/__tests__/memoryEmbedJobHandler.test.ts \
  server/fastify/__tests__/memorySummarizeJobHandler.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/backups.test.ts \
  server/fastify/__tests__/risuSaveBundleExportRoute.test.ts \
  server/fastify/__tests__/proxy.test.ts
pnpm api:test
```
