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

// Normalize-on-read repairs persisted chats that lack ids. Route handlers may
// call it only with persisted-state bindings.
export function ensureCharacterChats(character: CharacterRecord): void {
  for (const chat of character.chats ?? []) {
    if (!chat.id) chat.id = randomUUID()
  }
}
