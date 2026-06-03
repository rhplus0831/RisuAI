# Slice 8c: DELETE characters/:id → targeted-character-row

Status: implemented (`4009b65d`, audit fix `4685c6f7`). Reports
`targeted-character-row` / `writtenTables: ['characters', 'chat_hypa_v3', 'chats',
'messages', 'settings']` with no message hydration. Proven by
`commandFloorUnblock.test.ts`.

## Scope

Route `DELETE characters/:chatId` (`commands.ts:2620`) off the `hydrated` floor onto
`applyTargetedCommandMutation` (`targeted-character-row`). This was the deferred
Phase 8 follow-up; it reuses the 8b orphan-delete mechanism. Character deletion is
self-contained (no cross-table reference cleanup, unlike `DELETE modules/:id`), so
the targeted write is exactly the removed character + its chats + those chats'
message/hypa rows + the settings pointers.

## Target SQLite Tables

- `characters` — delete the character row and compact the positions of the rows
  after it so the table stays contiguous (`deleteCharacterRow`).
- `chats` — delete every chat row of the character in one statement
  (`deleteCharacterChats`).
- `messages`, `chat_hypa_v3` — each removed chat's rows
  (`deleteChatMessages` + `deleteChatHypaV3`, looped over the captured chat ids).
- `settings` — `ensureCharacterCollection` re-normalizes `characterOrder`
  (drops the removed id) and `currentChar` (clamps to the new length); persisted
  with `writeSettingsOnly`.
- `writtenTables` = `['characters', 'chat_hypa_v3', 'chats', 'messages',
  'settings']` (the `targeted-character-row` gate's full `maxTables`).

## Implementation

```ts
mutate(database, innerDb) {
  const target = ensureCharacterDatabaseObject(database)
  const characters = ensureCharacterCollection(target)
  const index = requireCharacterIndex(characters, characterId)
  const character = characters[index]                       // A4R3: persisted-state binding
  const removedChatIds = ensureCharacterChats(character).map((chat) => chat.id)
  characters.splice(index, 1)
  ensureCharacterCollection(target)                         // re-normalizes characterOrder/currentChar
  deleteCharacterRow(innerDb, characterId)                  // delete + position compaction
  deleteCharacterChats(innerDb, characterId)
  for (const chatId of removedChatIds) {
    deleteChatMessages(innerDb, chatId)
    deleteChatHypaV3(innerDb, chatId)
  }
  writeSettingsOnly(innerDb, extractSettings(target))
  return {
    event: { ...COMMAND_EVENT_CATALOG.characterDeleted, id: characterId },
    extra: { characterId, selectedCharacterId: selectedCharacterId(target, characters) },
  }
}
```

The captured chat id must be read from a `character`/`target` binding, not an index
expression, or the client-thinning audit's A4R3 (transitive command-path id
minting) rejects the `ensureCharacterChats` call.

## Normalization-Drop Decision

Validate-only via discard (Prerequisite 2): `ensureCharacterCollection` repairs
sibling character rows in memory, but only the removed row + settings are
persisted, so sibling repairs are discarded. Siblings are normalized at import.

## Protocol / Revision / Event Behavior

Unchanged: one revision bump, one `character.deleted` event (resource `character`),
same `{ revision, event, characterId, selectedCharacterId }` response. No
projection change.

## Done When

- Reports `targeted-character-row`, loads no messages, and `writtenTables` is the
  five-table set above.
- A regression test proves: the character row + every one of its chat rows + those
  chats' message/hypa rows are gone; positions are compacted; the sibling
  character and its rows keep their rowids; `characterOrder`/`currentChar` are
  re-normalized and persisted.
- `assertCommandMetricGate` passes (the `targeted-character-row` gate).

## Validation

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandFloorUnblock.test.ts`
- `pnpm api:test`
- `pnpm client-thinning:audit`
