import type { ChatGenerationSettings } from '../chatGenerationSettings'

interface PendingChatGenerationSettingsSave {
  sequence: number
  generationSettings: ChatGenerationSettings
}

export interface PendingChatGenerationSettingsSaveToken {
  chatId: string
  sequence: number
}

const pendingSavesByChatId = new Map<string, PendingChatGenerationSettingsSave[]>()
let nextPendingSaveSequence = 0

export function registerPendingChatGenerationSettingsSave(
  chatId: string,
  generationSettings: ChatGenerationSettings,
): PendingChatGenerationSettingsSaveToken {
  const sequence = ++nextPendingSaveSequence
  const pending = pendingSavesByChatId.get(chatId) ?? []
  pending.push({
    sequence,
    generationSettings: cloneJsonValue(generationSettings),
  })
  pendingSavesByChatId.set(chatId, pending)
  return { chatId, sequence }
}

export function clearPendingChatGenerationSettingsSave(token: PendingChatGenerationSettingsSaveToken): void {
  const pending = pendingSavesByChatId.get(token.chatId)
  if (!pending) return

  const next = pending.filter((save) => save.sequence !== token.sequence)
  if (next.length === 0) {
    pendingSavesByChatId.delete(token.chatId)
    return
  }
  pendingSavesByChatId.set(token.chatId, next)
}

/** An accepted save also acknowledges every older projection it supersedes. */
export function acknowledgePendingChatGenerationSettingsSave(token: PendingChatGenerationSettingsSaveToken): void {
  const pending = pendingSavesByChatId.get(token.chatId)
  if (!pending) return

  const next = pending.filter((save) => save.sequence > token.sequence)
  if (next.length === 0) {
    pendingSavesByChatId.delete(token.chatId)
    return
  }
  pendingSavesByChatId.set(token.chatId, next)
}

export function shouldPreserveLiveChatGenerationSettingsForResource(
  chatId: string,
  incomingGenerationSettings: unknown,
): boolean {
  const latestPending = pendingSavesByChatId.get(chatId)?.at(-1)
  if (!latestPending) return false
  if (isJsonValueEqual(incomingGenerationSettings, latestPending.generationSettings)) {
    acknowledgePendingChatGenerationSettingsSave({ chatId, sequence: latestPending.sequence })
    return false
  }
  return !isJsonValueEqual(incomingGenerationSettings, latestPending.generationSettings)
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function isJsonValueEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
