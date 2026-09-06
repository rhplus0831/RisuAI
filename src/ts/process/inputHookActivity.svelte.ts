import { get, writable } from 'svelte/store'
import type { ActiveChatTarget } from '../chatCommands'
import type { LatestOperationToken } from '../server/staleStateGuards'
import { chatGenerationTargetKey } from './generationActivity.svelte'

export type InputHookActivityKind = 'draft' | 'btw'

export interface InputHookComposerOperationOwnership {
  token: LatestOperationToken<string>
  composerVersion: number
}

export interface InputHookActivity {
  id: number
  target: ActiveChatTarget
  targetKey: string
  chatId?: string
  characterId?: string
  stage: number
  kind: InputHookActivityKind
  controller: AbortController
  composerOperation: InputHookComposerOperationOwnership
}

export const activeInputHookActivities = writable<InputHookActivity[]>([])

let nextActivityId = 0

export function findInputHookActivity(target: ActiveChatTarget | null | undefined): InputHookActivity | undefined {
  const targetKey = chatGenerationTargetKey(target)
  if (!targetKey) return undefined
  return get(activeInputHookActivities).find((activity) => activity.targetKey === targetKey)
}

export function beginInputHookActivity(input: {
  target: ActiveChatTarget
  stage: number
  kind: InputHookActivityKind
  composerOperation: InputHookComposerOperationOwnership
}): InputHookActivity | null {
  const targetKey = chatGenerationTargetKey(input.target)
  if (!targetKey || findInputHookActivity(input.target)) return null

  const activity: InputHookActivity = {
    id: ++nextActivityId,
    target: { ...input.target },
    targetKey,
    chatId: input.target.chatId,
    characterId: input.target.characterId,
    stage: input.stage,
    kind: input.kind,
    controller: new AbortController(),
    composerOperation: {
      token: { ...input.composerOperation.token },
      composerVersion: input.composerOperation.composerVersion,
    },
  }
  activeInputHookActivities.update((activities) => [...activities, activity])
  return activity
}

export function updateInputHookActivityStage(activityId: number, stage: number): void {
  activeInputHookActivities.update((activities) =>
    activities.map((activity) => (activity.id === activityId ? { ...activity, stage } : activity)),
  )
}

export function finishInputHookActivity(activityId: number): void {
  activeInputHookActivities.update((activities) => activities.filter((activity) => activity.id !== activityId))
}

export function abortInputHookActivity(target: ActiveChatTarget | null | undefined): boolean {
  const activity = findInputHookActivity(target)
  if (!activity) return false
  activity.controller.abort()
  return true
}

export function resetInputHookActivitiesForTests(): void {
  activeInputHookActivities.set([])
  nextActivityId = 0
}
