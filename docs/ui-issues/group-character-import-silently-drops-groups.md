# Group-character import silently drops groups

## Summary

Loading a pre-migration local backup that contains group-character rows reports success, but server normalization removes every row with `type === 'group'` before replacing the database. The import response does not count or identify those removed rows, and the frontend discards the import report and tells the user that the backup loaded successfully.

## Location

- `src/lib/Setting/Pages/UserSettings.svelte:129-139`
- `src/ts/storage/backup.ts:72-96`
- `src/ts/server/backups.ts:268-365`
- `server/fastify/src/routes/save.ts:138-192,479-511`
- `server/fastify/src/risuSave/importSnapshot.ts:172-207`
- `server/fastify/src/databaseDefaults.ts:173-180,494-505`
- `src/ts/storage/database.svelte.ts:2412-2417`
- `src/lib/Others/AlertComp.svelte:802-870`

## Trigger

1. Choose **Load Backup Locally** in User Settings.
2. Select an original Risu `.bin` backup or a `.risu.zip` bundle whose database contains one or more group characters and group chat histories.
3. Confirm the replacement import.

## Expected behavior

A backup restore should be lossless. If Fastify cannot support group characters, it must detect them before replacing the active database and either reject the import with a clear explanation or explicitly quarantine/report the unsupported rows and require informed confirmation. It must not claim a complete restore after silently deleting data.

## Actual behavior

The non-group portion of the backup replaces the database, all group rows and the chats owned by those rows disappear, and the UI reports “Local backup loaded.” The response's existing `unsupportedReferenceCount` does not include filtered groups, and `importServerBundle` does not expose the import report to the UI in any case.

## Underlying cause

`decodeRisuSaveImportSnapshot` routes the decoded database through `normalizeImportDatabaseShape`, which calls `normalizeDatabaseDefaults`. `normalizeCharacters` then implements group removal as an unconditional filter:

```ts
database.characters = characters.filter((character) => isRecord(character) && character.type !== 'group')
```

The normalized object is passed to `applyImportedDatabase`, which transactionally replaces the character/chat/message tables. By that point there is no record that groups were present. Both the `.risu` and bundle responses report only incomplete chat-generation settings and unsupported asset references, not removed character types. The client-side compatibility `setDatabase` path has the same filter, so bypassing this server normalization would not make the fallback lossless.

The character creation modal also no longer offers the pre-migration Create Group action, confirming that the domain feature was removed from the UI, but no corresponding migration/rejection policy protects existing data.

## Affected data flow

1. **UI interaction:** `UserSettings` invokes `loadBackupFromDevice` after two replacement confirmations.
2. **Client request:** `importServerBundle` uploads the selected file to `POST /api/v1/import/bundle`.
3. **Server decode:** The route decodes the bundle/local-backup database into a RisuSave snapshot.
4. **Server normalization:** `normalizeDatabaseDefaults` removes every group row before persistence.
5. **Server persistence:** `applyImportedDatabase` replaces the authoritative SQLite database with only the surviving rows and bumps database ownership/revision.
6. **Server acknowledgement:** The route returns success; its import report contains no removed-group count or payload.
7. **Client synchronization:** The client adopts the replacement lineage and refreshes all resources, so the group rows disappear from the displayed character list.
8. **UI acknowledgement:** `loadBackupFromDevice` displays “Local backup loaded,” with no warning that group chat data was omitted.

## Severity and user impact

**Critical.** A destructive restore operation silently omits a whole user data type and its conversations while presenting a success result. The source backup still exists, but the active database has been replaced and users may not discover the omission until after making further changes.

## Recommended fix

The durable fix is to model group characters, membership, group settings, and group chats in the Fastify domain and import them losslessly.

Until that is implemented:

1. Scan for group rows before any replacement transaction.
2. Reject the import without changing the live database, returning the group count and stable identifiers/names.
3. If partial import is intentionally offered, require an explicit UI confirmation and export/quarantine every omitted row so it remains recoverable. Include omissions in a structured import report that the client must display.
4. Remove the unconditional client and server filters; unsupported data should fail validation or follow an explicit migration policy, never vanish as a normalization default.

## Test coverage gap

Add `.bin`, `.risu.zip`, and direct RisuSave fixtures containing a group with chats/messages. Assert that import either preserves all rows byte-for-byte or fails before revision/lineage/table replacement. Also assert that the frontend surfaces the structured unsupported-group result and never displays a generic success acknowledgement for a lossy import.
