# Materialization & Lifecycle

Status: IMPLEMENTED (`686220d6`, one batch). Phase 5. Bundles bounded
inflate/buffering, stream/job cleanup, import/restore robustness, and
sync-replay correctness. `.risu` round-trip tests gate codec changes.

Regressions: `risuSaveBoundedInflate.test.ts` + the bundle-import inner-cap
test (M9), `assetGc.test.ts` M10 load-cost + hydrated-walker equivalence
tests, `risuSaveBundleExportRoute.test.ts` M11 abort test (fails pre-fix),
`events.test.ts` L11 + L29 tests, `streamJobsRoutes.test.ts` L12 test,
`durableGeneration.test.ts` L13 (fails pre-fix) + L14 tests,
`streamJobs.test.ts` L15 test, `backups.test.ts` L27/L28 tests,
`reattach.test.ts` L30 test (fails pre-fix).

## Scope

Bound decompression/buffering before materialization. Clean up resources on
abort/close. Harden import/restore and keep own-echo suppression + reattach
correct.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  M9, M10, M11, L11-L15, L27-L30.
- `server/fastify/src/risuSave/legacyEnvelopeCodec.ts:74-82`,
  `risuSave/blockCodec.ts:115-119` (M9); `risuSave/bundleExport.ts:111/:156-161`,
  `routes/save.ts:273` (M11); `assetGc.ts:82`, `risuSave/assetReferences.ts:31`,
  `routes/save.ts:406` (M10).
- `server/fastify/src/routes/events.ts:148` (L11),
  `server/fastify/src/routes/streamJobs.ts:199-224` (L12), `app.ts:186-198` +
  `routes/generationChat.ts:1743` (L13), `routes/generationChat.ts:1060-1086`
  (L14), `streamJobs.ts:268-294` (L15).
- `server/fastify/src/repository.ts:1518-1520` (L27 `listBackups`), `:976-1005`
  / `:1665-1671` (L28 restore), `server/fastify/src/commands/events.ts:89/:166`
  (L29), `src/ts/process/reattach.ts:48-87` (L30).

## Item Checklist

- [x] M9 — streaming bounded inflate (`fflate` `Gunzip`/`Decompress` +
      output-cap `ondata` accumulator) per legacy envelope and per block; finite
      default cap for `/import/bundle`'s inner `.risu`.
- [x] M10 — asset GC + import asset report scan `SELECT data FROM messages`
      for `{{inlay...}}` tokens (no full hydrate / per-row parse), unioned with
      non-message refs; defer the import asset report.
- [x] M11 — bundle export drain-wait settles on `close`/`error`; on premature
      close `zip.terminate()` + destroy the in-flight read stream.
- [x] L11 — `cleanedUp` guard before `memoryEvents.subscribe`.
- [x] L12 — close the proxy WS viewer when it attaches to an already-done job.
- [x] L13 — `onClose` awaits/guards detached runners; cancel-persist checks
      DB-open before writing.
- [x] L14 — heartbeat the durable SSE viewer during long assembly.
- [x] L15 — bound the no-viewer proxy-job buffer / enable a replay bound.
- [x] L27 — guard per-manifest `JSON.parse` in `listBackups` (skip/flag a
      corrupt manifest instead of 500).
- [x] L28 — wrap the legacy `db.json` restore re-import in a transaction;
      emit the restore event after it.
- [x] L29 — persist writer-session origin on command events so reconnect
      replay keeps own-echo suppression.
- [x] L30 — re-arm reattach after completion so a second live-job chat
      reattaches.

## Behavior / Invariants

- M9/M11: `.risu` round-trips are byte-identical; only failure/abort mode
  changes.
- M10: referenced/missing/orphaned asset sets are unchanged.
- L29: stamping origin must not change the projected event payload.
- L13/L28: abort/failure leaves no partial write.

## Done Criteria

- M9: a crafted oversized compressed `.risu` aborts at the cap during inflate;
  round-trips byte-identical.
- M10: GC/report no longer `JSON.parse` every message; asset sets unchanged.
- M11: an aborted large bundle download frees the FD + terminates the Zip.
- L11-L15: each lifecycle gap closed (no leak on the simulated abort/close/done).
- L27/L28: corrupt manifest doesn't 500; failed restore re-import is atomic.
- L29/L30: reconnect replay keeps own-echo suppression; second live-job chat
  reattaches.
- Gates `M9-M11, L11-L15, L27-L30` registered in Phase 8.

## Validation

- `pnpm api:test -- server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/backups.test.ts`
- `pnpm api:test -- server/fastify/__tests__/events.test.ts server/fastify/__tests__/durableGeneration.test.ts`
- `pnpm api:test`, both TypeScript checks.
