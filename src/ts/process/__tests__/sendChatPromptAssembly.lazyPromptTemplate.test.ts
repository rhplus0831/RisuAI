import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenAIChat } from '../index.svelte'

const projectionState = vi.hoisted(() => ({
  fetchResource: vi.fn(),
  canUse: true,
}))

const assemblyState = vi.hoisted(() => ({
  buildHistoryWindow: vi.fn(async (args: { currentChat: Chat }) => ({
    stopSending: false,
    chats: [],
    addedTokens: 0,
    currentChat: args.currentChat,
    triggerResult: undefined,
  })),
  renderFinalPrompt: vi.fn(async () => ({
    formated: [{ role: 'system', content: 'assembled' }],
  })),
  finalizeRequestBudget: vi.fn(async (formated: OpenAIChat[]) => ({
    ok: true,
    formated,
    inputTokens: 12,
    outputTokens: 200,
  })),
}))

vi.mock('../../server/hydrationReads', () => ({
  fetchServerPromptPresetTemplate: projectionState.fetchResource,
}))

vi.mock('../scripts', () => ({
  risuChatParser: (text: string) => text,
}))

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

vi.mock('../promptAssembly/buildDescription', () => ({
  buildDescription: async () => [],
}))

vi.mock('../promptAssembly/buildLorebookContext', () => ({
  buildLorebookContext: async () => ({
    resolvePosition: (text: string) => text,
    positionParser: (text: string) => text,
    depthPrompts: [],
  }),
}))

vi.mock('../promptBudget/preflightTemplateTokens', () => ({
  preflightTemplateTokens: async () => ({
    addedTokens: 0,
    memoryCardUsed: false,
    hasCachePoint: false,
  }),
}))

vi.mock('../promptAssembly/buildHistoryWindow', () => ({
  buildHistoryWindow: assemblyState.buildHistoryWindow,
}))

vi.mock('../promptAssembly/buildMemoryWindow', () => ({
  buildMemoryWindow: async (args: { currentChat: Chat; chats: OpenAIChat[] }) => ({
    stopSending: false,
    chats: args.chats,
    currentTokens: 0,
    currentChat: args.currentChat,
    memories: [],
  }),
}))

vi.mock('../promptAssembly/renderFinalPrompt', () => ({
  renderFinalPrompt: assemblyState.renderFinalPrompt,
}))

vi.mock('../promptBudget/finalizeRequestBudget', () => ({
  finalizeRequestBudget: assemblyState.finalizeRequestBudget,
}))

import { language } from 'src/lang'
import { getDatabase, setDatabaseLite, setResourceWriteGuardEnabled } from '../../storage/database.svelte'
import type { Chat, character } from '../../storage/database.svelte'
import { assembleLocalSendChatPrompt, type SendChatPromptStageTimings } from '../sendChatPromptAssembly'
import { clearCachedServerCommandRevision, setCachedServerCommandRevision } from '../../server/commands'
import { resetPromptTemplateHydration } from '../../server/promptTemplateHydration'
import type { PromptItem } from '../prompt'

const testDatabaseState = {
  get db() {
    return getDatabase()
  },
  set db(value: ReturnType<typeof getDatabase>) {
    setDatabaseLite(value)
  },
}

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
    setResourceWriteGuardEnabled(false)
    ;(testDatabaseState as { db: unknown }).db = {}
    clearCachedServerCommandRevision()
    resetPromptTemplateHydration()
    projectionState.canUse = true
    projectionState.fetchResource.mockReset()
    assemblyState.renderFinalPrompt.mockClear()
    assemblyState.buildHistoryWindow.mockClear()
    assemblyState.finalizeRequestBudget.mockClear()
  })

  it('stops clearly instead of falling back when promptTemplate is still unloaded', async () => {
    const chat = makeChat()
    const currentChar = makeCharacter(chat)
    ;(testDatabaseState as { db: unknown }).db = {
      characters: [currentChar],
      promptPresetsId: -1,
      maxResponse: 200,
      bias: [],
    }
    setCachedServerCommandRevision(1)
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
    expect(projectionState.fetchResource).not.toHaveBeenCalled()
    expect(throwError).toHaveBeenCalledWith(language.errors.promptTemplateUnavailable)
  })

  it('hydrates the chat-scoped prompt preset without overwriting the visible global projection', async () => {
    const globalTemplate = [{ id: 'global-row', type: 'description' }] as PromptItem[]
    const chatTemplate = [
      { id: 'chat-row', type: 'plain', role: 'system', type2: 'main', text: 'chat template' },
    ] as PromptItem[]
    const chat = {
      ...makeChat(),
      generationSettings: { promptPresetId: 'prompt-chat' },
    } as Chat
    const currentChar = makeCharacter(chat)
    ;(testDatabaseState as { db: unknown }).db = {
      characters: [currentChar],
      promptPresetsId: 0,
      promptTemplate: globalTemplate,
      promptPresets: [
        { id: 'prompt-global', name: 'Global Prompt', promptTemplate: globalTemplate },
        { id: 'prompt-chat', name: 'Chat Prompt' },
      ],
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: false,
        sendName: false,
        utilOverride: false,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
      },
      formatingOrder: [],
      aiModel: 'gpt-4',
      modelProfiles: [{ id: 'durable-main', name: 'Durable Main', modelId: 'novelai:durable' }],
      modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'durable-main' } },
      chainOfThought: false,
      personaPrompt: false,
      jailbreakToggle: false,
      maxResponse: 200,
      bias: [],
    }
    setCachedServerCommandRevision(9)
    projectionState.fetchResource.mockResolvedValue({
      status: 'ok',
      revision: 9,
      promptPresetId: 'prompt-chat',
      promptTemplate: chatTemplate,
    })
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

    expect(result).toMatchObject({
      status: 'assembled',
      inputTokens: 12,
      outputTokens: 200,
    })
    expect(projectionState.fetchResource).toHaveBeenCalledWith('prompt-chat')
    expect(testDatabaseState.db.promptPresets[1].promptTemplate).toEqual(chatTemplate)
    expect(testDatabaseState.db.promptTemplate).toEqual(globalTemplate)
    expect(assemblyState.renderFinalPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'novelai:durable',
        promptTemplate: [...chatTemplate, { type: 'postEverything' }],
        usingPromptTemplate: true,
      }),
    )
    expect(assemblyState.buildHistoryWindow).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'novelai:durable' }),
    )
    expect(throwError).not.toHaveBeenCalled()
  })
})
