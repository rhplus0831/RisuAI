// Invariant: globally addressed message mutations normalize all message ids
// before resolving a message by global id in the same scope.

interface CharacterRecord {
  chats?: Record<string, unknown>[]
}

interface MessageLocation {
  chat: Record<string, unknown>
  messageIndex: number
}

// Skipped by the audit: this IS the resolver.
export function requireMessageLocation(characters: readonly CharacterRecord[], messageId: string): MessageLocation {
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

// Anti-pattern: resolves a message by its global id without first running global
// message-id normalization in the same scope.
export function editMessageByGlobalId(database: unknown, messageId: string, data: string): void {
  const characters = (database as { characters?: CharacterRecord[] }).characters ?? []
  const { chat, messageIndex } = requireMessageLocation(characters, messageId)
  const messages = chat.message as Record<string, unknown>[]
  messages[messageIndex] = { ...messages[messageIndex], data, chatId: messageId }
}
