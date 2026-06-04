# Phase 5: Materialization & Lifecycle (Root 5)

Status: not started. Covers bounded inflate/buffering, stream/job cleanup,
import/restore robustness, and sync-replay correctness.

Goal: bound work before materialization, clean up on abort/close, harden
import/restore, and keep sync replay correct. `.risu` bytes must not change.

Findings: M9, M10, M11, L11, L12, L13, L14, L15, L27, L28, L29, L30.

## Source Anchors

- [`../audit-stability-and-performance.md`](../audit-stability-and-performance.md) -
  M9, M10, M11, L11-L15, L27-L30.
- `server/fastify/src/risuSave/legacyEnvelopeCodec.ts`, `risuSave/blockCodec.ts`,
  `risuSave/bundleExport.ts`, `risuSave/importSnapshot.ts`,
  `server/fastify/src/routes/save.ts`, `server/fastify/src/assetGc.ts`,
  `server/fastify/src/risuSave/assetReferences.ts`,
  `server/fastify/src/repository.ts` (`listBackups`, `restoreBackup`,
  `ensureDbJsonImported`).
- `server/fastify/src/streamJobs.ts`, `server/fastify/src/routes/streamJobs.ts`,
  `server/fastify/src/routes/events.ts`, `server/fastify/src/routes/generationChat.ts`
  (`attachGenerationViewer`, `void runGenerationJob`), `server/fastify/src/app.ts`
  (`onClose`, timers).
- `server/fastify/src/commands/events.ts` (`persistCommandEvent`,
  `commandEventFromRow`), `src/ts/bootstrap.ts` (`isOwnCommandEvent`),
  `src/ts/process/reattach.ts`.

## Slices

- [`materialization-and-lifecycle.md`](slices/phase-5-materialization-and-lifecycle/materialization-and-lifecycle.md) -
  full batch:
  - M9: streaming bounded inflate — `fflate` `Gunzip`/`Decompress` with an
    `ondata` accumulator that throws past `maxExpandedBytes`, per legacy envelope
    and per block; finite default cap for `/import/bundle`'s inner `.risu`.
  - M10: asset GC + import asset report scan `SELECT data FROM messages` for
    `{{inlay...}}` tokens (no full hydrate / per-row `JSON.parse`); make the import
    asset report deferred/optional.
  - M11: bundle export drain-wait settles on `close`/`error`; on premature close
    `zip.terminate()` + destroy the in-flight read stream so the loop unwinds and
    the FD is freed.
  - L11-L15: stream/job lifecycle — `cleanedUp` guard before
    `memoryEvents.subscribe` (L11); close the proxy WS viewer on already-done job
    (L12); `onClose` awaits/guards detached runners and cancel-persist checks
    DB-open (L13); heartbeat the durable SSE viewer during long assembly (L14);
    bound the no-viewer proxy-job buffer (L15).
  - L27/L28: guard per-manifest `JSON.parse` in `listBackups` (L27); wrap the
    legacy `db.json` restore re-import in a transaction and emit the restore event
    after it (L28).
  - L29/L30: persist writer-session origin on command events so reconnect replay
    keeps own-echo suppression (L29); re-arm reattach after completion (L30).

## Planned Shape

- M9: `fflate` already ships streaming `Gunzip`/`Decompress`; output stays
  byte-identical, only oversize failure changes.
- M10: the asset walker only needs each message's `data` string; the token-only
  scan must still union with the non-message references (`loadPersisted`).
- M11: explicitly destroy the source read stream when close/abort parks the loop.
- L29: stamping origin on the persisted event must not change the event payload
  the client projects; it is metadata for own-echo suppression.

## Exit Criteria

- [ ] M9: a crafted oversized compressed `.risu` aborts during inflate at the cap
      instead of fully allocating; normal import/export round-trips are
      byte-identical.
- [ ] M10: asset GC and the import report no longer `JSON.parse` every message;
      the referenced/missing/orphaned asset sets are unchanged on a fixture.
- [ ] M11: an aborted large bundle download frees the FD and terminates the Zip
      (test the close path destroys the read stream).
- [ ] L11-L15: each lifecycle gap is closed with no leak on the simulated
      abort/close/done path.
- [ ] L27: a corrupt manifest no longer 500s the backups list.
- [ ] L28: a failed legacy restore re-import does not leave a partial state and the
      restore event fires after the import.
- [ ] L29/L30: reconnect replay keeps own-echo suppression; a second live-job chat
      reattaches after the first completes.
- [ ] Gates registered in Phase 8; server suite + audit + TypeScript checks green;
      `.risu` round-trip tests green.

## Validation

- `pnpm api:test -- server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts`
  (M9, M11; round-trip identity).
- `pnpm api:test -- server/fastify/__tests__/backups.test.ts` (L27, L28).
- `pnpm api:test -- server/fastify/__tests__/events.test.ts server/fastify/__tests__/durableGeneration.test.ts`
  (L11-L15, L29, L30).
- `pnpm api:test`, both TypeScript checks.
