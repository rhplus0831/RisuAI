# Backup restore orphans queued settings writes and masks restored values

## Summary

Restoring a backup rotates the database lineage. The outbox preparation step
then deletes every queued (lineage-mismatched) durable mutation row silently —
without publishing a settlement — while the settings bridge's in-memory attempt
state for those mutations stays `'queued'` forever. The orphaned attempt's
projection overlay keeps stamping the pre-restore value onto every subsequent
settings apply, so the restored value is never rendered for that key and the
write the UI still describes as queued is never persisted. The state lasts until
a page reload.

## Location

- `src/ts/server/pendingMutationOutbox.ts:531-539` — `preparePendingMutationOutbox`
  deletes lineage-mismatched mutation rows; line 538 deliberately excludes
  lineage mismatches from even the `discarded` count, and no settlement is
  published for them.
- `src/ts/server/settingsBridge.svelte.ts:116-154,1102-1127` — in-memory
  attempt/queue state and the retained-projection overlay that re-imposes the
  attempted value on settings applies.
- `src/ts/setting/utils.ts:135-154,289-296` — `clearDeferredSettingWrites`
  exists but has no production caller.
- `src/ts/server/backups.ts:154,351,620-630` — restore flows re-read resources
  after the server rotates lineage.
- `server/fastify/src/repository.ts:2105,2524,2568` — restore rotates
  `databaseLineage`.
- `src/ts/server/pendingMutationReplay.ts:16` and `src/ts/bootstrap.ts:258` —
  replay/settlement reconciliation happens only at bootstrap.

## Trigger

1. While the server is unreachable, change any settings value. The write is
   retained: the UI reports it queued, and the attempt phase is `'queued'`.
2. Back online in the same session, run "Load server backup" or "Load backup
   locally" from User settings.

## Expected behavior

The restored value becomes visible, and the queued write either replays or is
explicitly reported as dropped by the restore.

## Actual behavior

The rotated lineage makes outbox preparation delete the queued IndexedDB row
silently. No settlement is published, so the in-memory attempt stays `'queued'`
indefinitely. Its overlay stamps the pre-restore attempted value onto every
settings apply: the restored value never renders for that key, and the change
the UI called queued is never persisted. No error is shown; reload fixes it.

## Underlying cause

Lineage rotation discards durable rows without a terminal `'discarded'`
settlement, and nothing clears the bridges' in-memory attempt/queue state when
database ownership changes.

## Affected data flow

1. Toggle → optimistic projection + outbox row + `'queued'` attempt + overlay.
2. Restore → server rotates lineage → client re-prepares outbox → row deleted
   with no settlement.
3. Settings refresh applies restored values → overlay re-imposes the orphaned
   attempted value → UI shows neither the restored value nor an error.

## Severity and likely user impact

**Medium.** Confidence: high (row-deletion path verified directly; overlay
behavior per bridge code). Requires the offline precondition, but then produces
both silent data loss (the queued write) and a stale display (the masked
restored value) for the rest of the session.

## Recommended fix

Publish a terminal `'discarded'` settlement for every mutation id deleted on
lineage/epoch mismatch (via a registration hook to avoid an import cycle). On
database-ownership change, also clear in-memory pending state
(`clearDeferredSettingWrites()`, pending attempts, sparse queues) and surface a
single "queued changes were discarded by the restore" alert.

## Test gap

A bridge test that queues a settings write offline, simulates a lineage
rotation plus outbox preparation, and asserts the attempt settles as discarded,
the overlay is dropped, and the next settings apply renders the restored value.
