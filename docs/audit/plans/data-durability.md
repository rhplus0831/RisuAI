# Fix plan: data-durability

Scope and evidence are current as of 2026-07-23 on branch `fastify`. The implementation session must preserve these
cross-cutting invariants:

- Keep every destructive repository transaction body synchronous. In particular, the import hook in
  `server/fastify/src/routes/save.ts:538-541` and the restore loop in
  `server/fastify/src/repository.ts:3244-3274` must gain no `await`.
- Do not alter restore-journal ordering. `recoverInterruptedRestoreSwaps` must still run before the legacy import,
  routes, and workers (`server/fastify/src/app.ts:170-179`).
- Give every new minimal `.risu` import fixture at least one recognized core key, normally `characters: []`, because
  `server/fastify/src/risuSave/importSnapshot.ts:230-234` rejects metadata-only/empty payloads with
  `risusave_empty_database`.

## Decisions required (user input)

The recommendations below form one coherent default. Confirm or override each choice before implementation.

1. **`generation_finalization_retries`: which round trips should preserve it?**

   - **Option A — backup-only (recommended):** add it to the server-backup restore contract, but keep it out of
     portable `.risu`, bundle, and legacy local-backup exports. A server backup is a point-in-time recovery image, so a
     queued generated response that had not yet reached `messages` must remain recoverable with its matching chat.
     Portable import rotates lineage and is content transfer, not process resumption; carrying pending/terminal work to
     another installation could replay stale work or diagnostics there.
   - **Option B — portable-export + backup:** maximizes queue retention, but makes a portable content artifact execute
     old operational work after import and can apply an old target snapshot in a new runtime.
   - **Option C — deliberately excluded:** treats the queue as wholly disposable. This loses an assistant response that
     was generated but still pending finalization at snapshot time. Worse, the current allowlist restore leaves the
     pre-restore live queue in place, so work from the replaced database can be retried against the restored one unless
     restore explicitly clears it.

2. **`memory_legacy_summary_tombstones`: which round trips should preserve it?**

   - **Option A — portable-export + backup (recommended):** preserve the rows in server backup/restore and encode a
     validated, namespaced representation in every portable export. These rows are durable semantic deletion state,
     not a cache: boot repeatedly rebuilds legacy summaries from retained `chat.hypaV3Data`, and
     `server/fastify/src/memoryLegacyImport.ts:85-93` consults the tombstone before doing so.
   - **Option B — backup-only:** protects server snapshots but leaves `.risu`/bundle/local-backup migrations lossy.
     Importing such an artifact and restarting can silently resurrect a summary the user explicitly deleted.
   - **Option C — deliberately excluded:** accepts that resurrection. This conflicts with the table's documented DDL
     purpose at `server/fastify/src/db.ts:464-479` and is not recommended.

3. **`push_subscriptions`: should snapshot replacement own these rows?**

   - **Option A — deliberately excluded, with an explicit contract (recommended):** do not export or allowlist the
     table. Subscriptions contain per-browser endpoint/key material and are bound to the current origin/device and the
     server's VAPID identity. The VAPID key file is deliberately outside backups
     (`server/fastify/src/pushNotifications.ts:6,137-151`), so copied rows can be unusable on another installation.
     Keeping current live registrations across a same-server database restore also avoids reviving endpoints that were
     unsubscribed after the snapshot. Document and test that server restore preserves the live table rather than
     replacing it.
   - **Option B — backup-only:** can recover registrations on the same server while its VAPID key file survives, but an
     old restore can discard newly registered devices or revive stale endpoints. It is not portable to a new server.
   - **Option C — portable-export + backup:** transfers endpoint/auth secrets to another installation, where the origin
     and VAPID keys may not match. Do not choose this without a separate key-identity migration design.

   The consequence of the recommended exclusion is limited to notification setup: if the live subscription table
   itself is lost or the app is moved to a new origin, users must re-enable/re-register push notifications. Chat and
   other user-authored content are unaffected.

4. **D-8 strict-hydration failure UX.**

   - **Option A — abort and show the existing error alert (recommended):** call strict hydration once; if it throws,
     create no file/clipboard payload, show `alertError(error)`, and let the user invoke Export again. This matches the
     dataset and export-all loud-failure behavior and never presents a partial artifact as success.
   - **Option B — retry once automatically, then alert and abort:** may hide a transient read failure, but adds another
     request/race window and still needs the same final abort. There is no evidence that an immediate retry fixes the
     stale/non-hydrated state, so it should not be the default.

## Item A-5 — backup allowlist round-trip omissions

### Current behavior and root cause

- `buildRepositoryRisuSaveExportSnapshot` hydrates messages, then
  `buildRisuSaveExportSnapshotFromPersisted` returns only normalized `persisted.database`
  (`server/fastify/src/risuSave/exportSnapshot.ts:27-40`). The three SQLite-only tables therefore have no portable
  representation. The same snapshot builder feeds ordinary `.risu`, zip bundle, and original-Risu `.bin` exports via
  `server/fastify/src/routes/save.ts:234-350`.
- Physical server backups contain the whole online-copied `risu.db`, but restore deletes/copies only
  `SQLITE_BACKUP_TABLES` (`server/fastify/src/repository.ts:2603-2635,3246-3269`). An omitted table is not restored to the
  snapshot: its current live rows remain. This is especially unsafe for finalization retries because post-backup work
  can survive a database rollback.
- The finalization table is a durable retry queue for generated messages and chat-variable mutations
  (`server/fastify/src/generationFinalizationRetry.ts:69-90,93-134`). Pending rows are retried at boot and every five
  seconds (`server/fastify/src/app.ts:326-360`); terminal rows are retained for seven days. It is operational state, but
  a pending row can hold the only durable copy of a completed generation.
- Tombstones are written by an `AFTER DELETE` trigger and prevent the repeatable legacy Hypa V3 boot backfill from
  recreating deleted summaries (`server/fastify/src/db.ts:464-479`,
  `server/fastify/src/memoryLegacyImport.ts:85-119`). Current import replacement explicitly deletes the tombstone table
  before backfill (`memoryLegacyImport.ts:71-82`), so a portable import cannot preserve the deletion.
- Push rows store browser subscription endpoint/auth material (`server/fastify/src/pushNotifications.ts:62-75,167-191`).
  The current server/VAPID identity sends to and prunes those endpoints (`pushNotifications.ts:332-373`); they are not
  application content.

### Proposed fix

Proceed with the recommended dispositions unless the decisions above are overridden.

1. **Make the server-backup table policy explicit.**

   - Add `generation_finalization_retries` and `memory_legacy_summary_tombstones` to
     `SQLITE_BACKUP_TABLES` in `server/fastify/src/repository.ts:2609-2635`. Do not add `push_subscriptions`.
   - Rewrite the allowlist comment at `repository.ts:2603-2608`: it is not an exhaustive list of every server DDL table.
     Define it as the tables replaced by a point-in-time content/recovery restore, and name deliberately live
     operational exclusions (`push_subscriptions`, `database_metadata`, and `command_mutation_receipts`) with their
     reasons. This prevents a future audit from interpreting the push omission as accidental.
   - Preserve the current synchronous `BEGIN`/delete/copy/lineage-rotation critical section. The newly allowlisted
     tables must be cleared when an old/legacy backup lacks them, just like other optional tables.
   - Do not rely on `INSERT INTO main.generation_finalization_retries SELECT * ...` for historical backups. The table
     gained `target_snapshot_json` in schema v18 and `alternate_messages_json` in v20
     (`server/fastify/src/db.ts:192-220`). Add a small table-specific copy path that inspects the attached backup's
     columns and inserts an explicit current column list, supplying `NULL` for a missing target snapshot and `'[]'` for
     missing alternates. A pre-v8 backup with no queue table produces an empty restored queue. Current-shape backups
     preserve pending and terminal rows exactly.
   - Keep the tombstone entry after `memory_summaries` in the restore order. Deleting legacy summaries fires the
     tombstone trigger; subsequently clearing/restoring the tombstone table is what makes the final state equal the
     selected snapshot.

2. **Add a portable tombstone metadata contract without polluting `Persisted.database`.**

   - Add a small shared codec module, suggested path
     `server/fastify/src/risuSave/portableMetadata.ts`, with one reserved root key, suggested
     `__risuServerData`, and versioned shape:

     ```ts
     {
       version: 1,
       memoryLegacySummaryTombstones: Array<{
         summaryId: string
         chatId: string
         deletedAt: string
       }>
     }
     ```

     Validate that the metadata is a plain object of the supported version, each field is a non-empty string, and
     `summaryId` values are unique. Malformed present metadata must reject the import with `ValidationError`; absent
     metadata means an older portable artifact and yields an empty tombstone list.
   - In `server/fastify/src/memoryLegacyImport.ts`, add typed synchronous list/insert helpers for the three SQLite
     columns. Extend `replaceLegacyHypaV3MemoryRowsInTransaction` to accept imported tombstones, delete the old memory
     families as it does now, insert validated tombstones, and only then run `backfillLegacyHypaV3MemoryRows`. This
     ordering makes the first import backfill honor the deletions; do not defer it until boot.
   - Extend `RisuSaveExportSnapshot` in `server/fastify/src/risuSave/exportSnapshot.ts` with the portable metadata,
     loaded from SQLite by `buildRepositoryRisuSaveExportSnapshot`. Let the builder used by bundle and local-backup
     routes accept the already-loaded metadata too. At encoding time, merge the reserved metadata key into a cloned
     root database object so both RISUSAVE-block and legacy envelopes carry the same representation. Do not add the key
     to the ordinary repository `Persisted` interface or bootstrap database.
   - In `server/fastify/src/risuSave/importSnapshot.ts`, extract and validate the reserved key before database default
     normalization, remove it from the domain object, and return it beside `database`. Keep it out of
     `RECOGNIZED_IMPORT_DATABASE_KEYS`, so metadata by itself cannot bypass `risusave_empty_database`. Apply the same
     extraction to multipart and JSON compatibility imports for format parity.
   - Thread the decoded tombstones through all replacement paths in `server/fastify/src/routes/save.ts:97-195` into
     `applyImportedDatabase`, including ordinary `.risu`, zip bundle, and Fastify-produced legacy local backups. Restore
     them in the existing synchronous `beforeRevision` hook alongside legacy-memory replacement and staged asset
     metadata. Original/older artifacts have no metadata and retain today's import behavior.
   - Leave `generation_finalization_retries` and `push_subscriptions` out of the portable metadata. Do not broaden this
     item into exporting every memory/operational table.

3. **Document the three dispositions.**

   Update `docs/structure/assets-and-saves.md` in the eventual fix to replace the current ambiguous omission paragraph
   with a table that states: finalization retries are server-backup-only; legacy-summary tombstones are portable and
   server-backup state; push subscriptions remain live origin/device state and VAPID keys are outside backup. Mark A-5
   resolved in `docs/audit/data-durability.md` only after all round-trip tests pass.

### Alternatives considered

- Adding all three tables to every format conflates content, recoverable in-flight work, and origin-bound credentials.
- Merely adding tombstones to the server allowlist does not fix portable resurrection.
- Removing tombstoned entries from `chat.hypaV3Data` during export would avoid one resurrection path, but mutates the
  historical chat projection and no longer round-trips the actual deletion ledger. A namespaced metadata record is
  explicit and lossless.
- Clearing (rather than restoring) every finalization retry on server restore prevents stale replay but discards the
  snapshot's only copy of a generated response. Backup-only restoration keeps queue and domain state from the same
  point in time.

### Files to touch

- `server/fastify/src/repository.ts` — backup allowlist, documented exclusions, old-queue-schema restore projection.
- `server/fastify/src/risuSave/portableMetadata.ts` (new) — versioned portable metadata types and validation.
- `server/fastify/src/risuSave/exportSnapshot.ts` — load and encode tombstones for all envelope types.
- `server/fastify/src/risuSave/importSnapshot.ts` — extract/strip/return validated metadata without weakening the empty
  database guard.
- `server/fastify/src/memoryLegacyImport.ts` — synchronous tombstone list/restore-before-backfill helpers.
- `server/fastify/src/routes/save.ts` — thread metadata through `.risu`, bundle, local-backup, and JSON import paths.
- `server/fastify/__tests__/backups.test.ts` — snapshot replacement/preservation matrix and old queue schema coverage.
- `server/fastify/__tests__/risuSaveCodec.test.ts` — block/legacy metadata encoding, decoding, validation, and stripping.
- `server/fastify/__tests__/risuSaveExportRoute.test.ts`,
  `server/fastify/__tests__/risuSaveImportRoute.test.ts`, and
  `server/fastify/__tests__/risuSaveBundleImportRoute.test.ts` — route-level portable variants.
- `server/fastify/__tests__/memoryLegacyImport.test.ts` — deletion remains deleted after export/import and target restart.
- `docs/structure/assets-and-saves.md` and `docs/audit/data-durability.md` — final behavior and closure evidence.

### Test plan

1. In `backups.test.ts`, seed snapshot-A rows for a finalization retry, a legacy tombstone, and a push subscription;
   create a backup; replace each with snapshot-B/live rows; restore A. Assert the retry and tombstone equal A while the
   push subscription deliberately remains B. Restart the app and verify the restored tombstone still prevents legacy
   backfill. Disable the finalization sweep in this test or use a controlled row so the timer cannot consume the fixture.
2. Add an old-backup compatibility case whose attached queue table lacks `target_snapshot_json` and
   `alternate_messages_json`. Restore must succeed, default those fields, and retain the other retry payload. Also cover
   a backup with no retry/tombstone tables: restore succeeds and clears current rows for the two snapshot-owned tables.
3. In codec tests, parameterize RISUSAVE-block and legacy envelopes. Assert the reserved metadata survives encode/decode,
   is removed from `decoded.database`, malformed/duplicate rows fail closed, and a payload containing only metadata is
   rejected as `risusave_empty_database`. Include `characters: []` in every otherwise-minimal valid fixture.
4. End-to-end: import a legacy chat with two Hypa summaries, delete one through the memory API so the trigger creates a
   tombstone, export, import into a fresh data directory, then restart. The deleted summary must stay absent and the
   other summary must remain. Run this for default `.risu`; use codec/route parameterization to cover legacy `.risu`, zip
   bundle, and Fastify local-backup construction without duplicating the whole scenario four times.
5. Assert bootstrap/settings never expose or persist `__risuServerData`. Assert portable artifacts do not contain queue
   rows, push endpoints, or push auth keys.

### Risks

- A generic `SELECT *` copy makes old queue-bearing backups unrestorable after schema additions; the explicit projection
  is required, not optional polish.
- Restored pending retries can run immediately after the synchronous restore finishes. That is intended only because
  queue and chats come from the same snapshot; tests must prove post-snapshot queue rows were removed.
- A reserved portable key can collide with arbitrary legacy root data. A namespaced, versioned key plus strict validation
  makes the ownership explicit; stripping it before domain normalization prevents it leaking into settings.
- Tombstones can refer to chats absent from an artifact. They are harmless ledger rows and should be retained rather
  than filtered heuristically; future matching legacy data must not resurrect unexpectedly.
- Never include VAPID private keys or subscription auth material in portable output while implementing this item.

## Item D-8 — single-chat export serializes non-strictly-hydrated shells

### Current behavior and root cause

`exportChat` captures stable character/chat ids, waits for the format dialogs, then calls
`hydrateChatMessages(stableTarget.chatId)` without strict mode (`src/ts/characters.ts:458-484`). It immediately serializes
the resolved `chat` for JSON at `characters.ts:504-519`, and the TXT/HTML branches likewise iterate `chat.message`. The
hydrator throws on an incomplete load only when `{ strict: true }` is requested
(`src/ts/server/chatMessageHydration.svelte.ts:550-556`). A read failure can therefore leave a shell/stale message array
and still create an apparently valid but incomplete artifact. The authoritative database is not modified.

### Proposed fix

- Change the call at `src/ts/characters.ts:482` to
  `await hydrateChatMessages(stableTarget.chatId, { strict: true })` before re-resolving or serializing the target.
- Use the existing outer `try/catch` at `characters.ts:661-663` as the loud failure boundary. On strict hydration error,
  `alertError(error)` is what the user sees; no download, clipboard write, or success alert occurs. Do not add an
  automatic retry. The user can explicitly retry the export, which starts from a fresh stable-target resolution.
- Preserve the existing cancellation and target-disappearance behavior: cancelling a dialog or a chat disappearing
  during an await remains a quiet no-op. That is distinct from a present target whose hydration failed.
- No language file change is needed for the recommended path because the app already presents the hydrator error through
  the shared error alert, matching `src/ts/storage/exportAsDataset.ts:7-34` and export-all at
  `src/ts/characters.ts:1038-1061`.

### Alternatives considered

- A one-shot automatic retry adds latency and another stale-target window without a known recovery signal. If product
  later wants this, put it in the hydration layer with bounded retry/telemetry rather than only one export format.
- Checking only `chat.message.length` is invalid: an honestly empty chat and an unhydrated shell can both contain `[]`.
  The hydrator's `hydratedChatIds` proof is the correct gate.

### Files to touch

- `src/ts/characters.ts` — request strict hydration; retain the existing catch/alert behavior.
- `src/ts/characters.exportChat.test.ts` — strict-call and loud-abort regressions.
- `docs/audit/data-durability.md` — mark D-8 resolved after focused tests pass.

### Test plan

1. Update current success/race expectations at `src/ts/characters.exportChat.test.ts:149-184,230-249` to require
   `hydrateChatMessages(chatId, { strict: true })`.
2. Add a strict-hydration rejection test: make the mock reject with a sentinel `Error`, invoke JSON export, and assert
   `alertError` receives that exact error while `downloadFile`, `navigator.clipboard.write`, and `alertNormal` are not
   called. Because hydration precedes every serialization branch, one rejection case protects all formats; optionally
   parameterize format selection if branch ordering later changes.
3. Keep the existing cancellation, stable-id/reordering, target-vanished, and export-all strict tests green.

### Risks

- This intentionally turns a previously silent partial export into a visible abort, so users on an unavailable server
  will get no artifact. That is the required loud-failure policy.
- Do not move hydration before format/persona dialogs: cancelled exports should continue to avoid unnecessary full-chat
  reads.

## Item A-1.2 — bundle-import asset cleanup loop aborts on first `rmSync` failure

### Current behavior and root cause

`persistStagedAssetsInTransaction` copies each new asset into the live asset directory and records whether the path
pre-existed (`server/fastify/src/repository.ts:2483-2533`). If the surrounding import transaction fails,
`applyImportedDatabase` invokes the rollback callback (`server/fastify/src/routes/save.ts:516-545`), registered by the
bundle route at `routes/save.ts:184-195`. `cleanupCopiedStagedAssetFiles` performs every `rmSync` in one unguarded loop
(`repository.ts:2536-2542`). The first filesystem error stops the loop, strands every later new file, and can replace the
original import error because the callback throws before line 545 rethrows it.

### Proposed fix

- Give each `!existedBefore` entry its own synchronous `try/catch`; always continue to later files. Never remove an entry
  whose `existedBefore` flag is true.
- Have `cleanupCopiedStagedAssetFiles` return a structured result, for example:

  ```ts
  interface StagedAssetCleanupResult {
    attempted: number
    removed: number
    failures: Array<{ file: string; error: unknown }>
  }
  ```

  `force: true` still treats an already-missing path as success. The helper must not throw for an individual deletion
  failure.
- In the route's `onImportRollback` callback, inspect the result and call `req.log.warn` exactly once when failures are
  non-empty. Log `failureCount`, `attempted`, `failedFiles`, and one `AggregateError` built from the captured errors with
  a stable message such as `Bundle-import rollback could not remove some staged asset files`. Do not log asset contents.
  One aggregate warning is easier to alert on than one warning per large bundle.
- Keep cleanup and logging synchronous and ensure the callback returns normally so `applyImportedDatabase` rethrows the
  original import failure. The failed files remain unreferenced because the SQLite transaction rolled back; the warning
  truthfully records the residual manual-cleanup risk.

### Alternatives considered

- Wrapping the whole loop in one `try/catch` preserves the original error but still skips later files.
- Retrying `rmSync` inline can help transient failures but does not replace per-file isolation, and unbounded retry would
  extend a destructive request unpredictably. A retry policy is outside this item.
- Async `Promise.allSettled(fs.promises.rm(...))` would violate the synchronous rollback-hook/transaction discipline and
  is unnecessary for this bounded fix.

### Files to touch

- `server/fastify/src/repository.ts` — per-file isolation and structured cleanup result.
- `server/fastify/src/routes/save.ts` — one aggregate request warning without masking the import error.
- `server/fastify/__tests__/risuSaveBundleImportRoute.test.ts` — rollback fault injection and logging/continuation
  coverage. A small dedicated helper test may be added if mocking `rmSync` is clearer there.
- `docs/audit/data-durability.md` — mark A-1.2 resolved after the injected-failure test passes.

### Test plan

1. Unit-level fault injection: provide one `existedBefore: true` entry and at least three new-file entries; mock
   `fs.rmSync` to fail for the first new file and succeed for the later ones. Assert the pre-existing path was skipped,
   every eligible later path was attempted, counts are correct, and only the failed path appears in `failures`.
2. Route-level rollback: build a bundle with at least two staged assets and inject a command-event failure after the
   files are copied (the trigger pattern in `server/fastify/__tests__/backups.test.ts:22-35` is reusable). Make removal
   of the first live file fail. Assert the second file is still removed, rolled-back asset metadata/domain changes are
   absent, the response/original thrown cause remains the injected import failure rather than the cleanup failure, and
   `req.log.warn` receives exactly one aggregate warning listing only the failed file.
3. Keep successful bundle import and rollback-with-no-cleanup-failure tests green; they must emit no cleanup warning.

### Risks

- A file whose deletion genuinely fails remains on disk. This change cannot guarantee removal; it guarantees best-effort
  cleanup of every candidate plus one observable warning.
- Preserve `existedBefore` exactly. Deleting a pre-existing content-addressed file during rollback would be real user-data
  loss even if its metadata transaction rolled back.
- The logger must not throw or be awaited from the rollback callback; otherwise it can again mask the primary error.

## Suggested execution order

1. Confirm the four decisions above. Record the table matrix in code comments before changing behavior.
2. Implement A-5 server-backup ownership first, including the old queue-schema projection and backup matrix test.
3. Implement the A-5 portable tombstone codec and synchronous import restoration, then run codec, route, restart, and
   no-secret assertions.
4. Implement A-1.2 and its injected cleanup-failure test while the bundle-import tests are already in focus.
5. Implement D-8 and its focused frontend test; it is independent of the backend changes.
6. Run the smallest focused checks during each slice:

   ```sh
   pnpm exec vitest run --config server/fastify/vitest.config.ts \
     server/fastify/__tests__/backups.test.ts \
     server/fastify/__tests__/risuSaveCodec.test.ts \
     server/fastify/__tests__/risuSaveExportRoute.test.ts \
     server/fastify/__tests__/risuSaveImportRoute.test.ts \
     server/fastify/__tests__/risuSaveBundleImportRoute.test.ts \
     server/fastify/__tests__/memoryLegacyImport.test.ts
   pnpm exec vitest run src/ts/characters.exportChat.test.ts
   pnpm check:server
   pnpm format:check
   ```

7. Run `pnpm test:all` before handoff if the environment supports the browser-smoke lane. Only then update
   `docs/structure/assets-and-saves.md` and close A-5, D-8, and A-1.2 in `docs/audit/data-durability.md` with new line
   evidence. Recheck that restore recovery still precedes legacy import/routes and that no destructive transaction body
   contains an `await`.
