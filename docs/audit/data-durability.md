# Audit scope: Data durability & destructive operations

Status: DRAFT 2026-07-23 — items tagged `UNVERIFIED` are being re-checked by
the data-loss residual verification pass.

## Charter

**In scope:** the full persistence lifecycle where user data can be
destroyed or silently lost — `.risu` import/export, device backup
export/restore, legacy `db.json` boot import, automatic safety snapshots,
restore directory swaps and their journal, asset garbage collection, and the
transactional discipline of every destructive repository operation.

**Out of scope:** the pending-mutation outbox and writer lease (see
[writer-outbox.md](writer-outbox.md)); ordinary command persistence (see
[sync-hydration.md](sync-hydration.md)).

Key code: `server/fastify/src/routes/save.ts`, `server/fastify/src/risuSave/`,
`server/fastify/src/repository.ts` (backup/import/restore),
`src/ts/storage/backup.ts`, `src/ts/server/backups.ts`.

## Issue history

The 2026-07-21 data-loss audit (5 Codex passes, all high findings
spot-verified) found the worst defect cluster in the project's history. All
high/critical findings were remediated 2026-07-21/23 in 11 commits:

| Commit      | Finding | Fix |
| ----------- | ------- | --- |
| `99c9ee4c5` | A-4.3   | Restore refuses backups without a usable database payload. |
| `f27b7ea14` | A-3     | Automatic safety snapshot before destructive import/restore (`RISU_API_AUTOMATIC_BACKUP_RETENTION`, manifest `kind:"automatic"`). |
| `43bf053ac` | A-4.1/2 | Reject empty/block-truncated risusave imports (`risusave_empty_database`, `risusave_incomplete_blocks`). |
| `53cf89eea` | C-6/A-1 | Legacy `db.json` boot-import landmine defused: transactional import + checkpoint before rename, `.invalid` quarantine. |
| `7943a3838` | C-1/C-2 | Refuse silent database reseed on prior-install evidence (`RISU_API_ALLOW_MISSING_DATABASE` sentinel, 409 `initialize_conflict`). |
| `c0ed355e2` | B-1..5  | Asset GC no longer deletes still-referenced assets; dedup mtime refresh. |
| `7dd1d4937` | D-2,4..7 | Fail-closed message/chat command edges (required truncate anchor, cold-recovery arrays, hypa preservation). |
| `30fda53fd` | A-1/A-6 | Journaled restore directory swap with boot recovery; WAL-checkpoint result verified; online backup API for `risu.db` copies. |
| `08556abfe` | D-3     | Plugin transcript write-back refused on unhydrated chat shells. |

(`6a0b6c0b2` and `a0bb40e20` belong primarily to the writer/outbox scope.)

**Recurring patterns here:** destructive operations applied without payload
preflight (empty/truncated archives accepted); irreversible steps taken before
their safety net existed (rename before checkpoint, reseed without sentinel);
cleanup loops that assume every step succeeds.

## Resolved items

- `RESOLVED` (2026-07-23) **A-5** — server restore now owns
  generation-finalization retries and legacy-summary tombstones while explicitly
  preserving live push subscriptions (`server/fastify/src/repository.ts:2632`,
  `:3218`). Retry restoration projects historical queue schemas safely. Portable
  saves carry validated tombstones in namespaced `__risuServerData` metadata,
  strip it before domain normalization, and restore tombstones before the legacy
  backfill (`risuSave/portableMetadata.ts:3`, `risuSave/importSnapshot.ts:251`,
  `memoryLegacyImport.ts:72`). Backup compatibility/live-table/restart coverage
  is at `server/fastify/__tests__/backups.test.ts:444`; portable envelope,
  route, no-secret, bundle/local-backup, and restart coverage is at
  `risuSaveCodec.test.ts:440`, `risuSaveBundleImportRoute.test.ts:526`, and
  `memoryLegacyImport.test.ts:339`.
- `RESOLVED` (2026-07-23) **D-8** — single-chat export now
  requires strict message hydration before resolving and serializing the target
  (`src/ts/characters.ts:482`). A hydration rejection reaches the existing
  `alertError` boundary and creates no download, clipboard payload, or success
  alert (`src/ts/characters.exportChat.test.ts:236`); no automatic retry was
  added.
- `RESOLVED` (2026-07-23) **A-1.2** (medium) — staged-asset
  rollback cleanup now isolates every synchronous deletion, returns attempted /
  removed / failure details, skips pre-existing paths, and logs one aggregate
  warning without masking the original import error
  (`server/fastify/src/repository.ts:2542`, `routes/save.ts:200`). Fault-injected
  helper and route coverage is at
  `server/fastify/__tests__/risuSaveBundleImportRoute.test.ts:352`.

## Open items

- `ACCEPTED` — restore-in-flight edits are discarded by lineage rotation (by
  design; UI warns).
- `ACCEPTED` (trigger: user reports oversized-download failures) — device
  backup download is not end-to-end streamed to disk; browser saves a Blob via
  object URL; embedded `database.risu` bytes materialize before asset
  streaming (`.archived-docs/deferred-work/leftover.md`).
- `ACCEPTED` — remote/cache-only `.risu` block references are reported
  unsupported and skipped on import.

## Verified safe — do not re-audit

From the 2026-07-21 audit: schema migrations, future-schema refusal,
corrupt-DB fail-closed boot, initialize race, receipt-ACK sequencing,
specialized hydration baselines, ordinary delete/branch/copy/regenerate flows,
scoped-loader whole-DB write-back invariant.

Fix 11 (D-3) coverage verified 2026-07-23: Plugin V3 chat reads/writes
strictly hydrate and revalidate (`src/ts/plugins/apiV3/v3.svelte.ts:1312`,
`:1342`), the compatibility builder refuses a broad transcript PUT over an
empty not-known-hydrated array (`src/ts/chatCommands.ts:3810`), and no plugin
transcript path bypasses the guard (`sendChat` uses single-message append).

## Invariants for new code

- Repository backup/import/restore are async, but **every destructive
  transaction body is a synchronous critical section — never add an `await`
  inside one**.
- Restore swaps write `data/.restore-journal-<id>.json`; boot recovery
  (`recoverInterruptedRestoreSwaps`) runs before legacy import/routes and
  refuses unjournaled `.old`/`.tmp` paths.
- Minimal import test fixtures must carry one recognized core key (e.g.
  `characters: []`) or the `risusave_empty_database` guard rejects them.
- First-run seeding is client-driven (idempotent
  `POST /commands/state/initialize`) — the server never invents a database.

## Sources

Memory: `data-loss-audit-2026-07-21`. Archive:
`.archived-docs/protocol-and-persistence/` (SQLite migration, writer-takeover
offline mode), `.archived-docs/deferred-work/leftover.md` (save/restore
section).
