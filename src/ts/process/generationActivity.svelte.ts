import { get, writable } from 'svelte/store'
import type { ActiveChatTarget } from '../chatCommands'
import { markChatSuggestionCompletion, resetChatSuggestionCompletionsForTests } from './chatSuggestionCompletion.svelte'

export type ChatGenerationActivityKind = 'message' | 'preview'
export type ChatGenerationActivityMode = 'send' | 'continue' | 'regenerate'
export type ChatGenerationPhase =
  | 'starting'
  | 'preparing'
  | 'checking-memory'
  | 'waiting-for-model'
  | 'generating'
  | 'finalizing'

const CHAT_GENERATION_PHASE_ORDER: Record<ChatGenerationPhase, number> = {
  starting: 0,
  preparing: 1,
  'checking-memory': 2,
  'waiting-for-model': 3,
  generating: 4,
  finalizing: 5,
}

export function chatGenerationPhaseFromProcessStage(stage: unknown): ChatGenerationPhase {
  switch (stage) {
    case 1:
      return 'preparing'
    case 2:
      return 'checking-memory'
    case 3:
      return 'waiting-for-model'
    case 4:
      return 'finalizing'
    default:
      return 'starting'
  }
}

export interface ChatGenerationActivity {
  id: number
  target: ActiveChatTarget
  targetKey: string
  chatId?: string
  characterId?: string
  stage: number
  phase: ChatGenerationPhase
  startedAt: number
  kind: ChatGenerationActivityKind
  controller?: AbortController
  operationId?: string
  acceptedMessageId?: string
  mode: ChatGenerationActivityMode
  targetMessageId?: string
  generationId?: string
  attemptNo?: number
  projectionEpoch?: number
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
  mode?: ChatGenerationActivityMode
  targetMessageId?: string
  generationId?: string
  attemptNo?: number
  projectionEpoch?: number
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
    phase: 'starting',
    startedAt: Date.now(),
    kind: input.kind,
    controller: input.controller,
    operationId: input.operationId,
    acceptedMessageId: input.acceptedMessageId,
    mode: input.mode ?? 'send',
    targetMessageId: input.targetMessageId,
    generationId: input.generationId,
    attemptNo: input.attemptNo,
    projectionEpoch: input.projectionEpoch,
  }
  activeChatGenerations.update((activities) => [...activities, activity])
  return activity
}

export function updateChatGenerationActivityMetadata(
  target: ActiveChatTarget,
  update: Partial<
    Pick<
      ChatGenerationActivity,
      | 'operationId'
      | 'acceptedMessageId'
      | 'mode'
      | 'targetMessageId'
      | 'generationId'
      | 'attemptNo'
      | 'projectionEpoch'
    >
  >,
): void {
  const targetKey = chatGenerationTargetKey(target)
  if (!targetKey) return
  activeChatGenerations.update((activities) =>
    activities.map((activity) => (activity.targetKey === targetKey ? { ...activity, ...update } : activity)),
  )
}

export function updateChatGenerationActivityStage(activityId: number, stage: number): void {
  const phase = chatGenerationPhaseFromProcessStage(stage)
  activeChatGenerations.update((activities) =>
    activities.map((activity) =>
      activity.id === activityId
        ? {
            ...activity,
            stage,
            phase:
              CHAT_GENERATION_PHASE_ORDER[phase] >= CHAT_GENERATION_PHASE_ORDER[activity.phase]
                ? phase
                : activity.phase,
          }
        : activity,
    ),
  )
}

export function updateChatGenerationActivityPhase(activityId: number, phase: ChatGenerationPhase): void {
  activeChatGenerations.update((activities) =>
    activities.map((activity) =>
      activity.id === activityId && CHAT_GENERATION_PHASE_ORDER[phase] >= CHAT_GENERATION_PHASE_ORDER[activity.phase]
        ? { ...activity, phase }
        : activity,
    ),
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
