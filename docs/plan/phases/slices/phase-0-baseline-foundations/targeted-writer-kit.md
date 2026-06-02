# Targeted Writer Kit

Status: planned. Realizes Prerequisite 1.

## Source Anchors

- `server/fastify/src/repository.ts` - `writeCharacterSelectionRows` (~375), the
  broad `replaceAll*` writers (`replaceAllSettingsInTable` ~207,
  `replaceAllCharactersInTable` ~309, `replaceAllCollectionsInTable` ~156), and
  `plugin_custom_storage` (DELETE+reinsert ~167-176).
- [`../../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Prerequisite 1 writer list.

## Scope

Add the small writer kit `repository.ts` is missing. Today it has only the broad
`replaceAll*` writers, the surgical message-store writers, and the bespoke
`writeCharacterSelectionRows`. Each new writer touches exactly its rows and
leaves every other rowid stable.

- `writeSettingsOnly(db, settings)` — one `UPDATE settings` (id=1).
- `writeSingleCharacterRow(db, id, character)` — `UPDATE characters WHERE id=?`.
- `writeSingleChatRow(db, id, chat)` — `UPDATE chats WHERE id=?` (no `chats`
  single-row writer exists anywhere today).
- `writeSingleCollectionTable(db, field, array)` — DELETE+reinsert one of the
  nine collection tables (for create/delete/reorder).
- `writeSingleCollectionRow(db, field, position, value)` — single-row
  `UPDATE ... WHERE position=?` (for pure field edits).
- `writePluginStorageKey(db, key, value)` / `deletePluginStorageKey(db, key)` —
  single-key upsert/delete on `plugin_custom_storage`.

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

- All seven writers exist with unit tests proving each touches exactly its rows.
- A rowid-stability unit test (`tableRowidsById` template) shows unrelated
  character/chat/collection rowids are unchanged after each writer.
- No existing broad-path caller's behavior changed (the kit is additive).

## Validation

- `pnpm api:test -- server/fastify/__tests__/db.test.ts server/fastify/__tests__/commands.test.ts`
- `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`
- `pnpm api:test`
