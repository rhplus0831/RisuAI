import { v4 } from 'uuid'
import type { Chat } from './storage/database.svelte'
import { ensureClientLorebookEntryIds } from './server/lorebookOwner.svelte'

interface RekeyClonedChatOptions {
  createId?: () => string
  pruneDanglingReferences?: boolean
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Give a cloned chat its own identity and rewrite every schema-defined message
 * reference to the corresponding cloned row. A branch can pass a sliced clone;
 * references to rows outside that slice are pruned by default.
 */
export function rekeyClonedChat(
  chat: Chat,
  { createId = v4, pruneDanglingReferences = true }: RekeyClonedChatOptions = {},
): Map<string, string> {
  chat.id = createId()
  delete chat.hypaContextTruncationAcknowledged
  delete chat.pinned
  ensureClientLorebookEntryIds(chat.localLore ?? (chat.localLore = []))
  const messageIdMap = new Map<string, string>()

  for (const message of chat.message ?? []) {
    const previousId = typeof message.chatId === 'string' && message.chatId.trim() ? message.chatId : undefined
    const nextId = createId()
    message.chatId = nextId
    if (previousId && !messageIdMap.has(previousId)) {
      messageIdMap.set(previousId, nextId)
    }
  }

  const rekeyReference = (messageId: unknown): string | undefined => {
    if (typeof messageId !== 'string') return undefined
    return messageIdMap.get(messageId) ?? (pruneDanglingReferences ? undefined : messageId)
  }

  for (const message of chat.message ?? []) {
    const generationInfo = message.generationInfo
    if (!generationInfo || typeof generationInfo.generationId !== 'string') continue
    const generationId = rekeyReference(generationInfo.generationId)
    if (generationId) {
      generationInfo.generationId = generationId
    } else {
      delete generationInfo.generationId
    }
  }

  if (Array.isArray(chat.bookmarks)) {
    chat.bookmarks = chat.bookmarks.flatMap((messageId) => {
      const nextId = rekeyReference(messageId)
      return nextId ? [nextId] : []
    })
  }
  if (isRecord(chat.bookmarkNames)) {
    const renamed: Record<string, string> = {}
    for (const [messageId, name] of Object.entries(chat.bookmarkNames)) {
      const nextId = rekeyReference(messageId)
      if (nextId && typeof name === 'string') renamed[nextId] = name
    }
    chat.bookmarkNames = renamed
  }

  const memory = chat.hypaV3Data
  if (isRecord(memory) && Array.isArray(memory.summaries)) {
    for (const summary of memory.summaries) {
      if (!isRecord(summary) || !Array.isArray(summary.chatMemos)) continue
      summary.chatMemos = summary.chatMemos.flatMap((messageId: unknown) => {
        const nextId = rekeyReference(messageId)
        return nextId ? [nextId] : []
      })
    }
  }

  return messageIdMap
}
