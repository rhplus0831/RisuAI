export interface ChatMetadataOwnerState {
  chatId: string
  lastMemory?: string
  autoTranslate: boolean
}

export interface ChatMetadataRecord {
  lastMemory?: unknown
  autoTranslate?: unknown
}

export function projectChatMetadata(chatId: string, chat: ChatMetadataRecord): ChatMetadataOwnerState {
  return {
    chatId,
    ...(typeof chat.lastMemory === 'string' ? { lastMemory: chat.lastMemory } : {}),
    autoTranslate: chat.autoTranslate === true,
  }
}

export function preferChatMetadataOwner(
  owner: ChatMetadataOwnerState | undefined,
  legacyFallback: ChatMetadataOwnerState | undefined,
): ChatMetadataOwnerState | undefined {
  return owner ?? legacyFallback
}
