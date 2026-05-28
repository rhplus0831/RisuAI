import { randomUUID } from 'node:crypto'

interface CharacterRecord {
  chats?: { id?: string }[]
}

// Validate-only resolver: looks up persisted state by a validated id and never
// mints from request-derived data.
export function requireCharacter(chatId: string): CharacterRecord {
  if (!chatId) throw new Error('chatId required')
  return { chats: [] }
}

// Normalize-on-read: repairs persisted state by minting ids for chats that lack
// them. The `ensure*` prefix marks it non-propagating; A4R3 accepts it when a
// route handler calls it with a persisted-state binding (`character`).
export function ensureCharacterChats(character: CharacterRecord): void {
  for (const chat of character.chats ?? []) {
    if (!chat.id) chat.id = randomUUID()
  }
}
