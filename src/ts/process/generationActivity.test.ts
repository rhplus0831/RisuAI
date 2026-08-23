import { beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import {
  activeChatGenerations,
  beginChatGenerationActivity,
  chatGenerationTargetKey,
  findChatGenerationActivity,
  finishChatGenerationActivity,
  resetChatGenerationActivitiesForTests,
  updateChatGenerationActivityMetadata,
  updateChatGenerationActivityStage,
} from './generationActivity.svelte'
import {
  consumeChatSuggestionCompletion,
  findPendingChatSuggestionCompletion,
  pendingChatSuggestionCompletions,
} from './chatSuggestionCompletion.svelte'

function target(characterId: string, chatId: string, selectedCharID: number) {
  return {
    selectedCharID,
    chatPage: 0,
    characterId,
    chatId,
  }
}

beforeEach(() => {
  resetChatGenerationActivitiesForTests()
})

describe('chat generation activity registry', () => {
  it('tracks different chats concurrently while keeping each chat single-flight', () => {
    const chatA = target('char-a', 'chat-a', 0)
    const chatB = target('char-b', 'chat-b', 1)
    const activityA = beginChatGenerationActivity({ target: chatA, kind: 'message' })
    const activityB = beginChatGenerationActivity({ target: chatB, kind: 'message' })

    expect(activityA).not.toBeNull()
    expect(activityB).not.toBeNull()
    expect(beginChatGenerationActivity({ target: chatA, kind: 'message' })).toBeNull()
    expect(get(activeChatGenerations).map((activity) => activity.chatId)).toEqual(['chat-a', 'chat-b'])
  })

  it('keeps stages and completion scoped to the owning activity', () => {
    const activityA = beginChatGenerationActivity({ target: target('char-a', 'chat-a', 0), kind: 'message' })!
    const activityB = beginChatGenerationActivity({ target: target('char-b', 'chat-b', 1), kind: 'message' })!

    updateChatGenerationActivityStage(activityA.id, 2)
    updateChatGenerationActivityStage(activityB.id, 4)
    expect(findChatGenerationActivity(activityA.target)?.stage).toBe(2)
    expect(findChatGenerationActivity(activityB.target)?.stage).toBe(4)

    finishChatGenerationActivity(activityB.id)
    expect(findChatGenerationActivity(activityB.target)).toBeUndefined()
    expect(findChatGenerationActivity(activityA.target)?.stage).toBe(2)
  })

  it('attaches regenerate operation and attempt metadata after admission', () => {
    const chat = target('char-a', 'chat-a', 0)
    beginChatGenerationActivity({ target: chat, kind: 'message', mode: 'regenerate', targetMessageId: 'old' })

    updateChatGenerationActivityMetadata(chat, {
      operationId: 'operation-a',
      generationId: 'generated-a',
      attemptNo: 2,
      projectionEpoch: 9,
    })

    expect(findChatGenerationActivity(chat)).toMatchObject({
      mode: 'regenerate',
      targetMessageId: 'old',
      operationId: 'operation-a',
      generationId: 'generated-a',
      attemptNo: 2,
      projectionEpoch: 9,
    })
  })

  it('uses stable chat IDs before index fallbacks', () => {
    expect(chatGenerationTargetKey(target('char-a', 'chat-a', 3))).toBe('chat:chat-a')
    expect(chatGenerationTargetKey({ selectedCharID: 3, chatPage: 2, characterId: 'char-a', chatId: undefined })).toBe(
      'character:char-a:page:2',
    )
  })

  it('records one consume-once suggestion marker when a message activity settles', () => {
    const chatA = target('char-a', 'chat-a', 0)
    const messageActivity = beginChatGenerationActivity({ target: chatA, kind: 'message' })!
    const previewActivity = beginChatGenerationActivity({ target: target('char-b', 'chat-b', 1), kind: 'preview' })!

    finishChatGenerationActivity(messageActivity.id)
    finishChatGenerationActivity(messageActivity.id)
    finishChatGenerationActivity(previewActivity.id)

    const completion = findPendingChatSuggestionCompletion(get(pendingChatSuggestionCompletions), chatA)
    expect(completion).toMatchObject({ target: chatA, targetKey: 'chat:chat-a' })
    expect(get(pendingChatSuggestionCompletions)).toHaveLength(1)
    expect(consumeChatSuggestionCompletion(completion!.id)).toBe(true)
    expect(consumeChatSuggestionCompletion(completion!.id)).toBe(false)
    expect(get(pendingChatSuggestionCompletions)).toEqual([])
  })
})
