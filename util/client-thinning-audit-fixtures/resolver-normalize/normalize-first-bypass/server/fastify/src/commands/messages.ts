// Accepted shape for the message pair: global message-id normalization runs
// first, then the globally-addressed resolver runs against the normalized ids in
// the same scope. This mirrors the real command mutations in
// server/fastify/src/commands/messages.ts and routes/commands.ts.

interface CharacterRecord {
  chats?: Record<string, unknown>[]
}

interface MessageLocation {
  chat: Record<string, unknown>
  messageIndex: number
}

// Skipped by the audit: this IS the resolver.
export function requireMessageLocation(
  characters: readonly CharacterRecord[],
  messageId: string,
): MessageLocation {
  for (const character of characters) {
    for (const chat of character.chats ?? []) {
      const messages = (chat.message ?? []) as Record<string, unknown>[]
      const messageIndex = messages.findIndex((message) => message.chatId === messageId)
      if (messageIndex !== -1) return { chat, messageIndex }
    }
  }
  throw new Error(`Message not found: ${messageId}`)
}

// Skipped by the audit: this IS the normalizer.
export function normalizeAllChatMessages(database: unknown): CharacterRecord[] {
  return (database as { characters?: CharacterRecord[] }).characters ?? []
}

// Accepted: normalize global message ids first, THEN resolve by global id.
export function editMessageByGlobalId(database: unknown, messageId: string, data: string): void {
  const characters = normalizeAllChatMessages(database)
  const { chat, messageIndex } = requireMessageLocation(characters, messageId)
  const messages = chat.message as Record<string, unknown>[]
  messages[messageIndex] = { ...messages[messageIndex], data, chatId: messageId }
}
