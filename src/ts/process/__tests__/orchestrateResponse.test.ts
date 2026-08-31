import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock all eight delegated helpers. Each fake records its calls into a
// hoisted holder so tests can stage return values and assert on what fired
// without re-testing the helpers' own logic (covered by their own files).
const fakes = vi.hoisted(() => ({
  stream: {
    next: null as unknown,
    calls: 0,
  },
  nonStream: {
    next: null as unknown,
    calls: 0,
  },
  output: {
    next: null as unknown,
    calls: 0,
  },
  igp: { calls: 0 },
  inlay: { calls: 0, next: { text: 'inlay-text' } as { text: string; promise?: Promise<string> } },
  tts: { calls: 0 },
  rerolls: { calls: [] as { id: string; arr: unknown[] }[] },
}))

vi.mock('../postGeneration/streamResponse', () => ({
  consumeStreamResponse: async () => {
    fakes.stream.calls++
    return fakes.stream.next
  },
}))

vi.mock('../postGeneration/nonStreamResponse', () => ({
  applyNonStreamResponse: async () => {
    fakes.nonStream.calls++
    return fakes.nonStream.next
  },
}))

vi.mock('../postGeneration/outputTrigger', () => ({
  applyOutputTrigger: async () => {
    fakes.output.calls++
    return fakes.output.next
  },
}))

vi.mock('../postGeneration/igp', () => ({
  evaluateIgp: async () => {
    fakes.igp.calls++
  },
}))

vi.mock('../inlayScreen', () => ({
  runInlayScreen: () => {
    fakes.inlay.calls++
    return fakes.inlay.next
  },
}))

vi.mock('../tts', () => ({
  sayTTS: async () => {
    fakes.tts.calls++
  },
}))

vi.mock('../prereroll', () => ({
  addRerolls: (id: string, arr: unknown[]) => {
    fakes.rerolls.calls.push({ id, arr })
  },
}))

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

import { setDatabase, type Chat, type Database, type character } from '../../storage/database.svelte'
import { orchestrateResponse, type OrchestrateResponseResult } from '../postGeneration/orchestrateResponse'
import type { DispatchSuccessReq } from '../dispatch/dispatchRequest'
import { getDatabase } from 'src/ts/__tests__/resourceDatabaseState'

function makeChar(overrides: Partial<character> = {}): character {
  return {
    type: 'character',
    name: 'Tess',
    chaId: 'cha-1',
    desc: '',
    chats: [],
    chatPage: 0,
    customscript: [],
    triggerscript: [],
    exampleMessage: '',
    ...overrides,
  } as unknown as character
}

function makeChat(): Chat {
  return {
    id: 'chat-1',
    name: 'main',
    note: '',
    localLore: [],
    scriptstate: {},
    fmIndex: -1,
    message: [{ role: 'char', data: 'placeholder', chatId: 'm0', time: 0 }],
  } as unknown as Chat
}

function seedDb(extra: Partial<Database> = {}) {
  const char = makeChar({ chats: [makeChat()] })
  setDatabase({
    aiModel: 'gpt-4o',
    subModel: 'gpt-4o',
    characters: [char],
    ttsAutoSpeech: false,
    ...extra,
  } as unknown as Database)
}

function baseArgs(over: Partial<Parameters<typeof orchestrateResponse>[0]> = {}) {
  return {
    req: { type: 'streaming', result: 'fake-stream' } as unknown as DispatchSuccessReq,
    arg: {},
    nowChatroom: makeChar(),
    currentChar: makeChar(),
    currentChat: makeChat(),
    selectedChar: 0,
    selectedChat: 0,
    targetCharacterId: 'cha-1',
    targetChatId: 'chat-1',
    generationId: 'gen-1',
    generationInfo: {} as never,
    promptInfo: {} as never,
    abortSignal: new AbortController().signal,
    reformatContent: (s: string) => s,
    runCurrentChatFunction: (c: Chat) => c,
    ...over,
  }
}

beforeEach(() => {
  fakes.stream.calls = 0
  fakes.nonStream.calls = 0
  fakes.output.calls = 0
  fakes.igp.calls = 0
  fakes.inlay.calls = 0
  fakes.tts.calls = 0
  fakes.stream.next = null
  fakes.nonStream.next = null
  fakes.output.next = null
  fakes.inlay.next = { text: 'inlay-text' }
  fakes.rerolls.calls = []
})

describe('orchestrateResponse - streaming branch', () => {
  it('routes through consumeStreamResponse and fires streaming-only side effects', async () => {
    seedDb({ ttsAutoSpeech: true })
    const triggeredChat = makeChat()
    triggeredChat.message[0].data = 'after-trigger'
    fakes.stream.next = {
      result: 'streamed',
      emoChanged: false,
      msgIndex: 0,
      lastResponseChunk: { '0': 'streamed' },
      streamAborted: false,
      projection: { chatId: 'chat-1', messageId: 'm0', generationId: 'gen-1' },
    }
    fakes.output.next = { chat: makeChat(), triggerChat: triggeredChat, resendChat: false }

    const result = await orchestrateResponse(baseArgs())

    expect(result.status).toBe('done')
    expect(fakes.stream.calls).toBe(1)
    expect(fakes.nonStream.calls).toBe(0)
    expect(fakes.inlay.calls).toBe(1)
    expect(fakes.tts.calls).toBe(1)
    expect(fakes.rerolls.calls).toHaveLength(1)
    expect(fakes.rerolls.calls[0]).toEqual({ id: 'gen-1', arr: ['streamed'] })
    if (result.status !== 'done') throw new Error('unexpected status')
    expect(result.currentChat.id).toBe('chat-1')
    expect(result.currentChat.message[0].data).toBe('inlay-text')
    expect(result.result).toBe('streamed')
    expect(result.resendChat).toBe(false)
  })

  it('returns aborted when streamAborted=true and short-circuits all post-stream work', async () => {
    seedDb()
    fakes.stream.next = {
      result: 'partial',
      emoChanged: false,
      msgIndex: 0,
      lastResponseChunk: {},
      streamAborted: true,
      projection: { chatId: 'chat-1', messageId: 'm0', generationId: 'gen-1' },
    }

    const result = await orchestrateResponse(baseArgs())

    expect(result).toEqual({ status: 'aborted' } satisfies OrchestrateResponseResult)
    expect(fakes.output.calls).toBe(0)
    expect(fakes.inlay.calls).toBe(0)
    expect(fakes.tts.calls).toBe(0)
    expect(fakes.rerolls.calls).toHaveLength(0)
    expect(fakes.igp.calls).toBe(0)
  })

  it('returns aborted when abortSignal.aborted=true even if stream completed normally', async () => {
    seedDb()
    const ac = new AbortController()
    ac.abort()
    fakes.stream.next = {
      result: 'done',
      emoChanged: false,
      msgIndex: 0,
      lastResponseChunk: {},
      streamAborted: false,
      projection: { chatId: 'chat-1', messageId: 'm0', generationId: 'gen-1' },
    }

    const result = await orchestrateResponse(baseArgs({ abortSignal: ac.signal }))

    expect(result.status).toBe('aborted')
    expect(fakes.output.calls).toBe(0)
  })
})

describe('orchestrateResponse - non-streaming branch', () => {
  it('routes through applyNonStreamResponse and writes triggerChat directly to DB', async () => {
    seedDb()
    const triggerChat = makeChat()
    triggerChat.message[0].data = 'rewritten'
    fakes.nonStream.next = { result: 'done', emoChanged: true, mrerolls: ['a', 'b', 'c'], messageId: 'm0' }
    fakes.output.next = { chat: makeChat(), triggerChat, resendChat: true }

    const initialCurrentChat = makeChat()
    const result = await orchestrateResponse(
      baseArgs({
        req: { type: 'success', result: 'done' } as unknown as DispatchSuccessReq,
        currentChat: initialCurrentChat,
      }),
    )

    expect(result.status).toBe('done')
    expect(fakes.stream.calls).toBe(0)
    expect(fakes.nonStream.calls).toBe(1)
    if (result.status !== 'done') throw new Error('unexpected status')
    expect(result.currentChat).toBe(triggerChat)
    expect(result.emoChanged).toBe(true)
    expect(result.resendChat).toBe(true)
    // DB writeback happened via the helper (verified indirectly via output trigger call).
    expect(fakes.output.calls).toBe(1)
    // mrerolls.length > 1 means addRerolls fired.
    expect(fakes.rerolls.calls).toHaveLength(1)
    // No inlay / TTS on non-streaming branch.
    expect(fakes.inlay.calls).toBe(0)
    expect(fakes.tts.calls).toBe(0)
  })

  it('skips addRerolls when mrerolls.length <= 1', async () => {
    seedDb()
    fakes.nonStream.next = { result: 'done', emoChanged: false, mrerolls: ['only'], messageId: 'm0' }
    fakes.output.next = { chat: makeChat(), triggerChat: null, resendChat: false }

    await orchestrateResponse(baseArgs({ req: { type: 'success', result: 'done' } as unknown as DispatchSuccessReq }))

    expect(fakes.rerolls.calls).toHaveLength(0)
  })
})

describe('orchestrateResponse - server-owned post-generation', () => {
  it('defers output trigger, inlay, TTS, and IGP to the server terminal path', async () => {
    // The server runs the run-var pass, `'output'` trigger, and `editoutput`;
    // the browser relays the stream for display only. Final text, inlay, and
    // resend are consumed from the terminal patch instead of derived here.
    seedDb({ ttsAutoSpeech: true })
    fakes.stream.next = {
      result: 'streamed',
      emoChanged: false,
      msgIndex: 0,
      lastResponseChunk: { '0': 'streamed' },
      streamAborted: false,
      projection: { chatId: 'chat-1', messageId: 'm0', generationId: 'gen-1' },
    }
    // Stage a trigger result that WOULD fire if applyOutputTrigger were called.
    fakes.output.next = { chat: makeChat(), triggerChat: makeChat(), resendChat: true }

    const result = await orchestrateResponse(baseArgs({ serverOwnsPostGeneration: true }))

    expect(result.status).toBe('done')
    if (result.status !== 'done') throw new Error('unexpected status')
    // The stream was still relayed for display…
    expect(fakes.stream.calls).toBe(1)
    // …but the browser did NOT re-derive: no output trigger, no inlay, no TTS here.
    expect(fakes.output.calls).toBe(0)
    expect(fakes.inlay.calls).toBe(0)
    expect(fakes.tts.calls).toBe(0)
    expect(fakes.igp.calls).toBe(0)
    // Resend is reported from the terminal, not derived here.
    expect(result.resendChat).toBe(false)
  })
})

describe('orchestrateResponse - happy path returns', () => {
  it('returns done with all fields populated from the streaming branch', async () => {
    seedDb()
    const triggered = makeChat()
    fakes.stream.next = {
      result: 'final',
      emoChanged: true,
      msgIndex: 0,
      lastResponseChunk: { '0': 'final' },
      streamAborted: false,
      projection: { chatId: 'chat-1', messageId: 'm0', generationId: 'gen-1' },
    }
    fakes.output.next = { chat: makeChat(), triggerChat: triggered, resendChat: true }

    const result = await orchestrateResponse(baseArgs())

    if (result.status !== 'done') throw new Error('unexpected status')
    expect(result.currentChat.id).toBe('chat-1')
    expect(result.currentChat.message[0].data).toBe('inlay-text')
    expect(result.result).toBe('final')
    expect(result.emoChanged).toBe(true)
    expect(result.resendChat).toBe(true)
    // IGP runs once on the done path.
    expect(fakes.igp.calls).toBe(1)
  })
})

function deferredString(): { promise: Promise<string>; resolve: (value: string) => void } {
  let resolve!: (value: string) => void
  const promise = new Promise<string>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('orchestrateResponse - stable asynchronous inlay target', () => {
  it('writes a deferred inlay to the original message after character and message reordering', async () => {
    const other = makeChar({
      chaId: 'cha-2',
      name: 'Other',
      chats: [{ ...makeChat(), id: 'chat-2', message: [{ role: 'char', data: 'other', chatId: 'other-m' }] }],
    })
    seedDb({ characters: [makeChar({ chats: [makeChat()] }), other] })
    const gate = deferredString()
    fakes.stream.next = {
      result: 'streamed',
      emoChanged: false,
      msgIndex: 0,
      lastResponseChunk: { '0': 'streamed' },
      streamAborted: false,
      projection: { chatId: 'chat-1', messageId: 'm0', generationId: 'gen-1' },
    }
    fakes.output.next = { chat: makeChat(), triggerChat: null, resendChat: false }
    fakes.inlay.next = { text: 'pending inlay', promise: gate.promise }

    const pending = orchestrateResponse(baseArgs())
    await vi.waitFor(() => expect(fakes.inlay.calls).toBe(1))
    getDatabase().characters.reverse()
    const targetChat = getDatabase().characters.find((char) => char.chaId === 'cha-1')!.chats[0]
    targetChat.message.unshift({ role: 'char', data: 'inserted', chatId: 'inserted-m' })
    gate.resolve('resolved inlay')
    await pending

    expect(targetChat.message.find((message) => message.chatId === 'm0')?.data).toBe('resolved inlay')
    expect(targetChat.message.find((message) => message.chatId === 'inserted-m')?.data).toBe('inserted')
    expect(getDatabase().characters.find((char) => char.chaId === 'cha-2')!.chats[0].message[0].data).toBe('other')
  })

  it('does not write a deferred inlay through a reused character index after target deletion', async () => {
    const other = makeChar({
      chaId: 'cha-2',
      name: 'Other',
      chats: [{ ...makeChat(), id: 'chat-2', message: [{ role: 'char', data: 'other', chatId: 'other-m' }] }],
    })
    seedDb({ characters: [makeChar({ chats: [makeChat()] }), other] })
    const gate = deferredString()
    fakes.stream.next = {
      result: 'streamed',
      emoChanged: false,
      msgIndex: 0,
      lastResponseChunk: { '0': 'streamed' },
      streamAborted: false,
      projection: { chatId: 'chat-1', messageId: 'm0', generationId: 'gen-1' },
    }
    fakes.output.next = { chat: makeChat(), triggerChat: null, resendChat: false }
    fakes.inlay.next = { text: 'pending inlay', promise: gate.promise }

    const pending = orchestrateResponse(baseArgs())
    await vi.waitFor(() => expect(fakes.inlay.calls).toBe(1))
    getDatabase().characters.splice(0, 1)
    gate.resolve('resolved inlay')
    await pending

    expect(getDatabase().characters[0].chaId).toBe('cha-2')
    expect(getDatabase().characters[0].chats[0].message[0].data).toBe('other')
  })
})
