# Phase 4: Server Maintenance Scheduling

Finding: F07. Dependency: Phase 3 correctness/type/structural gates and Phase 1
maintenance baseline. The recorded sequencing amendment permits slice 4a while
Phase 3 timing closure proceeds; Phase 4 acceptance still requires Phase 3 accepted.
Progress belongs in [status.md](../status.md).

## Objective and Owners

Permit API and stream progress during long backup copies and asset sweeps while
preserving the consistency currently provided by synchronous execution.

Read [assets and saves](../../../../docs/structure/assets-and-saves.md) and
[backend lifecycle](../../../../docs/structure/backend.md). Owners:
`server/fastify/src/repository.ts`, `server/fastify/src/routes/backups.ts`,
`server/fastify/src/assetGc.ts`, `server/fastify/src/risuSave/assetReferences.ts`,
and `server/fastify/src/app.ts`.

## 4a: Backup Copies

- Measure SQLite snapshot time separately from directory copy, manifest work,
  retention, and cleanup. Preserve the online SQLite backup and WAL policy.
- Choose the smallest mechanism that permits progress: asynchronous bounded
  file copying may suffice; a worker/process needs justification for CPU-heavy
  work. Bound simultaneous backup jobs and filesystem operations.
- Define how assets referenced by the snapshot remain available while copying,
  including interaction with GC, imports, restore, and backup deletion. A copied
  database and an incomplete referenced-asset set is not a successful backup.
  Establish the captured asset set and a pin/snapshot protocol spanning the
  SQLite-backup await and file copying. Include the consistency policy for mutable
  compatibility save files. Test deletion/upload/restore during suspension and
  missing referenced files; do not infer safety from a successful copy call.
- Publish the completed backup only after all required files and metadata are
  ready. Preserve failure cleanup, retention, restore protection, shutdown, and
  existing API completion/error semantics. A new public job protocol is not
  automatically part of this phase.

Exit: a lightweight authenticated request and stream can make progress during a
large synthetic backup; restored data/assets match the captured snapshot;
failure or cancellation does not expose a successful partial backup.

## 4b: Asset Collection and Reclamation

- Separate reference discovery from deletion. Existing GC's synchronous sweep
  acts as a consistency boundary; adding awaits changes that boundary.
- Evaluate bounded scan chunks or isolated discovery against incremental indexes.
  Prefer the least complex design that meets measured budgets. A reference index
  requires complete mutation/import/restore maintenance and rebuild evidence;
  it is not a shortcut around enumerating reference owners.
- Revalidate candidates against current authoritative references before removal.
  Protect the check/delete interval against new references, upload-to-reference
  staging, pending finalizations, backups, and destructive restore/lineage changes.
  Enforce metadata revalidation/deletion within an explicit SQLite transaction
  or serialized mutation boundary, coordinated with backup pins and staged
  uploads. Document coordination for asynchronous file deletion explicitly;
  a gap after deleting metadata must not allow a newly referenced file to vanish.
- Prevent overlapping sweeps and bound batches/queues. Preserve grace windows,
  retryability, malformed-reference behavior, metadata/file consistency, and
  cancellation/shutdown cleanup.

Exit: controlled reference insertion between discovery and reclamation cannot
delete a newly referenced asset; upload staging and backup pins remain protected.
Large scans permit API progress and have bounded per-turn work. Reclamation still
converges without unbounded retained discovery results.

## Verification and Rollback

Extend `server/fastify/__tests__/backups.test.ts`,
`server/fastify/__tests__/localBackupDatabase.test.ts`, and
`server/fastify/__tests__/assetGc.test.ts` with deterministic interleaving and
failure cases. Measure event-loop/API progress independently of total completion
time; a faster total copy does not prove responsiveness. Run focused tests and
the isolated cost probe, then `pnpm test:agent` and current-document checks.

Keep backup and GC changes independently revertible. If safe reclamation cannot
be established, prefer temporarily retaining candidates over deleting them from
a stale reference snapshot, and record the retained disk cost. Do not ship a
new storage/reference-index format without rebuild and rollback guarantees.
