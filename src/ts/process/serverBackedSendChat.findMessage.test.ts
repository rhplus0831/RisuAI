import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { selectedCharID } from '../stores.svelte'

// Terminal assistant lookup scans newest-to-oldest without copying the transcript.

vi.mock('../platform', async (importActual) => {
  const actual = await importActual<typeof import('../platform')>()
  return { ...actual, isFastifyServer: true }
})

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'findmessage-token',
}))

vi.mock('./modules', async (importActual) => {
  const actual = await importActual<typeof import('./modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

const inlayMock = vi.hoisted(() => ({
  run: vi.fn((_character: unknown, data: string) => ({ text: data }) as { text: string; promise?: Promise<string> }),
}))
const inlayFinalizationMock = vi.hoisted(() => ({
  finalize: vi.fn(async () => true),
}))
const ttsMock = vi.hoisted(() => ({
  say: vi.fn(async () => {}),
}))
const hydrationMock = vi.hoisted(() => ({
  hydrate: vi.fn(async () => {}),
}))

vi.mock('./inlayScreen', () => ({
  runInlayScreen: inlayMock.run,
}))

vi.mock('./inlayFinalization', () => ({
  finalizeServerBackedInlayMessage: inlayFinalizationMock.finalize,
}))

vi.mock('./tts', () => ({
  sayTTS: ttsMock.say,
}))

vi.mock('../server/chatMessageHydration.svelte', async (importActual) => {
  const actual = await importActual<typeof import('../server/chatMessageHydration.svelte')>()
  return { ...actual, hydrateChatMessages: hydrationMock.hydrate }
})

import {
  applyServerBackedTerminal,
  captureServerBackedRestorationGuard,
  findGeneratedAssistantMessage,
} from './serverBackedSendChat'
import { markChatMessageMutationIntent } from '../server/chatMessageMutationIntent'
import { getResourceDatabase, replaceResourceDatabase } from '../server/resourceState.svelte'
import type { character, Chat, Message, MessageGenerationInfo } from '../storage/database.svelte'
import type { ServerChatMessagePatch, ServerChatRestoration } from './request/serverChatEvents'
import { getRerollBuffer, getRerollId, resetRerollNavigation } from './rerollNavigation.svelte'
import { acknowledgeHydratedGenerationPersistences, queuedGenerationPersistences } from './generationPersistenceState'
import { addChatOutputListener, chatOutputListeners, type ChatOutputListenerArg } from '../plugins/chatOutputListeners'

const testDatabaseState = {
  get db() {
    return getResourceDatabase()
  },
  set db(value: ReturnType<typeof getResourceDatabase>) {
    replaceResourceDatabase(value)
  },
}

function chatWith(messages: Partial<Message>[]): Chat {
  return { id: 'chat-1', message: messages as Message[] } as unknown as Chat
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function trapIterator(chat: Chat): void {
  Object.defineProperty(chat.message, Symbol.iterator, {
    value: () => {
      throw new Error('transcript copied: the lookup must scan in place (L39)')
    },
  })
}

describe('terminal assistant-message lookup (L39)', () => {
  it('L39: resolves the message by chatId without copying the transcript', () => {
    const chat = chatWith([
      { role: 'user', data: 'one', chatId: 'm-1' },
      { role: 'char', data: 'two', chatId: 'gen-1' },
    ])
    trapIterator(chat)

    const found = findGeneratedAssistantMessage(chat, 'gen-1')
    expect(found?.data).toBe('two')
  })

  it('L39: falls back to the newest generationInfo match, scanning in place', () => {
    const chat = chatWith([
      { role: 'char', data: 'old', generationInfo: { generationId: 'gen-2' } },
      { role: 'user', data: 'middle' },
      { role: 'char', data: 'newest', generationInfo: { generationId: 'gen-2' } },
    ])
    trapIterator(chat)

    // Newest-to-oldest: the LAST matching assistant message wins, exactly like
    // the former reversed-copy `.find`.
    const found = findGeneratedAssistantMessage(chat, 'gen-2')
    expect(found?.data).toBe('newest')
  })

  it('L39: returns undefined when nothing matches, still without copying', () => {
    const chat = chatWith([
      { role: 'user', data: 'one', chatId: 'm-1' },
      { role: 'char', data: 'two', chatId: 'm-2' },
    ])
    trapIterator(chat)

    expect(findGeneratedAssistantMessage(chat, 'missing')).toBeUndefined()
  })
})

function terminalMessage(data: string, generationId = 'gen-stable'): Message {
  return {
    role: 'char',
    data,
    chatId: generationId,
    generationInfo: { generationId },
  }
}

function makeTerminalChat(id: string, message: Message[] = [terminalMessage(`${id} original`)]): Chat {
  return {
    id,
    name: id,
    note: '',
    localLore: [],
    message,
  } as Chat
}

function makeTerminalCharacter(chats: Chat[]): character {
  return {
    type: 'character',
    chaId: 'char-stable',
    name: 'Stable Character',
    firstMessage: '',
    desc: '',
    notes: '',
    chats,
    chatFolders: [],
    chatPage: 0,
    viewScreen: 'none',
    bias: [],
    emotionImages: [],
    globalLore: [],
    sdData: [],
    customscript: [],
    triggerscript: [],
    utilityBot: false,
    exampleMessage: '',
    creatorNotes: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    alternateGreetings: [],
    tags: [],
    creator: '',
    characterVersion: '',
    personality: '',
    scenario: '',
    firstMsgIndex: 0,
    replaceGlobalNote: '',
    additionalText: '',
  } as character
}

function makePostGenerationPatch(chatId: string, data: string): ServerChatMessagePatch {
  return {
    chatId,
    characterId: 'char-stable',
    selectedCharID: 0,
    chatPage: 0,
    varChanged: true,
    messageMutations: [
      {
        type: 'replace_all',
        source: 'output_trigger',
        beforeLength: 1,
        afterLength: 1,
        firstChangedIndex: 0,
        messages: [terminalMessage(data)],
      },
    ],
    chatVarMutations: [{ key: '$mood', before: null, after: 'steady' }],
    additionalSystemPrompt: [],
  }
}

function makeRestoration(chatId: string): ServerChatRestoration {
  return {
    chatId,
    characterId: 'char-stable',
    selectedCharID: 0,
    chatPage: 0,
    messages: [{ role: 'user', data: 'restored user', chatId: 'restored-user' }],
    scriptstate: { $restored: 'yes' },
  }
}

function seedReorderedTerminalChats(): { char: character; target: Chat; staleIndexChat: Chat } {
  const target = makeTerminalChat('chat-target', [terminalMessage('target original')])
  const staleIndexChat = makeTerminalChat('chat-stale-index', [terminalMessage('stale original', 'gen-other')])
  const char = makeTerminalCharacter([staleIndexChat, target])
  testDatabaseState.db = { characters: [char] } as typeof testDatabaseState.db
  const liveChar = testDatabaseState.db.characters[0]
  return { char: liveChar, target: liveChar.chats[1], staleIndexChat: liveChar.chats[0] }
}

describe('server-backed terminal stable chat target (R-02)', () => {
  let originalDb: typeof testDatabaseState.db

  beforeEach(() => {
    originalDb = testDatabaseState.db
    resetRerollNavigation()
    inlayMock.run.mockReset()
    inlayMock.run.mockImplementation((_character: unknown, data: string) => ({ text: data }))
    inlayFinalizationMock.finalize.mockReset()
    inlayFinalizationMock.finalize.mockResolvedValue(true)
    ttsMock.say.mockReset()
    ttsMock.say.mockResolvedValue(undefined)
    hydrationMock.hydrate.mockReset()
    hydrationMock.hydrate.mockResolvedValue(undefined)
    queuedGenerationPersistences.set([])
    chatOutputListeners.clear()
    selectedCharID.set(0)
  })

  afterEach(() => {
    resetRerollNavigation()
    queuedGenerationPersistences.set([])
    chatOutputListeners.clear()
    testDatabaseState.db = originalDb
    selectedCharID.set(-1)
  })

  it('applies terminal final text without a nested patch to the stable chat id after chat reorder', async () => {
    const { char, target, staleIndexChat } = seedReorderedTerminalChats()
    const generationInfo: MessageGenerationInfo = { generationId: 'gen-stable' }

    const result = await applyServerBackedTerminal({
      terminal: {
        status: 'done',
        done: { postGeneration: { finalText: 'stable final text' } },
      },
      currentChar: char,
      currentChat: target,
      selectedChar: 0,
      selectedChat: 0,
      targetCharacterId: 'char-stable',
      targetChatId: 'chat-target',
      generationInfo,
    })

    expect(result.status).toBe('ok')
    expect(result.currentChat.id).toBe('chat-target')
    if (result.status !== 'ok') throw new Error('unexpected terminal status')
    expect(result.igpTarget).toEqual({
      characterId: 'char-stable',
      chatId: 'chat-target',
      messageId: 'gen-stable',
      expectedData: 'stable final text',
      expectedGenerationId: 'gen-stable',
    })
    expect(target.message[0].data).toBe('stable final text')
    expect(staleIndexChat.message[0].data).toBe('stale original')
  })

  it('notifies output listeners after the finalized assistant message is applied', async () => {
    const { char, target } = seedReorderedTerminalChats()
    const calls: ChatOutputListenerArg[] = []
    const order: string[] = []
    addChatOutputListener('output', async (arg) => {
      order.push('first:start')
      await Promise.resolve()
      calls.push(arg)
      arg.chat.message[0].data = 'detached plugin mutation'
      arg.char.name = 'Detached Plugin Character'
      order.push('first:end')
    })
    addChatOutputListener('output', () => {
      order.push('second')
    })

    const result = await applyServerBackedTerminal({
      terminal: {
        status: 'done',
        done: { postGeneration: { finalText: 'listener-visible final text' } },
      },
      currentChar: char,
      currentChat: target,
      selectedChar: 0,
      selectedChat: 0,
      targetCharacterId: 'char-stable',
      targetChatId: 'chat-target',
      generationInfo: { generationId: 'gen-stable' },
    })

    expect(result.status).toBe('ok')
    expect(order).toEqual(['first:start', 'first:end', 'second'])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      characterIndex: 0,
      chatIndex: 1,
      messageIndex: 0,
    })
    expect(target.message[0].data).toBe('listener-visible final text')
    expect(char.name).toBe('Stable Character')
  })

  it('reconciles a cancelled terminal without running success-only terminal effects', async () => {
    const { char, target } = seedReorderedTerminalChats()
    target.message[0].data = 'persisted partial reply'
    const listener = vi.fn()
    addChatOutputListener('output', listener)

    const result = await applyServerBackedTerminal({
      terminal: {
        status: 'cancelled',
        reattachOutcome: 'cancelled',
        sideEffects: [{ kind: 'tts', payload: { text: 'must not speak' } }],
        done: {
          outcome: 'cancelled',
          result: 'persisted partial reply',
          alternates: ['must not become an alternate'],
          postGeneration: {
            finalText: 'must not replace the cancelled partial',
            messagePatch: makePostGenerationPatch('chat-target', 'must not patch'),
          },
        },
      },
      currentChar: char,
      currentChat: target,
      selectedChar: 0,
      selectedChat: 0,
      targetCharacterId: 'char-stable',
      targetChatId: 'chat-target',
      generationInfo: { generationId: 'gen-stable' },
      streamProjection: {
        chatId: 'chat-target',
        messageId: 'gen-stable',
        generationId: 'gen-stable',
        previousData: '',
        ownedData: 'persisted partial reply',
        appended: true,
      },
    })

    expect(result).toMatchObject({ status: 'cancelled', reattachOutcome: 'cancelled', resendChat: false })
    expect(target.message[0].data).toBe('persisted partial reply')
    expect(target.scriptstate).toBeUndefined()
    expect(listener).not.toHaveBeenCalled()
    expect(ttsMock.say).not.toHaveBeenCalled()
    expect(inlayMock.run).not.toHaveBeenCalled()
    expect(getRerollBuffer()).toEqual([])
  })

  it('discards a late inlay completion after a newer message edit intent', async () => {
    const { char, target } = seedReorderedTerminalChats()
    const completion = deferred<string>()
    inlayMock.run.mockReturnValueOnce({ text: '[Generating...]', promise: completion.promise })

    const applying = applyServerBackedTerminal({
      terminal: { status: 'done', done: { postGeneration: { finalText: '<ImgGen="cat">' } } },
      currentChar: char,
      currentChat: target,
      selectedChar: 0,
      selectedChat: 0,
      targetCharacterId: 'char-stable',
      targetChatId: 'chat-target',
      generationInfo: { generationId: 'gen-stable' },
    })
    await Promise.resolve()
    expect(target.message[0].data).toBe('[Generating...]')

    markChatMessageMutationIntent('chat-target')
    target.message[0].data = 'newer saved edit'
    completion.resolve('{{inlay::asset-stale}}')
    await applying

    expect(target.message[0].data).toBe('newer saved edit')
    expect(inlayFinalizationMock.finalize).not.toHaveBeenCalled()
  })

  it('uses the intent epoch to reject edit-away-then-back inlay races', async () => {
    const { char, target } = seedReorderedTerminalChats()
    const completion = deferred<string>()
    inlayMock.run.mockReturnValueOnce({ text: '[Generating...]', promise: completion.promise })

    const applying = applyServerBackedTerminal({
      terminal: { status: 'done', done: { postGeneration: { finalText: '<ImgGen="cat">' } } },
      currentChar: char,
      currentChat: target,
      selectedChar: 0,
      selectedChat: 0,
      targetCharacterId: 'char-stable',
      targetChatId: 'chat-target',
      generationInfo: { generationId: 'gen-stable' },
    })
    await Promise.resolve()

    markChatMessageMutationIntent('chat-target')
    target.message[0].data = 'temporary edit'
    target.message[0].data = '[Generating...]'
    completion.resolve('{{inlay::asset-stale}}')
    await applying

    expect(target.message[0].data).toBe('[Generating...]')
    expect(inlayFinalizationMock.finalize).not.toHaveBeenCalled()
  })

  it('applies an unchanged inlay completion exactly once', async () => {
    const { char, target } = seedReorderedTerminalChats()
    const completion = deferred<string>()
    inlayMock.run.mockReturnValueOnce({ text: '[Generating...]', promise: completion.promise })

    const applying = applyServerBackedTerminal({
      terminal: { status: 'done', done: { postGeneration: { finalText: '<ImgGen="cat">' } } },
      currentChar: char,
      currentChat: target,
      selectedChar: 0,
      selectedChat: 0,
      targetCharacterId: 'char-stable',
      targetChatId: 'chat-target',
      generationInfo: { generationId: 'gen-stable' },
    })
    await Promise.resolve()

    completion.resolve('{{inlay::asset-current}}')
    await applying

    expect(target.message[0].data).toBe('{{inlay::asset-current}}')
    expect(inlayFinalizationMock.finalize).toHaveBeenCalledWith({
      chatId: 'chat-target',
      messageId: 'gen-stable',
      generationId: 'gen-stable',
      expectedData: '<ImgGen="cat">',
      finalData: '{{inlay::asset-current}}',
    })
  })

  it('persists an immediate emotion transformation before keeping it visible', async () => {
    const { char, target } = seedReorderedTerminalChats()
    inlayMock.run.mockReturnValueOnce({ text: 'reply {{emotion::happy}}' })

    await applyServerBackedTerminal({
      terminal: { status: 'done', done: { postGeneration: { finalText: 'reply <Emotion="happy">' } } },
      currentChar: char,
      currentChat: target,
      selectedChar: 0,
      selectedChat: 0,
      targetCharacterId: 'char-stable',
      targetChatId: 'chat-target',
      generationInfo: { generationId: 'gen-stable' },
    })

    expect(inlayFinalizationMock.finalize).toHaveBeenCalledWith({
      chatId: 'chat-target',
      messageId: 'gen-stable',
      generationId: 'gen-stable',
      expectedData: 'reply <Emotion="happy">',
      finalData: 'reply {{emotion::happy}}',
    })
    expect(target.message[0].data).toBe('reply {{emotion::happy}}')
  })

  it('restores authoritative model text when an inlay finalization fails', async () => {
    const { char, target } = seedReorderedTerminalChats()
    inlayMock.run.mockReturnValueOnce({ text: 'reply {{emotion::happy}}' })
    inlayFinalizationMock.finalize.mockResolvedValueOnce(false)

    await applyServerBackedTerminal({
      terminal: { status: 'done', done: { postGeneration: { finalText: 'reply <Emotion="happy">' } } },
      currentChar: char,
      currentChat: target,
      selectedChar: 0,
      selectedChat: 0,
      targetCharacterId: 'char-stable',
      targetChatId: 'chat-target',
      generationInfo: { generationId: 'gen-stable' },
    })

    expect(target.message[0].data).toBe('reply <Emotion="happy">')
  })

  it('seeds live reroll navigation from terminal multi-generation choices', async () => {
    const { char, target } = seedReorderedTerminalChats()
    char.chatPage = 1
    target.message[0].data = 'primary reply'

    const result = await applyServerBackedTerminal({
      terminal: {
        status: 'done',
        done: {
          result: 'primary reply',
          generationId: 'gen-stable',
          alternates: ['second reply', 'third reply'],
        },
      },
      currentChar: char,
      currentChat: target,
      selectedChar: 0,
      selectedChat: 0,
      targetCharacterId: 'char-stable',
      targetChatId: 'chat-target',
      generationInfo: { generationId: 'gen-stable' },
    })

    expect(result.status).toBe('ok')
    expect(getRerollBuffer().map((candidate) => candidate[0]?.data)).toEqual([
      'primary reply',
      'second reply',
      'third reply',
    ])
    expect(getRerollBuffer().map((candidate) => candidate[0]?.chatId)).toEqual([
      'gen-stable',
      'gen-stable:alternate:1',
      'gen-stable:alternate:2',
    ])
    expect(getRerollId()).toBe(0)
  })

  it('keeps background terminal alternates for an already-resident chat until it is reopened', async () => {
    const { char, target } = seedReorderedTerminalChats()
    target.message[0].data = 'primary reply'

    await applyServerBackedTerminal({
      terminal: {
        status: 'done',
        done: {
          result: 'primary reply',
          generationId: 'gen-stable',
          alternates: ['other reply'],
        },
      },
      currentChar: char,
      currentChat: target,
      selectedChar: 0,
      selectedChat: 1,
      targetCharacterId: 'char-stable',
      targetChatId: 'chat-target',
      generationInfo: { generationId: 'gen-stable' },
    })

    expect(char.chats[char.chatPage].id).toBe('chat-stale-index')
    expect(getRerollBuffer()).toEqual([])
    expect(getRerollId()).toBe(-1)

    char.chatPage = 1
    expect(getRerollBuffer().map((candidate) => candidate[0]?.data)).toEqual(['primary reply', 'other reply'])
    expect(getRerollId()).toBe(0)
    expect(hydrationMock.hydrate).not.toHaveBeenCalled()
  })

  it('applies terminal post-generation patches to the stable chat id after chat reorder', async () => {
    const { char, target, staleIndexChat } = seedReorderedTerminalChats()
    const generationInfo: MessageGenerationInfo = { generationId: 'gen-stable' }

    const result = await applyServerBackedTerminal({
      terminal: {
        status: 'done',
        done: {
          postGeneration: {
            finalText: 'patched then finalized',
            messagePatch: makePostGenerationPatch('chat-target', 'patched text'),
          },
        },
      },
      currentChar: char,
      currentChat: target,
      selectedChar: 0,
      selectedChat: 0,
      targetCharacterId: 'char-stable',
      targetChatId: 'chat-target',
      generationInfo,
    })

    expect(result.status).toBe('ok')
    expect(result.currentChat.id).toBe('chat-target')
    expect(target.message).toHaveLength(1)
    expect(target.message[0].data).toBe('patched then finalized')
    expect(target.scriptstate).toEqual({ $mood: 'steady' })
    expect(staleIndexChat.message[0].data).toBe('stale original')
    expect(staleIndexChat.scriptstate).toBeUndefined()
  })

  it('applies an embedded succeeded translation before terminal generation UI settlement', async () => {
    const { char, target } = seedReorderedTerminalChats()

    const result = await applyServerBackedTerminal({
      terminal: {
        status: 'done',
        done: {
          postGeneration: {
            messageId: 'gen-stable',
            translation: {
              status: 'succeeded',
              jobId: 'translation-job-1',
              translation: {
                source: 'raw',
                text: 'translated target',
                sourceHash: 'source-hash',
                targetLanguage: 'ko',
                inputLanguage: 'en',
                translatorType: 'google',
                settingsHash: 'settings-hash',
                updatedAt: 123,
              },
            },
          },
        },
      },
      currentChar: char,
      currentChat: target,
      selectedChar: 0,
      selectedChat: 0,
      targetCharacterId: 'char-stable',
      targetChatId: 'chat-target',
      generationInfo: { generationId: 'gen-stable' },
    })

    expect(result.status).toBe('ok')
    expect(target.message[0].translation?.text).toBe('translated target')
  })

  it('mirrors a terminal patch before slow TTS and preserves a newer saved edit', async () => {
    const { char, target } = seedReorderedTerminalChats()
    const tts = deferred<void>()
    ttsMock.say.mockReturnValueOnce(tts.promise)

    const applying = applyServerBackedTerminal({
      terminal: {
        status: 'done',
        sideEffects: [{ kind: 'tts', payload: { text: 'patched then finalized' } }],
        done: {
          postGeneration: {
            finalText: 'patched then finalized',
            messagePatch: makePostGenerationPatch('chat-target', 'patched text'),
          },
        },
      },
      currentChar: char,
      currentChat: target,
      selectedChar: 0,
      selectedChat: 0,
      targetCharacterId: 'char-stable',
      targetChatId: 'chat-target',
      generationInfo: { generationId: 'gen-stable' },
    })

    await vi.waitFor(() => expect(ttsMock.say).toHaveBeenCalledOnce())
    expect(target.message[0].data).toBe('patched then finalized')
    expect(target.scriptstate).toEqual({ $mood: 'steady' })

    markChatMessageMutationIntent('chat-target')
    target.message[0].data = 'newer saved edit'
    tts.resolve()
    await applying

    expect(target.message[0].data).toBe('newer saved edit')
  })

  it('applies terminal final text before surfacing an Agent Preset terminal error', async () => {
    const { char, target, staleIndexChat } = seedReorderedTerminalChats()
    const generationInfo: MessageGenerationInfo = { generationId: 'gen-stable' }

    const result = await applyServerBackedTerminal({
      terminal: {
        status: 'done',
        done: {
          postGeneration: {
            finalText: 'preserved main output',
            agentPresetError: {
              error: 'agent_preset_generation_failed',
              message: 'Agent Preset step failed: Rewrite Output: provider exploded',
              statusCode: 422,
              phase: 'afterMain',
              stepId: 'aps_after',
              stepName: 'Rewrite Output',
              outputKey: 'rewrite',
            },
          },
        },
      },
      currentChar: char,
      currentChat: target,
      selectedChar: 0,
      selectedChat: 0,
      targetCharacterId: 'char-stable',
      targetChatId: 'chat-target',
      generationInfo,
    })

    if (result.status !== 'failed') {
      throw new Error(`Expected failed terminal result, got ${result.status}`)
    }
    expect(result.error).toContain('Agent Preset step failed')
    expect(result.currentChat.id).toBe('chat-target')
    expect(target.message[0].data).toBe('preserved main output')
    expect(staleIndexChat.message[0].data).toBe('stale original')
  })

  it('skips terminal mirroring when stable patch ids are present but no live chat matches', async () => {
    const { char, target, staleIndexChat } = seedReorderedTerminalChats()

    const result = await applyServerBackedTerminal({
      terminal: {
        status: 'done',
        done: {
          postGeneration: {
            finalText: 'should not land anywhere',
            messagePatch: makePostGenerationPatch('missing-chat', 'missing patch text'),
          },
        },
      },
      currentChar: char,
      currentChat: target,
      selectedChar: 0,
      selectedChat: 0,
      targetCharacterId: 'char-stable',
      targetChatId: 'chat-target',
      generationInfo: { generationId: 'gen-stable' },
    })

    expect(result.status).toBe('ok')
    expect(result.currentChat.id).toBe('chat-target')
    expect(target.message[0].data).toBe('target original')
    expect(staleIndexChat.message[0].data).toBe('stale original')
    expect(staleIndexChat.scriptstate).toBeUndefined()
  })

  it('restores terminal errors to the stable chat id instead of a stale selectedChat index', async () => {
    const { char, target, staleIndexChat } = seedReorderedTerminalChats()

    const result = await applyServerBackedTerminal({
      terminal: {
        status: 'error',
        error: 'provider failed',
        restoration: makeRestoration('chat-target'),
      },
      currentChar: char,
      currentChat: target,
      selectedChar: 0,
      selectedChat: 0,
      targetCharacterId: 'char-stable',
      targetChatId: 'chat-target',
      generationInfo: { generationId: 'gen-stable' },
    })

    expect(result.status).toBe('failed')
    expect(result.currentChat.id).toBe('chat-target')
    expect(target.message).toEqual([{ role: 'user', data: 'restored user', chatId: 'restored-user' }])
    expect(target.scriptstate).toEqual({ $restored: 'yes' })
    expect(target.isStreaming).toBe(false)
    expect(staleIndexChat.message[0].data).toBe('stale original')
    expect(staleIndexChat.scriptstate).toBeUndefined()
  })

  it('does not apply an assembly restoration after a newer message mutation intent', async () => {
    const { char, target, staleIndexChat } = seedReorderedTerminalChats()
    const restorationGuard = captureServerBackedRestorationGuard('chat-target')
    target.message[0].data = 'accepted newer edit'
    markChatMessageMutationIntent('chat-target')

    const result = await applyServerBackedTerminal({
      terminal: {
        status: 'error',
        error: 'provider failed late',
        restoration: makeRestoration('chat-target'),
      },
      currentChar: char,
      currentChat: target,
      selectedChar: 0,
      selectedChat: 0,
      targetCharacterId: 'char-stable',
      targetChatId: 'chat-target',
      generationInfo: { generationId: 'gen-stable' },
      restorationGuard,
    })

    expect(result.status).toBe('failed')
    expect(target.message[0].data).toBe('accepted newer edit')
    expect(target.scriptstate).toBeUndefined()
    expect(staleIndexChat.message[0].data).toBe('stale original')
  })

  it('removes a still-owned optimistic reply after terminal persistence rejection', async () => {
    const { char, target } = seedReorderedTerminalChats()
    target.message = [terminalMessage('streamed but rejected')]

    const result = await applyServerBackedTerminal({
      terminal: {
        status: 'error',
        error: 'Generation finalization target is stale',
        persistenceDisposition: 'rejected',
        generationProjection: {
          characterId: 'char-stable',
          chatId: 'chat-target',
          generationId: 'gen-stable',
          mode: 'send',
        },
      },
      currentChar: char,
      currentChat: target,
      selectedChar: 0,
      selectedChat: 0,
      targetCharacterId: 'char-stable',
      targetChatId: 'chat-target',
      generationInfo: { generationId: 'gen-stable' },
      streamProjection: {
        chatId: 'chat-target',
        messageId: 'gen-stable',
        generationId: 'gen-stable',
        previousData: '',
        ownedData: 'streamed but rejected',
        appended: true,
      },
    })

    expect(result.status).toBe('failed')
    expect(target.message).toEqual([])
    expect(hydrationMock.hydrate).toHaveBeenCalledWith('chat-target', { force: true, strict: true })
  })

  it('keeps a retry-queued reply visibly provisional until authoritative persistence', async () => {
    const { char, target } = seedReorderedTerminalChats()
    target.message = [terminalMessage('streamed and queued')]

    const result = await applyServerBackedTerminal({
      terminal: {
        status: 'error',
        error: 'database temporarily unavailable',
        persistenceDisposition: 'queued',
        generationProjection: {
          characterId: 'char-stable',
          chatId: 'chat-target',
          generationId: 'gen-stable',
          mode: 'send',
        },
      },
      currentChar: char,
      currentChat: target,
      selectedChar: 0,
      selectedChat: 0,
      targetCharacterId: 'char-stable',
      targetChatId: 'chat-target',
      generationInfo: { generationId: 'gen-stable' },
      streamProjection: {
        chatId: 'chat-target',
        messageId: 'gen-stable',
        generationId: 'gen-stable',
        previousData: '',
        ownedData: 'streamed and queued',
        appended: true,
      },
    })

    expect(result.status).toBe('failed')
    expect(target.message[0].data).toBe('streamed and queued')
    expect(get(queuedGenerationPersistences)).toEqual([
      { chatId: 'chat-target', messageId: 'gen-stable', generationId: 'gen-stable' },
    ])
  })

  it('clears provisional state only when hydration confirms the queued generation', () => {
    queuedGenerationPersistences.set([
      { chatId: 'chat-target', messageId: 'continued-message', generationId: 'new-generation' },
    ])

    acknowledgeHydratedGenerationPersistences('chat-target', [
      {
        role: 'char',
        data: 'old persisted text',
        chatId: 'continued-message',
        generationInfo: { generationId: 'old-generation' },
      },
    ])
    expect(get(queuedGenerationPersistences)).toHaveLength(1)

    acknowledgeHydratedGenerationPersistences('chat-target', [
      {
        role: 'char',
        data: 'new persisted text',
        chatId: 'continued-message',
        generationInfo: { generationId: 'new-generation' },
      },
    ])
    expect(get(queuedGenerationPersistences)).toEqual([])
  })

  it('does not remove a newer edit of an optimistic reply after persistence rejection', async () => {
    const { char, target } = seedReorderedTerminalChats()
    target.message = [terminalMessage('newer user edit')]

    await applyServerBackedTerminal({
      terminal: {
        status: 'error',
        error: 'Generation finalization target is stale',
        persistenceDisposition: 'rejected',
        generationProjection: {
          characterId: 'char-stable',
          chatId: 'chat-target',
          generationId: 'gen-stable',
          mode: 'send',
        },
      },
      currentChar: char,
      currentChat: target,
      selectedChar: 0,
      selectedChat: 0,
      targetCharacterId: 'char-stable',
      targetChatId: 'chat-target',
      generationInfo: { generationId: 'gen-stable' },
      streamProjection: {
        chatId: 'chat-target',
        messageId: 'gen-stable',
        generationId: 'gen-stable',
        previousData: '',
        ownedData: 'older streamed value',
        appended: true,
      },
    })

    expect(target.message[0].data).toBe('newer user edit')
    expect(hydrationMock.hydrate).toHaveBeenCalledWith('chat-target', { force: true, strict: true })
  })
})
