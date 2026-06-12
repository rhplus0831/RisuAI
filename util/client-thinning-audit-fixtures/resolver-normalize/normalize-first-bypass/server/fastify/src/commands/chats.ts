// Invariant: globally addressed chat mutations normalize all chat ids before
// resolving a chat by global id in the same scope.

interface CharacterRecord {
  chats?: Record<string, unknown>[]
}

interface ChatLocation {
  character: CharacterRecord
  chat: Record<string, unknown>
}

// Skipped by the audit: this IS the resolver.
export function requireChatLocation(characters: readonly CharacterRecord[], chatId: string): ChatLocation {
  for (const character of characters) {
    for (const chat of character.chats ?? []) {
      if (chat.id === chatId) return { character, chat }
    }
  }
  throw new Error(`Chat not found: ${chatId}`)
}

// Skipped by the audit: this IS the normalizer.
export function normalizeAllCharacterChats(database: unknown): CharacterRecord[] {
  return (database as { characters?: CharacterRecord[] }).characters ?? []
}

// Accepted: normalize global chat ids first, then resolve by global id.
export function renameChatByGlobalId(database: unknown, chatId: string, name: string): void {
  const characters = normalizeAllCharacterChats(database)
  const { chat } = requireChatLocation(characters, chatId)
  chat.name = name
}
