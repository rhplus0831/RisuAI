# Targeted Writer Kit

Status: implemented (2026-06-03). Realizes Prerequisite 1.

## Source Anchors

- `server/fastify/src/repository.ts` - `writeCharacterSelectionRows` (~375), the
  broad `replaceAll*` writers (`replaceAllSettingsInTable` ~207,
  `replaceAllCharactersInTable` ~309, `replaceAllCollectionsInTable` ~156), and
  `plugin_custom_storage` (DELETE+reinsert ~167-176).
- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Prerequisite 1 writer list.

## Scope

Implemented writer inventory. Phase 0 added the targeted kit beside the broad
`replaceAll*` writers, the surgical message-store writers, and the bespoke
`writeCharacterSelectionRows`; later phases added the chat-cascade/fork and
bulk-plugin-storage helpers they needed. Each targeted writer touches exactly its
rows and leaves unrelated rowids stable.

- `writeSettingsOnly(db, settings)` — one `UPDATE settings` (id=1).
- `writeSingleCharacterRow(db, id, character)` — `UPDATE characters WHERE id=?`.
- `writeSingleChatRow(db, id, chat)` — `UPDATE chats WHERE id=?`.
- `writeCharacterChatRows(db, characterId, chats)` /
  `insertCharacterChatRow(db, characterId, chat)` — scoped chat-row cascade and
  fork helpers added by Phase 3.
- `writeSingleCollectionTable(db, field, array)` — DELETE+reinsert one of the
  nine collection tables (for create/delete/reorder).
- `writeSingleCollectionRow(db, field, position, value)` — single-row
  `UPDATE ... WHERE position=?` (for pure field edits).
- `writePluginStorageKey(db, key, value)` / `deletePluginStorageKey(db, key)` /
  `replacePluginStorage(db, entries)` — key and bulk writes on
  `plugin_custom_storage`.

## Implementation Scope

- Source files: `server/fastify/src/repository.ts` (and its writer barrel if the
  collection writers are re-exported).
- Each writer is a pure SQLite write helper; it does not own revision/event
  emission (that stays in the mutation helper / route).
- `writeSingleCollectionTable` reuses the existing per-table column mapping the
  broad `replaceAllCollectionsInTable` uses for one field, not all nine.
- `writeSettingsOnly` writes the full settings row column set so it stays a
  drop-in for the settings-row half of `writeCharacterSelectionRows`.
- Non-scope: message-store writers (already surgical), the broad `replaceAll*`
  writers (kept for the unmigrated complex paths and `writeDatabase:true`).

## Protocol Behavior

- A writer performs only its `UPDATE`/`DELETE`+`INSERT`; the caller wraps it in
  the same `BEGIN IMMEDIATE` transaction as the revision bump and command event.
- No writer touches the message store, `hypaV3Data`, or alternates.

## Done When

- [x] The Phase 0 writers exist in `repository.ts` (`writeSettingsOnly`,
  `writeSingleCharacterRow`, `writeSingleChatRow`, `writeSingleCollectionTable`,
  `writeSingleCollectionRow`, `writePluginStorageKey`, `deletePluginStorageKey`)
  with unit tests (`__tests__/repositoryWriterKit.test.ts`) proving each touches
  exactly its rows; later phases added scoped helpers such as
  `writeCharacterChatRows`, `insertCharacterChatRow`, and `replacePluginStorage`.
- [x] A rowid-stability unit test (the `position→rowid` / `id→rowid` snapshot
  template) shows unrelated character/chat/collection rowids are unchanged after
  each writer.
- [x] No existing broad-path caller's behavior changed (the kit is additive; the
  single-row writers strip `chats` / `message` / `hypaV3Data` to match the
  storage contract, and each writer reports its table to the mutation-range
  metric).

## Validation

- `pnpm api:test server/fastify/__tests__/repositoryWriterKit.test.ts` (filter:
  `pnpm api:test repositoryWriterKit`)
- `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`
- `pnpm api:test`
