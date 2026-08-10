import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

import { setDatabase, type Database, type character, type MessageGenerationInfo } from '../../storage/database.svelte'
import { selectedCharID } from '../../stores.svelte'
import { testDatabaseState } from '../../__tests__/resourceDatabaseState'
import { finalizeStage4, type StageTimings } from '../postGeneration/stage4Finalize'

function makeTimings(): StageTimings {
  return {
    stage1Start: 0,
    stage2Start: 0,
    stage3Start: 0,
    stage4Start: 1000,
    stage1Duration: 10,
    stage2Duration: 20,
    stage3Duration: 30,
    stage4Duration: 0,
  }
}

function makeChar(lastMessageHasGenerationInfo = true): character {
  const message: {
    role: 'user' | 'char'
    data: string
    chatId: string
    generationInfo?: MessageGenerationInfo
  }[] = [{ role: 'user', data: 'hi', chatId: 'message-user' }]
  if (lastMessageHasGenerationInfo) {
    message.push({ role: 'char', data: 'hello', chatId: 'message-assistant', generationInfo: {} })
  } else {
    message.push({ role: 'char', data: 'hello', chatId: 'message-assistant' })
  }
  return {
    name: 'Test',
    chaId: 'cha-1',
    chats: [{ id: 'chat-1', message, note: '', name: 'main', localLore: [] }],
    chatPage: 0,
    image: '',
    emotionImages: [],
    bias: [],
    viewScreen: 'none',
    globalLore: [],
    chaVer: 0,
    firstMessage: '',
    desc: '',
    notes: '',
  } as unknown as character
}

const target = {
  characterId: 'cha-1',
  chatId: 'chat-1',
  messageId: 'message-assistant',
}

function seed(char: character) {
  setDatabase({ characters: [char] } as Database)
  selectedCharID.set(0)
}

describe('finalizeStage4', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(1500))
  })

  it('computes stage4Duration from stage4Start to now', () => {
    const stageTimings = makeTimings()
    const generationInfo: MessageGenerationInfo = {}
    seed(makeChar())
    finalizeStage4({ stageTimings, generationInfo, target })
    expect(stageTimings.stage4Duration).toBe(500)
  })

  it('writes all four stage timings onto generationInfo.stageTiming', () => {
    const stageTimings = makeTimings()
    const generationInfo: MessageGenerationInfo = { stageTiming: {} }
    seed(makeChar())
    finalizeStage4({ stageTimings, generationInfo, target })
    expect(generationInfo.stageTiming).toEqual({
      stage1: 10,
      stage2: 20,
      stage3: 30,
      stage4: 500,
    })
  })

  it('does not create stageTiming when generationInfo.stageTiming is undefined', () => {
    const stageTimings = makeTimings()
    const generationInfo: MessageGenerationInfo = {}
    seed(makeChar())
    finalizeStage4({ stageTimings, generationInfo, target })
    expect(generationInfo.stageTiming).toBeUndefined()
  })

  it('persists generationInfo onto the exact targeted message when it already has generationInfo', () => {
    const stageTimings = makeTimings()
    const generationInfo: MessageGenerationInfo = { model: 'test-model' }
    seed(makeChar(true))
    finalizeStage4({ stageTimings, generationInfo, target })
    const messages = testDatabaseState.db.characters[0].chats[0].message
    expect(messages[messages.length - 1].generationInfo).toEqual({ model: 'test-model' })
  })

  it('does not overwrite when the targeted message lacks generationInfo', () => {
    const stageTimings = makeTimings()
    const generationInfo: MessageGenerationInfo = { model: 'test-model' }
    seed(makeChar(false))
    finalizeStage4({ stageTimings, generationInfo, target })
    const messages = testDatabaseState.db.characters[0].chats[0].message
    expect(messages[messages.length - 1].generationInfo).toBeUndefined()
  })

  it('skips persistence when message list is empty', () => {
    const stageTimings = makeTimings()
    const generationInfo: MessageGenerationInfo = { model: 'test-model' }
    const char = makeChar()
    char.chats[0].message = []
    seed(char)
    finalizeStage4({ stageTimings, generationInfo, target })
    expect(testDatabaseState.db.characters[0].chats[0].message).toHaveLength(0)
  })

  it('does not redirect finalization to a newer tail message', () => {
    const stageTimings = makeTimings()
    const generationInfo: MessageGenerationInfo = { model: 'target-model' }
    const char = makeChar()
    char.chats[0].message.push({
      role: 'char',
      data: 'newer',
      chatId: 'message-newer',
      generationInfo: { model: 'newer-model' },
    })
    seed(char)

    finalizeStage4({ stageTimings, generationInfo, target })

    const messages = testDatabaseState.db.characters[0].chats[0].message
    expect(messages.find((message) => message.chatId === target.messageId)?.generationInfo).toEqual({
      model: 'target-model',
    })
    expect(messages.find((message) => message.chatId === 'message-newer')?.generationInfo).toEqual({
      model: 'newer-model',
    })
  })

  it('is a safe no-op when the stable target no longer exists', () => {
    const stageTimings = makeTimings()
    const generationInfo: MessageGenerationInfo = { model: 'target-model' }
    const replacement = makeChar()
    replacement.chaId = 'cha-replacement'
    replacement.chats[0].message[1].generationInfo = { model: 'replacement-model' }
    seed(replacement)

    finalizeStage4({ stageTimings, generationInfo, target })

    expect(testDatabaseState.db.characters[0].chats[0].message[1].generationInfo).toEqual({
      model: 'replacement-model',
    })
  })
})
