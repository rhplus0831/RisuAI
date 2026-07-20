import type { Message } from 'src/ts/storage/database.svelte'

export function newlyAppendedMessageIds(input: {
  previousChatId: string | null
  currentChatId: string | null
  previousMessageIds: readonly (string | null)[]
  messages: readonly Message[]
  autoTranslate: boolean
}): string[] {
  const previousLength = input.previousMessageIds.length
  if (
    !input.autoTranslate ||
    !input.currentChatId ||
    input.previousChatId !== input.currentChatId ||
    input.messages.length <= previousLength ||
    input.previousMessageIds.some((messageId, index) => input.messages[index]?.chatId !== messageId)
  ) {
    return []
  }

  return input.messages
    .slice(previousLength)
    .map((message) => message.chatId?.trim() ?? '')
    .filter((messageId) => messageId.length > 0)
}
