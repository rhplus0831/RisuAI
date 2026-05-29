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
  autoContinue: {
    next: { shouldContinue: false, resultTokens: 0 } as unknown,
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

vi.mock('../autoContinue', () => ({
  evaluateAutoContinue: async () => {
    fakes.autoContinue.calls++
    return fakes.autoContinue.next
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

import {
  setDatabase,
  type Chat,
  type Database,
  type character,
} from '../../storage/database.svelte'
import {
  orchestrateResponse,
  type OrchestrateResponseResult,
} from '../postGeneration/orchestrateResponse'
import type { DispatchSuccessReq } from '../dispatch/dispatchRequest'

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
    autoContinueMinTokens: 0,
    autoContinueChat: false,
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
  fakes.autoContinue.calls = 0
  fakes.igp.calls = 0
  fakes.inlay.calls = 0
  fakes.tts.calls = 0
  fakes.stream.next = null
  fakes.nonStream.next = null
  fakes.output.next = null
  fakes.autoContinue.next = { shouldContinue: false, resultTokens: 0 }
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
    // Streaming branch reassigns local currentChat from triggerChat.
    expect(result.currentChat).toBe(triggeredChat)
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
    }

    const result = await orchestrateResponse(baseArgs())

    expect(result).toEqual({ status: 'aborted' } satisfies OrchestrateResponseResult)
    expect(fakes.output.calls).toBe(0)
    expect(fakes.inlay.calls).toBe(0)
    expect(fakes.tts.calls).toBe(0)
    expect(fakes.rerolls.calls).toHaveLength(0)
    expect(fakes.autoContinue.calls).toBe(0)
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
    fakes.nonStream.next = { result: 'done', emoChanged: true, mrerolls: ['a', 'b', 'c'] }
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
    // Asymmetry: local currentChat NOT reassigned (non-stream writes only to DB).
    if (result.status !== 'done') throw new Error('unexpected status')
    expect(result.currentChat).toBe(initialCurrentChat)
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
    fakes.nonStream.next = { result: 'done', emoChanged: false, mrerolls: ['only'] }
    fakes.output.next = { chat: makeChat(), triggerChat: null, resendChat: false }

    await orchestrateResponse(
      baseArgs({ req: { type: 'success', result: 'done' } as unknown as DispatchSuccessReq }),
    )

    expect(fakes.rerolls.calls).toHaveLength(0)
  })
})

describe('orchestrateResponse - auto-continue handoff', () => {
  it('returns continue with resultTokens and skips IGP', async () => {
    seedDb()
    fakes.stream.next = {
      result: 'short',
      emoChanged: false,
      msgIndex: 0,
      lastResponseChunk: {},
      streamAborted: false,
    }
    fakes.output.next = { chat: makeChat(), triggerChat: null, resendChat: false }
    fakes.autoContinue.next = { shouldContinue: true, resultTokens: 42 }

    const result = await orchestrateResponse(baseArgs())

    expect(result).toEqual({ status: 'continue', resultTokens: 42 })
    expect(fakes.igp.calls).toBe(0)
  })
})

describe('orchestrateResponse - server-owned post-generation (A2)', () => {
  it('skips applyOutputTrigger, inlay, and TTS on the server-owned path', async () => {
    // Slice 4 (A2): the server runs the run-var pass, `'output'` trigger, and
    // `editoutput`; the browser relays the stream for display only. The durable
    // derivation (`applyOutputTrigger`) is removed here — it is consumed from the
    // terminal patch (`applyServerBackedTerminal`) instead. Inlay + final text +
    // resend are applied at terminal time, so none of those fire in this branch.
    seedDb({ ttsAutoSpeech: true })
    fakes.stream.next = {
      result: 'streamed',
      emoChanged: false,
      msgIndex: 0,
      lastResponseChunk: { '0': 'streamed' },
      streamAborted: false,
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
    }
    fakes.output.next = { chat: makeChat(), triggerChat: triggered, resendChat: true }

    const result = await orchestrateResponse(baseArgs())

    if (result.status !== 'done') throw new Error('unexpected status')
    expect(result.currentChat).toBe(triggered)
    expect(result.result).toBe('final')
    expect(result.emoChanged).toBe(true)
    expect(result.resendChat).toBe(true)
    // IGP runs once on the done path.
    expect(fakes.igp.calls).toBe(1)
  })
})
