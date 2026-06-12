# Slice 8b: DELETE chats/:id → targeted-character-row

Status: implemented (`a83c474a`). Reports `targeted-character-row` /
`writtenTables: ['characters', 'chat_hypa_v3', 'chats', 'messages']` with no
message hydration; the new `deleteCharacterChatRow` writer removes the chat row
and the targeted message/hypa deletes clean the orphans. Proven by
`commandFloorUnblock.test.ts`.

## Scope

Route `DELETE chats/:chatId` (`commands.ts:2854`) off the `hydrated` floor onto
`applyTargetedCommandMutation` with `mutationPath:
TARGETED_MUTATION_PATHS.characterRow`. Drop the corpus-wide message hydration; do
the deleted chat's orphan cleanup with the existing targeted message/hypa deletes.

`DELETE characters/:id` is deliberately deferred (Non-Scope of Phase 8) but reuses
this slice's primitives — keep the orphan-cleanup helper keyed by chat id so a
later character-delete can loop its chat ids over it.

## Target SQLite Tables

- `chats` — delete the removed chat's row; re-stamp the parent character's
  remaining chat rows to contiguous positions (`writeCharacterChatRows`).
- `characters` — the parent character row (`writeSingleCharacterRow`), to persist
  any target-character normalization and keep the write semantically a
  character-row write.
- `messages`, `chat_hypa_v3` — the deleted chat's rows (`deleteChatMessages` +
  `deleteChatHypaV3`).
- `writtenTables` ⊆ `{characters, chats, messages, chat_hypa_v3}` (the
  `targeted-character-row` gate's `maxTables`; `settings` not touched).

## Implementation

- New writer in `repository.ts`: `deleteCharacterChatRow(db, chatId,
  characterId)` → `DELETE FROM chats WHERE id = ? AND character_id = ?`, records a
  `chats` table write. (Future `DELETE characters/:id` can iterate this.)
- Route mutate `(database, innerDb)`:

```ts
mutate(database, innerDb) {
  const characters = normalizeAllCharacterChats(database)
  const { character, chatIndex } = requireChatLocation(characters, chatId)
  const chats = ensureCharacterChats(character)
  if (chats.length <= 1) throw new ValidationError('Cannot delete the only chat for a character')
  chats.splice(chatIndex, 1)
  ensureCharacterChats(character)
  const characterId = character.chaId as string
  deleteCharacterChatRow(innerDb, chatId, characterId)
  writeCharacterChatRows(innerDb, characterId, chats)   // re-stamp remaining positions
  writeSingleCharacterRow(innerDb, characterId, character)
  deleteChatMessages(innerDb, chatId)
  deleteChatHypaV3(innerDb, chatId)
  return {
    event: { ...COMMAND_EVENT_CATALOG.chatDeleted, id: chatId, parentId: characterId },
    extra: { chatId, selectedChatId: selectedChatId(character) },
  }
}
```

`normalizeAllCharacterChats` runs on the message-free clone (no message bodies
needed); its global chat-id de-dup mutates siblings in memory only and is
discarded (validate-only via discard). The callback never reads message bodies, so
the route no longer hydrates messages.

## Normalization-Drop Decision

Validate-only via discard (Prerequisite 2): the global chat-id / folder-id de-dup
in `normalizeAllCharacterChats` is not persisted for siblings; only the target
character's rows are written. Siblings are normalized at import.

## Orphan-Cleanup Note (the unblock)

`syncChatMessages` previously cleaned the deleted chat's message rows as a side
effect of loading every message (no FK cascade, no GC). `deleteChatMessages`
(`messageStore.ts:389`) + `deleteChatHypaV3` (`messageStore.ts:90`) do this
directly. The regression test must assert the deleted chat leaves **no** rows in
`messages` (active + alternate/reroll rows — the `DELETE ... WHERE chat_id = ?`
covers all) and none in `chat_hypa_v3`.

## Protocol / Revision / Event Behavior

Unchanged: one revision bump, one persisted `chat.deleted` event (resource
`chat`), same `{ revision, event, chatId, selectedChatId }` response, same
"cannot delete the only chat" guard. No projection change.

## Done When

- `DELETE chats/:id` reports `mutationPath: targeted-character-row`, loads no
  messages (`loadMs` reflects the message-free load), and `writtenTables` ⊆
  `{characters, chats, messages, chat_hypa_v3}`.
- A regression test proves: the deleted chat's row is gone; its message + hypa
  rows are gone; the parent character's remaining chats and all other characters'
  rows keep their rowids; the returned `selectedChatId` matches the broad-path
  semantics.
- `assertCommandMetricGate` passes (the `targeted-character-row` gate).

## Validation

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandFloorUnblock.test.ts`
- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `pnpm api:test`
