import { beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import type { ActiveChatTarget } from '../chatCommands'
import {
  abortInputHookActivity,
  activeInputHookActivities,
  beginInputHookActivity,
  findInputHookActivity,
  finishInputHookActivity,
  resetInputHookActivitiesForTests,
  updateInputHookActivityStage,
} from './inputHookActivity.svelte'

function target(characterId: string, chatId: string, selectedCharID: number): ActiveChatTarget {
  return { selectedCharID, chatPage: 0, characterId, chatId }
}

function composerOperation(targetIdentity: string, sequence: number, composerVersion = sequence) {
  return {
    token: { target: targetIdentity, sequence },
    composerVersion,
  }
}

beforeEach(() => {
  resetInputHookActivitiesForTests()
})

describe('input-hook activity registry', () => {
  it('allows different chats concurrently while keeping each chat single-flight', () => {
    const chatA = target('char-a', 'chat-a', 0)
    const chatB = target('char-b', 'chat-b', 1)
    const activityA = beginInputHookActivity({
      target: chatA,
      stage: 5,
      kind: 'draft',
      composerOperation: composerOperation('transcript-a', 1),
    })
    const activityB = beginInputHookActivity({
      target: chatB,
      stage: 5,
      kind: 'btw',
      composerOperation: composerOperation('transcript-b', 2),
    })

    expect(activityA).not.toBeNull()
    expect(activityB).not.toBeNull()
    expect(
      beginInputHookActivity({
        target: chatA,
        stage: 5,
        kind: 'btw',
        composerOperation: composerOperation('transcript-a', 3),
      }),
    ).toBeNull()
    expect(get(activeInputHookActivities).map((activity) => activity.chatId)).toEqual(['chat-a', 'chat-b'])
    expect(activityA?.composerOperation).toEqual({
      token: { target: 'transcript-a', sequence: 1 },
      composerVersion: 1,
    })
  })

  it('keeps stage and reverse-order cleanup scoped to the owning activity id', () => {
    const activityA = beginInputHookActivity({
      target: target('char-a', 'chat-a', 0),
      stage: 5,
      kind: 'draft',
      composerOperation: composerOperation('transcript-a', 1),
    })!
    const activityB = beginInputHookActivity({
      target: target('char-b', 'chat-b', 1),
      stage: 5,
      kind: 'btw',
      composerOperation: composerOperation('transcript-b', 2),
    })!

    updateInputHookActivityStage(activityA.id, 7)
    expect(findInputHookActivity(activityA.target)?.stage).toBe(7)
    expect(findInputHookActivity(activityB.target)?.stage).toBe(5)

    finishInputHookActivity(activityB.id)
    expect(findInputHookActivity(activityB.target)).toBeUndefined()
    expect(findInputHookActivity(activityA.target)?.id).toBe(activityA.id)
    finishInputHookActivity(activityA.id)
    expect(get(activeInputHookActivities)).toEqual([])
  })

  it('aborts only the activity owned by the requested chat target', () => {
    const activityA = beginInputHookActivity({
      target: target('char-a', 'chat-a', 0),
      stage: 5,
      kind: 'draft',
      composerOperation: composerOperation('transcript-a', 1),
    })!
    const activityB = beginInputHookActivity({
      target: target('char-b', 'chat-b', 1),
      stage: 5,
      kind: 'btw',
      composerOperation: composerOperation('transcript-b', 2),
    })!

    expect(abortInputHookActivity(activityA.target)).toBe(true)
    expect(activityA.controller.signal.aborted).toBe(true)
    expect(activityB.controller.signal.aborted).toBe(false)
    expect(abortInputHookActivity(target('char-c', 'chat-c', 2))).toBe(false)
  })
})
