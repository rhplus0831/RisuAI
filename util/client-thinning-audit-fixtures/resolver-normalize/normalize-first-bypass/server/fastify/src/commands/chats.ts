// Accepted shape for the chat pair: global chat-id normalization runs first,
// then the globally-addressed resolver runs against the normalized ids in the
// same scope. This mirrors the real command mutations in
// server/fastify/src/commands/chats.ts and routes/commands.ts.

interface CharacterRecord {
  chats?: Record<string, unknown>[]
}

interface ChatLocation {
  character: CharacterRecord
  chat: Record<string, unknown>
}

// Skipped by the audit: this IS the resolver.
export function requireChatLocation(
  characters: readonly CharacterRecord[],
  chatId: string,
): ChatLocation {
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

// Accepted: normalize global chat ids first, THEN resolve by global id.
export function renameChatByGlobalId(database: unknown, chatId: string, name: string): void {
  const characters = normalizeAllCharacterChats(database)
  const { chat } = requireChatLocation(characters, chatId)
  chat.name = name
}
