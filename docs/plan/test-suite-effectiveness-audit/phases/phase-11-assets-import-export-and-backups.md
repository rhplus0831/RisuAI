# Phase 11: Assets, Import, Export, And Backups

Status: Pending; depends on Phases 0-3 and consumes Phase 5 authoring findings.

## Objective

Audit whether asset and save tests protect atomicity, bounded untrusted input,
reference integrity, rollback, historical compatibility, and recovery from
destructive operations using realistic bytes, archives, files, and SQLite state.

## Scope

- Asset upload/bulk upload, hashing, metadata, content addressing, idempotency,
  references, inlay catalog, garbage collection, and missing-blob healing.
- `.risu` codecs, bounded inflate, save and bundle import/export, compatibility
  adapters, and legacy database/storage conversion.
- Realm/CharX/card/chat/preset import and export, high-cardinality staging,
  salvage/rejection reports, media ownership, and abort/rollback.
- Backup creation, listing, restore, reset, deletion, failure cleanup, and
  interaction with queued browser intent.
- Browser upload/import/export UI only where bytes, staging, or destructive
  lifecycle are the primary risk.

Primary discovery guide:
[`assets-import-export-and-backups.md`](../../../tests/assets-import-export-and-backups.md).

## Audit Questions

- Do tests use real bytes/files/archives and assert hashes, metadata, references,
  rows, cleanup, and revisions rather than only response shapes?
- Are multipart, binary framing, decompression, path, cardinality, and body caps
  checked at the correct pre-parse boundary?
- Do partial failures leave no orphaned bytes, rows, temp files, or half-replaced
  state?
- Is each historical format still supported, and are fixtures representative of
  real old data rather than generated from current projections?
- Is destructive restore tested with pending outbox work, visible selection, and
  reload/recovery consequences?

## Required Outputs

- Format/operation contract and disposition matrix.
- Fixture provenance and compatibility-support map.
- Findings for synthetic legacy fixtures, weak byte/reference assertions,
  missing caps/aborts, partial cleanup, obsolete adapters, and absent destructive
  browser journeys.
- Permanent record for every removed format/scenario and its support decision.

## Exit Criteria

- Every Phase 11 test, fixture family, and helper has a disposition.
- Unique atomicity, cap, hash/reference, salvage, rollback, and historical-format
  behavior remains protected.
- Critical/High data-loss, traversal, decompression, or destructive-restore
  findings are resolved or explicitly gated.
- Direct-only high-cardinality behavior has a deliberate execution owner.
- Count/fixture deltas and residual browser/real-history gaps are recorded.

## Validation

- Focused frontend asset/storage/import/export/backup tests
- Focused Fastify asset/save/import/backup/legacy tests
- `pnpm test:affected --dry-run` and selected lanes
- `pnpm test:frontend:all`
- `pnpm test:server`
- Direct Realm stress case when its owner changes
- Relevant visible-state/browser smoke journeys and screenshot review
- `pnpm check:server`
- `pnpm format:check`
- `git diff --check`
