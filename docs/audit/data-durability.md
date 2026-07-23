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

## Open items

- `VERIFIED-OPEN` (2026-07-23) **A-5** — backup allowlist round-trip
  omissions: the portable exporter serializes only `Persisted.database`
  (`server/fastify/src/risuSave/exportSnapshot.ts:27`) and
  `SQLITE_BACKUP_TABLES` omits `generation_finalization_retries`,
  `memory_legacy_summary_tombstones`, `push_subscriptions`
  (`repository.ts:2609`; restore iterates only that list, `:3246`), so those
  rows do not survive export→restore.
- `VERIFIED-OPEN` (2026-07-23) **D-8** — single-chat export calls
  `hydrateChatMessages(chatId)` without `{ strict: true }` and serializes
  immediately (`src/ts/characters.ts:481`, `:504`), so a failed/stale
  hydration can still produce an incomplete artifact (artifact-only loss; DB
  unharmed).
- `VERIFIED-OPEN` (2026-07-23) **A-1.2** (medium) — bundle-import rollback
  cleanup (`cleanupCopiedStagedAssetFiles`,
  `server/fastify/src/repository.ts:2536`, registered at
  `routes/save.ts:184`) calls `rmSync` in one loop with no per-file
  `try/catch`; the first deletion error strands all later files.
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
