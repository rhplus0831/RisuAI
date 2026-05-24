import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Server-backed dual-mode sweep (Phase 6-3). Unlike sendChat.fixtures.test.ts,
// this file does NOT vi.mock('../request/request') — the real request module
// loads, the Phase 6-2 branch inside requestChatDataMain fires, and the call
// lands on a stubbed `fetch` that emulates the Phase 6-1 route.
//
// Each dual-mode fixture's expected snapshot is shared with the local sweep
// (under `expected/<name>.json`). The shared subset asserted here is
// everything except `providerCalls` — the local sweep records into the
// provider fake at the requestChatData boundary; the server-backed sweep
// records into `serverCompletionCalls` at the fetch boundary. Both paths
// produce the same chat state, stages, side effects, and lifecycle flags,
// which is what the shared snapshot pins.

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))

vi.mock('../../platform', async (importActual) => {
  const actual = await importActual<typeof import('../../platform')>()
  return {
    ...actual,
    get isFastifyServer() {
      return platformState.isFastifyServer
    },
  }
})

vi.mock('../../storage/nodeStorage', () => ({
  getNodeServerProxyAuth: async () => 'fixture-auth-token',
}))

vi.mock('../tts', () => import('../__fixtures__/mocks/tts'))
vi.mock('../inlayScreen', () => import('../__fixtures__/mocks/inlayScreen'))
vi.mock('../stableDiff', () => import('../__fixtures__/mocks/stableDiff'))
vi.mock('../prereroll', () => import('../__fixtures__/mocks/prereroll'))
vi.mock('../files/inlays', () => import('../__fixtures__/mocks/inlays'))

vi.mock('../memory/hypav3', async (importActual) => {
  const actual = await importActual<typeof import('../memory/hypav3')>()
  const fake = await import('../__fixtures__/mocks/hypav3')
  return { ...actual, hypaMemoryV3: fake.hypaMemoryV3 }
})

vi.mock('../scriptings', () => import('../__fixtures__/mocks/scriptings'))

vi.mock('../triggers', async (importActual) => {
  const actual = await importActual<typeof import('../triggers')>()
  return { ...actual }
})

vi.mock('../transformers', async (importActual) => {
  const actual = await importActual<typeof import('../transformers')>()
  return {
    ...actual,
    runImageEmbedding: async () => [{ generated_text: 'fake caption' }],
  }
})

const uuidState = { counter: 0 }
vi.mock('uuid', () => ({
  v4: () => `uuid-${uuidState.counter++}`,
}))

vi.mock('@mlc-ai/web-tokenizers', () => ({
  Tokenizer: {
    fromJSON: async () => ({
      encode: (text: string) => (text.length === 0 ? [] : text.split(/\s+/)),
    }),
    fromSentencePiece: async () => ({
      encode: (text: string) => (text.length === 0 ? [] : text.split(/\s+/)),
    }),
  },
}))

import { loadFixture } from '../__fixtures__/loadFixture'
import {
  getServerCompletionCalls,
  resetServerCompletionCalls,
  serverCompletionFetch,
  setAnthropicResult,
  setBedrockResult,
  setCohereResult,
  setDeepSeekResult,
  setGeminiResult,
  setHordeResult,
  setMistralResult,
  setOpenAIResult,
} from '../__fixtures__/mocks/serverCompletionFetch'
import {
  getServerChatCalls,
  resetServerChatState,
  serverChatFetch,
  setServerChatDispatchError,
  setServerChatDispatchResult,
  setServerChatInfo,
  setServerChatMessagePatch,
  setServerChatPrompt,
} from '../__fixtures__/mocks/serverChatFetch'
import { getSideEffectCalls, resetSideEffectCalls } from '../__fixtures__/sideEffects'
import { loadProviderScript, resetProviderState } from '../__fixtures__/providerFake'
import { type FixtureSnapshot, captureSnapshot, recordStages } from '../__fixtures__/snapshot'
import { DBState } from '../../stores.svelte'
import type { Chat } from '../../storage/database.svelte'
import { abortChat, chatProcessStage, doingChat, sendChat } from '../index.svelte'

const HERE = dirname(fileURLToPath(import.meta.url))

const DUAL_MODE_FIXTURES = [
  'echo-basic',
  'openai-basic',
  'anthropic-basic',
  'mistral-basic',
  'cohere-basic',
  'deepseek-basic',
  'gemini-basic',
  'gemini-vertex-basic',
  'bedrock-basic',
  'horde-basic',
  'mistral-reverse-proxy-basic',
  'anthropic-reverse-proxy-basic',
] as const

interface ExpectedCall {
  provider: string
  model: string
  stream: boolean
  options: unknown
}

const EXPECTED_CALL: Record<(typeof DUAL_MODE_FIXTURES)[number], ExpectedCall> = {
  'echo-basic': {
    provider: 'echo',
    model: 'echo_model',
    stream: false,
    options: { echo: { message: 'fixture echo reply', delayMs: 0 } },
  },
  'openai-basic': {
    provider: 'openai',
    model: 'gpt-4o',
    stream: false,
    options: { openai: { apiKey: 'sk-fixture', maxTokens: 200 } },
  },
  'anthropic-basic': {
    provider: 'anthropic',
    model: 'claude-opus-4-7',
    stream: false,
    options: { anthropic: { apiKey: 'sk-ant-fixture', maxTokens: 200 } },
  },
  'mistral-basic': {
    provider: 'mistral',
    model: 'mistral-large-latest',
    stream: false,
    options: { mistral: { apiKey: 'mistral-fixture-key', maxTokens: 200 } },
  },
  'cohere-basic': {
    provider: 'cohere',
    model: 'cohere-command-r-plus-04-2024',
    stream: false,
    // newer command-r releases skip safety_mode='NONE' (server adds nothing).
    options: { cohere: { apiKey: 'cohere-fixture-key' } },
  },
  'deepseek-basic': {
    provider: 'openai',
    model: 'deepseek-chat',
    stream: false,
    // keyIdentifier-keyed deepseek rides the openai variant with a derived
    // baseUrl (modelInfo.endpoint stripped of /chat/completions) and the
    // db.OaiCompAPIKeys['deepseek'] lookup as apiKey.
    options: {
      openai: {
        apiKey: 'deepseek-fixture-key',
        baseUrl: 'https://api.deepseek.com/beta',
        maxTokens: 200,
      },
    },
  },
  'gemini-basic': {
    provider: 'gemini',
    // Wire-level model derived from modelInfo.internalID, stripped of any
    // `models/` prefix that dynamic-registered entries carry.
    model: 'gemini-2.5-flash',
    stream: false,
    options: {
      gemini: {
        apiKey: 'gemini-fixture-key',
        maxOutputTokens: 200,
      },
    },
  },
  'gemini-vertex-basic': {
    provider: 'gemini',
    // Vertex-flavored entry: internalID is the bare model name (no `models/`
    // prefix). The dispatcher swaps Studio key auth for the Vertex bearer block.
    model: 'gemini-2.5-flash',
    stream: false,
    options: {
      gemini: {
        vertex: {
          projectId: 'fixture-project',
          region: 'us-east5',
          clientEmail: 'fixture-sa@fixture-project.iam.gserviceaccount.com',
          privateKey:
            '-----BEGIN PRIVATE KEY-----\nFIXTURE_PRIVATE_KEY\n-----END PRIVATE KEY-----\n',
        },
        maxOutputTokens: 200,
      },
    },
  },
  'bedrock-basic': {
    provider: 'bedrock',
    // claude-sonnet-4-5 + date stamp 20250929 → `global.` prefix per the
    // resolveBedrockWireModel heuristic.
    model: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
    stream: false,
    options: {
      bedrock: {
        credentials: {
          accessKeyId: 'AKIAFIXTUREFAKEKEY',
          secretAccessKey: 'fixture-secret-access-key',
          region: 'us-east-1',
        },
        maxTokens: 200,
      },
    },
  },
  'horde-basic': {
    provider: 'horde',
    // Wire model strips the `horde:::` prefix from aiModel.
    model: 'koboldcpp/Mistral-7B',
    stream: false,
    options: {
      horde: {
        apiKey: 'horde-fixture-key',
        maxTokens: 200,
        // db.maxContext + 100 mirrors the local code at request.ts:1442.
        maxContextLength: 4100,
        topP: 0.9,
        topK: 40,
      },
    },
  },
  'mistral-reverse-proxy-basic': {
    provider: 'mistral',
    // reverse_proxy wire model is db.customProxyRequestModel.
    model: 'mistral-on-proxy',
    stream: false,
    options: {
      mistral: {
        apiKey: 'sk-proxy-mistral-fixture',
        // resolveReverseProxyUrl trims /chat/completions; the server re-appends.
        baseUrl: 'https://proxy.example.com/v1',
        maxTokens: 200,
        additionalParams: [
          ['header::X-Custom', 'cool'],
          ['extra.knob', '1'],
        ],
      },
    },
  },
  'anthropic-reverse-proxy-basic': {
    provider: 'anthropic',
    model: 'claude-on-proxy',
    stream: false,
    options: {
      anthropic: {
        apiKey: 'sk-proxy-anthropic-fixture',
        // resolveReverseProxyAnthropicUrl trims /messages.
        baseUrl: 'https://proxy.example.com/v1',
        maxTokens: 200,
        additionalParams: [
          ['header::anthropic-beta', 'prompt-caching-2024-07-31'],
          ['extra.flag', 'true'],
        ],
      },
    },
  },
}

async function loadExpected(name: string): Promise<FixtureSnapshot> {
  const path = resolve(HERE, '..', '__fixtures__', 'expected', `${name}.json`)
  return JSON.parse(await readFile(path, 'utf8')) as FixtureSnapshot
}

const RESULT_SETTERS: Record<string, ((text: string) => void) | undefined> = {
  openai: setOpenAIResult,
  nanogpt: setOpenAIResult,
  openrouter: setOpenAIResult,
  anthropic: setAnthropicResult,
  mistral: setMistralResult,
  cohere: setCohereResult,
  gemini: setGeminiResult,
  bedrock: setBedrockResult,
  horde: setHordeResult,
}
// Tag deepseek-basic separately since its provider is 'openai' but the stub
// keys the canned reply on the model prefix; keep the dedicated setter for
// any future deepseek-specific override.
void setDeepSeekResult

describe('sendChat fixtures (server-backed)', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    vi.stubGlobal('fetch', serverCompletionFetch)
  })

  afterAll(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    vi.stubGlobal('safeStructuredClone', (v: unknown) =>
      v === undefined ? undefined : JSON.parse(JSON.stringify(v)),
    )
    platformState.isFastifyServer = true
    resetProviderState()
    resetSideEffectCalls()
    resetServerCompletionCalls()
    doingChat.set(false)
    abortChat.set(false)
    chatProcessStage.set(0)
    uuidState.counter = 0
  })

  let cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()!()
  })

  it.each(DUAL_MODE_FIXTURES)('%s', async (name) => {
    const loaded = await loadFixture(name)
    cleanups.push(loaded.cleanup)

    // Wire the upstream jsonl's reply text into the per-provider setter so the
    // fetch stub returns the same text the local sweep sees. Without this, the
    // stub falls back to its DEFAULT_*_RESULT, which diverges from the snapshot.
    try {
      const script = await loadProviderScript(name)
      const first = script[0]
      if (first && (first.type === 'success' || first.type === 'fail')) {
        const text = typeof first.result === 'string' ? first.result : ''
        if (text.length > 0) {
          const setter = RESULT_SETTERS[EXPECTED_CALL[name].provider]
          if (setter) setter(text)
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw err
    }

    const stageRecorder = recordStages()
    const args: Parameters<typeof sendChat>[1] = { ...(loaded.fixture.sendChatArgs ?? {}) }
    await sendChat(-1, args)
    const stages = stageRecorder.stop()
    const captured = captureSnapshot(stages)

    const expected = await loadExpected(name)

    // Shared snapshot contract: everything except providerCalls. The local
    // sweep records into the provider fake at the requestChatData boundary;
    // this sweep records into serverCompletionCalls at the fetch boundary.
    const { providerCalls: _expectedPC, ...sharedExpected } = expected
    const { providerCalls: capturedPC, ...sharedCaptured } = captured
    expect(sharedCaptured).toEqual(sharedExpected)
    expect(capturedPC).toEqual([])

    // Adapter telemetry: one POST to /api/v1/generate/completion. Per-fixture
    // shape is in EXPECTED_CALL above.
    const calls = getServerCompletionCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      url: '/api/v1/generate/completion',
      method: 'POST',
      authHeader: 'fixture-auth-token',
      ...EXPECTED_CALL[name],
    })
  })
})

describe('sendChat fixtures (/chat server dispatch)', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    vi.stubGlobal('fetch', serverChatFetch)
  })

  afterAll(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    vi.stubGlobal('safeStructuredClone', (v: unknown) =>
      v === undefined ? undefined : JSON.parse(JSON.stringify(v)),
    )
    platformState.isFastifyServer = true
    resetProviderState()
    resetSideEffectCalls()
    resetServerChatState()
    resetServerCompletionCalls()
    doingChat.set(false)
    abortChat.set(false)
    chatProcessStage.set(0)
    uuidState.counter = 0
  })

  let cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()!()
  })

  it.each(DUAL_MODE_FIXTURES)('%s', async (name) => {
    const loaded = await loadFixture(name)
    cleanups.push(loaded.cleanup)
    DBState.db.useServerPromptAssembly = true

    const expected = await loadExpected(name)
    const providerCall = expected.providerCalls[0]
    expect(providerCall).toBeDefined()
    const formated = providerCall.formated as Array<{ role: string; content: unknown }>
    setServerChatPrompt(
      formated.map((row) => ({ role: row.role, content: row.content })),
      {},
      { formated: formated as Array<Record<string, unknown>> },
    )

    const expectedGenerationInfo = expected.generationInfo as {
      generationId?: string
      inputTokens?: number
      outputTokens?: number
    }
    setServerChatInfo(
      expectedGenerationInfo.inputTokens ?? 0,
      expectedGenerationInfo.outputTokens ?? DBState.db.maxResponse,
    )
    const assistant = [...expected.messages].reverse().find((m) => m.role === 'char')
    expect(assistant).toBeDefined()
    setServerChatDispatchResult(
      assistant?.data ?? '',
      expected.generationInfo as Record<string, unknown>,
      expectedGenerationInfo.generationId ?? 'uuid-0',
    )

    const stageRecorder = recordStages()
    const args: Parameters<typeof sendChat>[1] = { ...(loaded.fixture.sendChatArgs ?? {}) }
    await sendChat(-1, args)
    const stages = stageRecorder.stop()
    const captured = captureSnapshot(stages)

    expect(captured.messages).toEqual(expected.messages)
    expect(captured.generationInfo).toEqual(expected.generationInfo)
    expect(captured.stages).toEqual(expected.stages)
    expect(captured.doingChat).toBe(false)
    expect(captured.sideEffects).toContainEqual({
      fn: 'addRerolls',
      args: [expectedGenerationInfo.generationId ?? 'uuid-0', [assistant?.data ?? '']],
    })
    expect(getServerChatCalls()).toHaveLength(1)
    expect(getServerChatCalls()[0]).toMatchObject({
      url: '/api/v1/generate/chat',
      method: 'POST',
      authHeader: 'fixture-auth-token',
      mode: loaded.fixture.sendChatArgs?.continue ? 'continue' : 'send',
    })
    expect(getServerCompletionCalls()).toEqual([])
  })

  it('rolls back server-applied chat mutations when /chat dispatch fails after streaming starts', async () => {
    const loaded = await loadFixture('simple-send')
    cleanups.push(loaded.cleanup)
    DBState.db.useServerPromptAssembly = true

    const originalMessages = JSON.parse(
      JSON.stringify(DBState.db.characters[0].chats[0].message),
    ) as Chat['message']
    setServerChatPrompt([{ role: 'user', content: 'Hi there' }], {}, {
      formated: [{ role: 'user', content: 'Hi there' }],
    })
    setServerChatMessagePatch({
      chatId: DBState.db.characters[0].chats[0].id ?? '',
      characterId: DBState.db.characters[0].chaId,
      selectedCharID: 0,
      chatPage: 0,
      varChanged: false,
      messageMutations: [
        {
          type: 'append',
          source: 'user_message',
          index: 0,
          message: originalMessages[0],
        },
      ],
      chatVarMutations: [],
      additionalSystemPrompt: [],
    })
    setServerChatDispatchError(
      'provider exploded',
      {
        model: 'gpt-4o',
        inputTokens: 233,
        outputTokens: 200,
        maxContext: 4000,
      },
      {
        chatId: DBState.db.characters[0].chats[0].id ?? '',
        characterId: DBState.db.characters[0].chaId,
        selectedCharID: 0,
        chatPage: 0,
        messages: originalMessages,
        scriptstate: {},
      },
      'uuid-0',
    )

    const result = await sendChat(-1, {})

    expect(result).toBe(false)
    expect(DBState.db.characters[0].chats[0].message).toEqual(originalMessages)
    expect(DBState.db.characters[0].chats[0].isStreaming).toBe(false)
    expect(getSideEffectCalls()).not.toContainEqual({
      fn: 'sayTTS',
      args: expect.any(Array),
    })
    expect(getServerChatCalls()).toHaveLength(1)
    expect(getServerCompletionCalls()).toEqual([])
  })

  it('runs server-sent tts side effects once on successful /chat dispatch', async () => {
    const loaded = await loadFixture('simple-send')
    cleanups.push(loaded.cleanup)
    DBState.db.useServerPromptAssembly = true
    DBState.db.ttsAutoSpeech = true

    setServerChatPrompt([{ role: 'user', content: 'Hi there' }], {}, {
      formated: [{ role: 'user', content: 'Hi there' }],
    })
    setServerChatInfo(233, 200)
    setServerChatDispatchResult(
      'Hello there!',
      {
        model: 'gpt-4o',
        inputTokens: 233,
        outputTokens: 200,
        maxContext: 4000,
      },
      'uuid-0',
      { emitTtsSideEffect: true },
    )

    const result = await sendChat(-1, {})

    expect(result).toBe(true)
    expect(getSideEffectCalls().filter((call) => call.fn === 'sayTTS')).toEqual([
      {
        fn: 'sayTTS',
        args: [{ chaId: 'char-tess', name: 'Tess' }, 'Hello there!'],
      },
    ])
  })
})
