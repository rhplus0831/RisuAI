import { writable } from 'svelte/store'
import type { ActiveChatTarget } from '../chatCommands'

export interface PendingChatSuggestionCompletion {
  id: number
  target: ActiveChatTarget
  targetKey: string
}

const MAX_PENDING_CHAT_SUGGESTION_COMPLETIONS = 256

export const pendingChatSuggestionCompletions = writable<PendingChatSuggestionCompletion[]>([])

let nextCompletionId = 0

function suggestionCompletionTargetKey(target: ActiveChatTarget | null | undefined): string | null {
  if (!target) return null
  if (target.chatId) return `chat:${target.chatId}`
  if (target.characterId) return `character:${target.characterId}:page:${target.chatPage}`
  return `index:${target.selectedCharID}:page:${target.chatPage}`
}

export function markChatSuggestionCompletion(target: ActiveChatTarget): PendingChatSuggestionCompletion | null {
  const targetKey = suggestionCompletionTargetKey(target)
  if (!targetKey) return null
  const completion: PendingChatSuggestionCompletion = {
    id: ++nextCompletionId,
    target: { ...target },
    targetKey,
  }
  pendingChatSuggestionCompletions.update((completions) => [
    ...completions
      .filter((entry) => entry.targetKey !== targetKey)
      .slice(-(MAX_PENDING_CHAT_SUGGESTION_COMPLETIONS - 1)),
    completion,
  ])
  return completion
}

export function findPendingChatSuggestionCompletion(
  completions: readonly PendingChatSuggestionCompletion[],
  target: ActiveChatTarget | null | undefined,
): PendingChatSuggestionCompletion | undefined {
  const targetKey = suggestionCompletionTargetKey(target)
  if (!targetKey) return undefined
  return completions.find((completion) => completion.targetKey === targetKey)
}

export function consumeChatSuggestionCompletion(id: number): boolean {
  let consumed = false
  pendingChatSuggestionCompletions.update((completions) =>
    completions.filter((completion) => {
      if (completion.id !== id) return true
      consumed = true
      return false
    }),
  )
  return consumed
}

export function resetChatSuggestionCompletionsForTests(): void {
  pendingChatSuggestionCompletions.set([])
  nextCompletionId = 0
}
