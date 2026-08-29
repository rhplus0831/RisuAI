# Phase 11: Assets, Import, Export, And Backups

Status: Complete; depends on Phases 0-3 and consumes Phase 5/10 asset-cleanup
findings. Residual runtime and cross-suite composition owners are routed to
Phases 12-14.

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

## Completed Audit Record

Phase 11 opened with 42 category-K owners / 554 cases / 54 parameterized rows:
29 frontend owners / 280 cases and 13 Fastify owners / 274 cases. The complete
opening set passed before remediation and again afterward at 28 retained
frontend files / 280 cases and 13 Fastify files / 288 cases. The current K set
is 25 owners / 433 cases / 45 parameterized rows after 17 exact-path
reclassifications, one proven-dead owner removal, and one direct backup owner
addition.

### Contract and disposition matrix

| Contract family | Evidence and decision |
| --------------- | --------------------- |
| Asset bytes, metadata, hashes, references, GC, and client transport | Keep the layered repository, API, and browser owners. They fail at distinct byte, index, validation, reference-walk, and projection boundaries. |
| Backup creation, restore, journal recovery, legacy conversion, and browser wrappers | Keep. Failure injection covers pre-commit rollback, ambiguous commit lineage, post-commit cleanup, and next-boot convergence. Add the direct legacy local-backup rewrite owner. |
| Legacy and block `.risu` framing, bounded inflate, normalization, and routes | Keep. Reject invalid compression markers, excessive directory/physical-block cardinality, duplicate physical names, duplicate singleton/root components, and ambiguous archives. |
| Ordinary and bundled import/export | Keep. Preserve reroll alternatives, enforce exact archive structure, and reject duplicate entries. Retain route/repository separation because parsing, durable replacement, and response contracts differ. |
| Realm/CharX import | Keep. Roll back assets written before conversion, append, or command failure while preserving pre-existing content-addressed assets. Keep the isolated 7,000-asset execution owner. |
| Browser inlay/PDF/save mode cleanup | Keep under the corrected product categories. Contain rejected background migrations, release PDF pages/canvases on every exit, and force inline saves in Fastify mode. |
| Seventeen asset-adjacent owners | Reclassify unchanged to B/C/D/E/G/L because durable commands, browser state, visible feedback, authoring, provider-media lifecycle, or platform capabilities are their dominant risks. |
| `src/ts/kei/backup.test.ts` and `src/ts/kei/backup.ts` | Remove. Repository-wide import/caller search proved the adapter was test-only and unreachable; no supported format or product path was removed. |
| Historical/current fixture families | Keep with bounded claims. Frozen pre-Fastify raw/compressed/stream fixtures are genuine; current block/ZIP/SQLite fixtures are synthetic or current-code-derived and are not independent historical evidence. |

### Fixture provenance and support map

- Legacy raw, compressed, and stream bytes come from the plain pre-Fastify
  `/home/codex/Risuai` implementation and pin `msgpackr` 1.10.1 behavior.
- Current block fixtures use the production codec through the fixture harness;
  bundle fixtures use `fflate` around current export output. They prove current
  composition and malformed-envelope handling, not independent interoperability.
- The `.bin` fixtures are hand-framed current bytes; backup SQLite fixtures are
  generated by current repository code with deliberate historical schema
  edits. No frozen original `.bin`, real historical bundle, or archived backup
  database was available.
- The exact pinned differential worktree
  `/home/codex/risu-baseline-71c476e9c` remains absent. No substitute baseline
  was used and no golden or compatibility fixture was refreshed.

### Count and ownership delta

- Added 23 cases and removed five, for a net `+18` and 10,170 live cases.
- Added `server/fastify/__tests__/localBackupDatabase.test.ts` with three direct
  rewrite cases; removed the five-case Kei owner and its unreachable adapter.
- Added one routing-policy case. Live owners remain 700; support artifacts are
  252 standalone and 64 mixed production seams.
- Live decisions are 586 Keep, 82 Reclassify, and 32 Pending. The durable action
  ledger is now two removals and three additions.

### Residual ownership

No unresolved confirmed Critical finding remains in Phase 11. The following
High-capability gaps are bounded rather than overstated:

- Phase 12 owns post-upload/request disconnect observability, request-abort
  propagation, archive/import runtime limits, and CharX/import tracing.
- Phase 13 owns streaming/materialization policy for large exports and browser
  ZIP/Realm fallbacks, a central persisted-asset-owner parity contract, bounded
  multi-file/PDF composition, and representative real browser restore/import
  journeys.
- Phase 14 owns the final support verdict for synthetic current fixtures and
  the missing historical `.bin`, bundle, backup, and differential baseline.

## Exit Criteria

- Every Phase 11 test, fixture family, and helper has a disposition.
- Unique atomicity, cap, hash/reference, salvage, rollback, and historical-format
  behavior remains protected.
- Critical/High data-loss, traversal, decompression, or destructive-restore
  findings are resolved or explicitly gated.
- Direct-only high-cardinality behavior has a deliberate execution owner.
- Count/fixture deltas and residual browser/real-history gaps are recorded.

All exit criteria are satisfied. The remaining gaps have named phases, bounded
claims, and concrete revisit conditions rather than unowned deferrals.

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

The exact owner runs, complete frontend and Fastify lanes, direct Realm scale
owner, current-only compatibility, performance, smoke, typecheck, affected
selection, inventory, formatting, and diff gates are recorded in
[`latest-verification.md`](../latest-verification.md). Full differential
compatibility is prerequisite-blocked only by the absent pinned worktree.
