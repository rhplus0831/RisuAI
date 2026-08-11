import { get, writable } from 'svelte/store'
import type { ActiveChatTarget } from '../chatCommands'
import { markChatSuggestionCompletion, resetChatSuggestionCompletionsForTests } from './chatSuggestionCompletion.svelte'

export type ChatGenerationActivityKind = 'message' | 'preview'

export interface ChatGenerationActivity {
  id: number
  target: ActiveChatTarget
  targetKey: string
  chatId?: string
  characterId?: string
  stage: number
  kind: ChatGenerationActivityKind
  controller?: AbortController
  operationId?: string
  acceptedMessageId?: string
}

export const activeChatGenerations = writable<ChatGenerationActivity[]>([])

let nextActivityId = 0

export function chatGenerationTargetKey(target: ActiveChatTarget | null | undefined): string | null {
  if (!target) return null
  if (target.chatId) return `chat:${target.chatId}`
  if (target.characterId) return `character:${target.characterId}:page:${target.chatPage}`
  return `index:${target.selectedCharID}:page:${target.chatPage}`
}

export function findChatGenerationActivity(
  target: ActiveChatTarget | null | undefined,
): ChatGenerationActivity | undefined {
  const targetKey = chatGenerationTargetKey(target)
  if (!targetKey) return undefined
  return get(activeChatGenerations).find((activity) => activity.targetKey === targetKey)
}

export function findChatGenerationActivityByChatId(
  chatId: string | null | undefined,
): ChatGenerationActivity | undefined {
  if (!chatId) return undefined
  return get(activeChatGenerations).find((activity) => activity.chatId === chatId)
}

export function beginChatGenerationActivity(input: {
  target: ActiveChatTarget
  kind: ChatGenerationActivityKind
  controller?: AbortController
  operationId?: string
  acceptedMessageId?: string
}): ChatGenerationActivity | null {
  const targetKey = chatGenerationTargetKey(input.target)
  if (!targetKey || findChatGenerationActivity(input.target)) return null

  const activity: ChatGenerationActivity = {
    id: ++nextActivityId,
    target: { ...input.target },
    targetKey,
    chatId: input.target.chatId,
    characterId: input.target.characterId,
    stage: 0,
    kind: input.kind,
    controller: input.controller,
    operationId: input.operationId,
    acceptedMessageId: input.acceptedMessageId,
  }
  activeChatGenerations.update((activities) => [...activities, activity])
  return activity
}

export function updateChatGenerationActivityStage(activityId: number, stage: number): void {
  activeChatGenerations.update((activities) =>
    activities.map((activity) => (activity.id === activityId ? { ...activity, stage } : activity)),
  )
}

export function finishChatGenerationActivity(activityId: number): void {
  const activity = get(activeChatGenerations).find((candidate) => candidate.id === activityId)
  if (!activity) return
  if (activity.kind === 'message') markChatSuggestionCompletion(activity.target)
  activeChatGenerations.update((activities) => activities.filter((activity) => activity.id !== activityId))
}

export function resetChatGenerationActivitiesForTests(): void {
  activeChatGenerations.set([])
  nextActivityId = 0
  resetChatSuggestionCompletionsForTests()
}
