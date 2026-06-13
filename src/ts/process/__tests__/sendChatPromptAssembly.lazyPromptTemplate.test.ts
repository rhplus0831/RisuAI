import { beforeEach, describe, expect, it, vi } from 'vitest'

const hydrationState = vi.hoisted(() => ({
  ensurePromptTemplateHydrated: vi.fn(async () => false),
  isPromptTemplateHydrated: vi.fn(() => false),
}))

vi.mock('../../server/promptTemplateHydration', () => hydrationState)

vi.mock('../scripts', () => ({
  risuChatParser: (text: string) => text,
}))

import { language } from 'src/lang'
import { DBState } from '../../stores.svelte'
import type { Chat, character } from '../../storage/database.svelte'
import { assembleLocalSendChatPrompt, type SendChatPromptStageTimings } from '../sendChatPromptAssembly'

function makeChat(): Chat {
  return {
    id: 'chat-a',
    name: 'Main',
    note: '',
    localLore: [],
    scriptstate: {},
    fmIndex: -1,
    message: [{ role: 'user', data: 'hello', chatId: 'msg-a' }],
  } as Chat
}

function makeCharacter(chat: Chat): character {
  return {
    type: 'character',
    chaId: 'char-a',
    name: 'Ada',
    desc: '',
    firstMessage: '',
    chats: [chat],
    chatPage: 0,
    chatFolders: [],
    globalLore: [],
    bias: [],
    customscript: [],
    triggerscript: [],
    utilityBot: false,
  } as unknown as character
}

function stageTimings(): SendChatPromptStageTimings {
  return {
    stage1Start: 0,
    stage1Duration: 0,
    stage2Start: 0,
    stage2Duration: 0,
  }
}

describe('assembleLocalSendChatPrompt promptTemplate hydration', () => {
  beforeEach(() => {
    hydrationState.ensurePromptTemplateHydrated.mockClear()
    hydrationState.isPromptTemplateHydrated.mockClear()
    hydrationState.ensurePromptTemplateHydrated.mockResolvedValue(false)
    hydrationState.isPromptTemplateHydrated.mockReturnValue(false)
  })

  it('stops clearly instead of falling back when promptTemplate is still unloaded', async () => {
    const chat = makeChat()
    const currentChar = makeCharacter(chat)
    ;(DBState as { db: unknown }).db = {
      characters: [currentChar],
      maxResponse: 200,
      bias: [],
    }
    const throwError = vi.fn()

    const result = await assembleLocalSendChatPrompt({
      currentChar,
      currentChat: chat,
      nowChatroom: currentChar,
      selectedChar: 0,
      selectedChat: 0,
      tokenizer: {} as never,
      promptInfo: {} as never,
      maxContextTokens: 4000,
      stageTimings: stageTimings(),
      isContinue: false,
      findCharacterbyIdwithCache: () => currentChar,
      throwError,
      setProcessStage: vi.fn(),
    })

    expect(result).toEqual({ status: 'stopped' })
    expect(hydrationState.ensurePromptTemplateHydrated).toHaveBeenCalledTimes(1)
    expect(hydrationState.isPromptTemplateHydrated).toHaveBeenCalledTimes(1)
    expect(throwError).toHaveBeenCalledWith(language.errors.promptTemplateUnavailable)
  })
})
