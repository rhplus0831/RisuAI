import { writable } from 'svelte/store'
import type { Message } from '../storage/database.svelte'

export interface QueuedGenerationPersistence {
  chatId: string
  messageId: string
  generationId: string
}

export const queuedGenerationPersistences = writable<QueuedGenerationPersistence[]>([])

export function markGenerationPersistenceQueued(entry: QueuedGenerationPersistence): void {
  queuedGenerationPersistences.update((entries) => [
    ...entries.filter(
      (candidate) => candidate.chatId !== entry.chatId || candidate.generationId !== entry.generationId,
    ),
    entry,
  ])
}

export function clearGenerationPersistence(chatId: string, generationId: string): void {
  queuedGenerationPersistences.update((entries) =>
    entries.filter((entry) => entry.chatId !== chatId || entry.generationId !== generationId),
  )
}

/** Clear provisional badges only when an authoritative hydration contains the queued generation. */
export function acknowledgeHydratedGenerationPersistences(chatId: string, messages: readonly Message[]): void {
  queuedGenerationPersistences.update((entries) =>
    entries.filter((entry) => {
      if (entry.chatId !== chatId) return true
      return !messages.some(
        (message) =>
          message.generationInfo?.generationId === entry.generationId ||
          (entry.messageId === entry.generationId && message.chatId === entry.generationId),
      )
    }),
  )
}
