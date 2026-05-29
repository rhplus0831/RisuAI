import { readFile } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { FastifyInstance } from 'fastify'

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

type InjectMethod = 'DELETE' | 'GET' | 'HEAD' | 'PATCH' | 'POST' | 'PUT' | 'OPTIONS'

function toInjectMethod(method: string | undefined): InjectMethod {
  const normalized = (method ?? 'GET').toUpperCase()
  switch (normalized) {
    case 'DELETE':
    case 'GET':
    case 'HEAD':
    case 'PATCH':
    case 'POST':
    case 'PUT':
    case 'OPTIONS':
      return normalized
    default:
      return 'GET'
  }
}

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
  setServerChatSideEffects,
} from '../__fixtures__/mocks/serverChatFetch'
import { isTokenizerUrl, serveTokenizerFetch } from '../__fixtures__/mocks/tokenizerFetch'
import { getSideEffectCalls, resetSideEffectCalls } from '../__fixtures__/sideEffects'
import { loadProviderScript, resetProviderState } from '../__fixtures__/providerFake'
import { type FixtureSnapshot, captureSnapshot, recordStages } from '../__fixtures__/snapshot'
import { DBState, hypaV3ProgressStore } from '../../stores.svelte'
import type { Chat } from '../../storage/database.svelte'
import { setServerProjectionWriteGuardEnabled } from '../../server/projectionWriteGuard.svelte'
import { defaultMainPrompt } from '../../storage/defaultPrompts'
import {
  abortChat,
  chatProcessStage,
  doingChat,
  previewBody,
  previewFormated,
  sendChat,
} from '../index.svelte'
import { buildApp } from '../../../../server/fastify/src/app'
import type {
  ChatProviderDispatchContext,
  GenerationChatRouteOptions,
} from '../../../../server/fastify/src/routes/generationChat'
import {
  clearCachedServerCommandRevision,
  getServerCommandBaseRevision,
  setCachedServerCommandRevision,
} from '../../server/commands'

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

const ROUTE_BACKED_CHAT_FIXTURES = [
  'simple-send',
  'continue',
  'regenerate',
  'preview',
  'preview-prompt',
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

interface RouteBackedChatCall {
  url: string
  method: string
  authHeader: string | null
  body: Record<string, unknown>
}

// C-A1: records the browser's `/api/v1/commands/*` POSTs so a test can assert
// the assembly-time scriptstate write is no longer replayed as a command.
interface RouteBackedCommandCall {
  url: string
  method: string
  body: Record<string, unknown>
}

interface RouteBackedDispatchCall {
  inputMode: string
  formated: unknown
  generationInfo: Record<string, unknown>
}

interface RouteBackedHarness {
  app: FastifyInstance
  dataDir: string
  chatCalls: RouteBackedChatCall[]
  commandCalls: RouteBackedCommandCall[]
  dispatchCalls: RouteBackedDispatchCall[]
  setDispatchText(text: string): void
  seed(database: unknown): Promise<void>
  close(): Promise<void>
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

function headersRecord(headers: RequestInit['headers']): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return headers as Record<string, string>
}

async function createRouteBackedHarness(): Promise<RouteBackedHarness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(resolve(tmpdir(), 'risu-fastify-route-fixtures-'))
  let dispatchText = 'route-backed reply'
  const chatCalls: RouteBackedChatCall[] = []
  const commandCalls: RouteBackedCommandCall[] = []
  const dispatchCalls: RouteBackedDispatchCall[] = []
  const generationChat: GenerationChatRouteOptions = {
    dispatchProvider(context: ChatProviderDispatchContext) {
      dispatchCalls.push({
        inputMode: context.input.mode,
        formated: context.result.formated ?? context.result.prompt.formated ?? [],
        generationInfo: context.generationInfo,
      })
      async function* frames() {
        yield { kind: 'token' as const, content: dispatchText }
        yield { kind: 'done' as const, finishReason: 'stop' as const }
      }
      return frames()
    },
  }
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
    generationChat,
    memoryWorker: false,
  })

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (isTokenizerUrl(rawUrl)) return serveTokenizerFetch(rawUrl)
    const url = rawUrl.startsWith('http') ? new URL(rawUrl).pathname : rawUrl
    const method = toInjectMethod(init?.method)
    const headers = headersRecord(init?.headers)
    const payload = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    if (url === '/api/v1/generate/chat') {
      chatCalls.push({
        url,
        method,
        authHeader: headers['risu-auth'] ?? null,
        body: (payload ?? {}) as Record<string, unknown>,
      })
    }
    if (url.startsWith('/api/v1/commands/')) {
      commandCalls.push({ url, method, body: (payload ?? {}) as Record<string, unknown> })
      return new Response(
        JSON.stringify({
          revision: 2,
          event: { type: 'fixture.command', revision: 2, resource: 'fixture' },
          chatId: 'chat-route-backed',
          messageId: 'route-backed-message',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    const res = await app.inject({
      method,
      url,
      headers,
      payload,
    })
    const responseHeaders: Record<string, string> = {}
    for (const [key, value] of Object.entries(res.headers)) {
      if (typeof value === 'string') responseHeaders[key] = value
      else if (Array.isArray(value)) responseHeaders[key] = value.join(', ')
    }
    return new Response(res.body, {
      status: res.statusCode,
      headers: responseHeaders,
    })
  }

  return {
    app,
    dataDir,
    chatCalls,
    commandCalls,
    dispatchCalls,
    setDispatchText(text: string) {
      dispatchText = text
    },
    async seed(database: unknown) {
      const cloned = JSON.parse(JSON.stringify(database))
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/import/risusave',
        payload: { database: cloned },
      })
      expect(res.statusCode).toBe(200)
    },
    async close() {
      await app.close()
      rmSync(dataDir, { recursive: true, force: true })
    },
    fetch,
  }
}

function prepareRouteBackedFixture(name: (typeof ROUTE_BACKED_CHAT_FIXTURES)[number]): void {
  const char = DBState.db.characters[0]
  const chat = char.chats[char.chatPage ?? 0]
  chat.id = 'chat-route-backed'
  ;(DBState.db as typeof DBState.db & { currentChar: number }).currentChar = 0
  DBState.db.mainPrompt = defaultMainPrompt
  DBState.db.formatingOrder = [
    'main',
    'description',
    'personaPrompt',
    'chats',
    'lastChat',
    'jailbreak',
    'lorebook',
    'globalNote',
    'authorNote',
  ]
  DBState.db.promptSettings = {
    assistantPrefill: '',
    postEndInnerFormat: '',
    sendChatAsSystem: false,
    sendName: false,
    utilOverride: false,
    ...(DBState.db.promptSettings ?? {}),
  }
  DBState.db.useServerPromptAssembly = true
  if (name === 'regenerate') {
    chat.message.push({
      role: 'char',
      data: 'old reply to replace',
      chatId: 'msg-char-1',
      saying: char.chaId,
    })
  }
}

async function drainRouteBackedCommands(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function messageTexts(
  snapshot: FixtureSnapshot,
): Array<{ role: string; data: string; saying?: string }> {
  return snapshot.messages.map((message) => ({
    role: message.role,
    data: message.data,
    ...(message.saying ? { saying: message.saying } : {}),
  }))
}

function firstRerollText(snapshot: FixtureSnapshot): string | null {
  for (const sideEffect of snapshot.sideEffects) {
    if (sideEffect.fn !== 'addRerolls') continue
    const args = sideEffect.args as unknown[]
    const rerolls = args[1]
    if (Array.isArray(rerolls) && typeof rerolls[0] === 'string') return rerolls[0]
  }
  return null
}

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
    hypaV3ProgressStore.set({
      open: false,
      miniMsg: '',
      msg: '',
      subMsg: '',
    })
    doingChat.set(false)
    abortChat.set(false)
    chatProcessStage.set(0)
    uuidState.counter = 0
    setServerProjectionWriteGuardEnabled(false)
  })

  let cleanups: (() => void)[] = []
  afterEach(() => {
    setServerProjectionWriteGuardEnabled(false)
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
    setServerProjectionWriteGuardEnabled(true)
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

describe('sendChat fixtures (/chat route-backed prompt assembly)', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
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
    setServerProjectionWriteGuardEnabled(false)
  })

  let cleanups: (() => void)[] = []
  afterEach(() => {
    setServerProjectionWriteGuardEnabled(false)
    while (cleanups.length > 0) cleanups.pop()!()
    vi.unstubAllGlobals()
  })

  it.each(ROUTE_BACKED_CHAT_FIXTURES)('%s', async (name) => {
    const harness = await createRouteBackedHarness()
    try {
      const loaded = await loadFixture(name)
      cleanups.push(loaded.cleanup)
      prepareRouteBackedFixture(name)
      await harness.seed(DBState.db)
      vi.stubGlobal('fetch', harness.fetch)

      const expected = await loadExpected(name)
      const expectedProviderCall = expected.providerCalls[0]
      const assistant = [...expected.messages].reverse().find((m) => m.role === 'char')
      harness.setDispatchText(
        name === 'continue'
          ? (firstRerollText(expected) ?? ' route-backed continuation')
          : (assistant?.data ?? 'route-backed reply'),
      )

      const args: Parameters<typeof sendChat>[1] = { ...(loaded.fixture.sendChatArgs ?? {}) }
      if (name === 'regenerate') {
        args.regenerateMessageId = 'msg-char-1'
      }

      const stageRecorder = recordStages()
      clearCachedServerCommandRevision()
      setServerProjectionWriteGuardEnabled(true)
      const ok = await sendChat(-1, args)
      const stages = stageRecorder.stop()
      const captured = captureSnapshot(stages)

      expect(ok).toBe(true)
      expect(messageTexts(captured)).toEqual(messageTexts(expected))
      expect(captured.stages).toEqual(
        name === 'preview' || name === 'preview-prompt' ? [1] : expected.stages,
      )
      expect(captured.doingChat).toBe(false)
      expect(harness.chatCalls).toHaveLength(1)
      expect(harness.chatCalls[0]).toMatchObject({
        url: '/api/v1/generate/chat',
        method: 'POST',
        authHeader: 'fixture-auth-token',
      })

      if (name === 'preview') {
        expect(harness.chatCalls[0].body).toMatchObject({ mode: 'preview' })
        expect(Array.isArray(previewFormated)).toBe(true)
        expect(harness.dispatchCalls).toEqual([])
      } else if (name === 'preview-prompt') {
        expect(harness.chatCalls[0].body).toMatchObject({ mode: 'preview_prompt' })
        expect(typeof previewBody).toBe('string')
        expect(harness.dispatchCalls).toEqual([])
      } else {
        const expectedMode =
          name === 'continue' ? 'continue' : name === 'regenerate' ? 'regenerate' : 'send'
        expect(harness.chatCalls[0].body).toMatchObject({ mode: expectedMode })
        expect(harness.dispatchCalls).toHaveLength(1)
        expect(harness.dispatchCalls[0].inputMode).toBe(expectedMode)
        if (expectedProviderCall) {
          expect(Array.isArray(harness.dispatchCalls[0].formated)).toBe(true)
        }
        expect(harness.dispatchCalls[0].generationInfo.model).toBe('gpt-4o')
        expect(getServerCompletionCalls()).toEqual([])
      }
    } finally {
      await drainRouteBackedCommands()
      await harness.close()
    }
  })

  it('persists an assembly-time chat-var write server-side with zero scriptstate re-POSTs (C-A1)', async () => {
    const harness = await createRouteBackedHarness()
    try {
      const loaded = await loadFixture('simple-send')
      cleanups.push(loaded.cleanup)
      prepareRouteBackedFixture('simple-send')
      // A start trigger sets `$score` during assembly. Before C-A1 the browser
      // replayed this delta as a `PATCH …/scriptstate` command; now the route
      // persists it directly, so no scriptstate command should go out.
      DBState.db.characters[0].triggerscript = [
        {
          comment: '',
          type: 'start',
          conditions: [],
          effect: [{ type: 'setvar', operator: '=', var: 'score', value: '9' }],
        },
      ]
      await harness.seed(DBState.db)
      vi.stubGlobal('fetch', harness.fetch)
      harness.setDispatchText('route-backed reply')

      // Simulate a browser that already cached the pre-persist revision (1).
      // The only way its cache reaches the bumped revision is the SSE reconcile,
      // so a later command POSTing baseRevision 2 proves the reconcile happened.
      clearCachedServerCommandRevision()
      setCachedServerCommandRevision(1)

      setServerProjectionWriteGuardEnabled(true)
      const ok = await sendChat(-1, { ...(loaded.fixture.sendChatArgs ?? {}) })
      await drainRouteBackedCommands()

      expect(ok).toBe(true)

      // C-A1 core: the browser issues zero outbound scriptstate commands.
      const scriptstatePosts = harness.commandCalls.filter((call) =>
        call.url.includes('/scriptstate'),
      )
      expect(scriptstatePosts).toEqual([])

      // The route persisted the delta itself: bootstrap shows the written
      // scriptstate and a bumped revision (seed = 1 → persist = 2).
      const bootstrap = await harness.app.inject({ method: 'GET', url: '/api/v1/bootstrap' })
      expect(bootstrap.statusCode).toBe(200)
      const persistedChat = bootstrap.json().database.characters[0].chats[0]
      expect(persistedChat.scriptstate).toEqual({ $score: '9' })
      expect(bootstrap.json().revision).toBe(2)

      // Revision reconciliation: the next browser command (the generation-result
      // persist) uses the route-returned revision, not the stale cached 1.
      const generationResultPost = harness.commandCalls.find((call) =>
        call.url.includes('/generation-result'),
      )
      expect(generationResultPost).toBeDefined()
      expect(generationResultPost?.body.baseRevision).toBe(2)
      expect(await getServerCommandBaseRevision()).toBe(2)
    } finally {
      await drainRouteBackedCommands()
      await harness.close()
    }
  })

  it('assembles inlay multimodal bytes server-side with byte-parity to the local golden (slice 3a)', async () => {
    const harness = await createRouteBackedHarness()
    try {
      const loaded = await loadFixture('multimodal-image')
      cleanups.push(loaded.cleanup)

      // The multimodal-image fixture's vision model omits url/key because the
      // local sweep dispatches through the provider fake; add them so the send
      // is server-routable, then mirror prepareRouteBackedFixture's prompt setup
      // (this fixture is not in the parametrized ROUTE_BACKED_CHAT_FIXTURES set).
      const custom = (DBState.db.customModels as Array<Record<string, unknown>>)[0]
      custom.url = 'https://vision.example.com/v1/chat/completions'
      custom.key = 'sk-vision-fixture'
      const char = DBState.db.characters[0]
      char.chats[char.chatPage ?? 0].id = 'chat-route-backed'
      ;(DBState.db as typeof DBState.db & { currentChar: number }).currentChar = 0
      DBState.db.mainPrompt = defaultMainPrompt
      DBState.db.formatingOrder = [
        'main',
        'description',
        'personaPrompt',
        'chats',
        'lastChat',
        'jailbreak',
        'lorebook',
        'globalNote',
        'authorNote',
      ]
      DBState.db.promptSettings = {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: false,
        sendName: false,
        utilOverride: false,
        ...(DBState.db.promptSettings ?? {}),
      }
      DBState.db.useServerPromptAssembly = true
      // The fixture ships `promptTemplate: null`, which the risusave import
      // coerces to `[]` — and the server then treats an empty array as an
      // (empty) active template, assembling zero rows. That null-coercion is a
      // pre-existing concern unrelated to slice 3a's multimodal scope; clear it
      // to `undefined` so the format-order path runs and a real prompt (with the
      // inlay row) assembles.
      ;(DBState.db as unknown as { promptTemplate?: unknown }).promptTemplate = undefined

      await harness.seed(DBState.db)
      vi.stubGlobal('fetch', harness.fetch)
      harness.setDispatchText('I see a small image.')

      clearCachedServerCommandRevision()
      setServerProjectionWriteGuardEnabled(true)
      const ok = await sendChat(-1, { ...(loaded.fixture.sendChatArgs ?? {}) })
      expect(ok).toBe(true)

      // The browser resolved the inlay bytes the server lacks (localForage) and
      // shipped them on the request so the server `getInlay` could return them.
      expect(harness.chatCalls).toHaveLength(1)
      expect(harness.chatCalls[0].body.inlayAssets).toEqual([
        {
          id: 'test-image',
          type: 'image',
          base64: expect.stringContaining('data:image/png;base64,'),
          width: 1,
          height: 1,
        },
      ])

      // Byte-parity: the server-assembled formated user row carries the exact
      // inlay MultiModal the local golden's provider call does.
      expect(harness.dispatchCalls).toHaveLength(1)
      const formated = harness.dispatchCalls[0].formated as Array<Record<string, unknown>>
      const userRow = formated.find(
        (row) =>
          row.role === 'user' &&
          typeof row.content === 'string' &&
          (row.content as string).includes('Look at this'),
      )
      const golden = await loadExpected('multimodal-image')
      const goldenUserRow = (
        golden.providerCalls[0].formated as Array<Record<string, unknown>>
      ).find((row) => row.role === 'user')
      expect(userRow?.multimodals).toEqual(goldenUserRow?.multimodals)
      // The browser never fell back to a local provider/completion dispatch.
      expect(getServerCompletionCalls()).toEqual([])
    } finally {
      await drainRouteBackedCommands()
      await harness.close()
    }
  })

  // Note: a route-backed parity test for a `triggerlua` editRequest char cannot
  // run here. The route-backed harness boots the real Fastify server in-process,
  // and the server Lua VM uses `wasmoon`, whose WASM init calls
  // `createRequire(import.meta.url)` — which throws under this suite's jsdom
  // environment (the URL is `http://localhost:3000/...`, not a file URL). That is
  // the same reason `__fixtures__/mocks/scriptings.ts` exists. The server-side
  // editRequest byte-parity-vs-golden proof therefore lives in the server suite
  // (`server/fastify/__tests__/generation.chat.test.ts`, node env), where wasmoon
  // initializes. The classifier flip (browser → `server` for Lua) is proven in
  // `request/tests/serverPromptAssembly.test.ts`.
})

describe('sendChat fixtures (/chat adapter replay)', () => {
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
    setServerProjectionWriteGuardEnabled(false)
  })

  let cleanups: (() => void)[] = []
  afterEach(() => {
    setServerProjectionWriteGuardEnabled(false)
    while (cleanups.length > 0) cleanups.pop()!()
  })

  it('pins hypav3-memory server-backed prompt rows and progress side effects', async () => {
    const loaded = await loadFixture('hypav3-memory')
    cleanups.push(loaded.cleanup)
    DBState.db.useServerPromptAssembly = true

    const expected = await loadExpected('hypav3-memory')
    const providerCall = expected.providerCalls[0]
    expect(providerCall).toBeDefined()
    const formated = providerCall.formated as Array<Record<string, unknown>>
    const memoryRows = formated.filter((row) => row.memo === 'hypaMemory')
    expect(memoryRows).toEqual([
      {
        role: 'system',
        content:
          '<Previous Conversation>Summary: in a previous turn the user discussed gardening tips.</Previous Conversation>',
        memo: 'hypaMemory',
      },
    ])
    setServerChatPrompt(
      formated.map((row) => ({ role: String(row.role), content: row.content })),
      {},
      { formated },
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
    setServerChatSideEffects([
      {
        kind: 'hypav3_progress',
        payload: {
          open: true,
          miniMsg: '2',
          msg: '[Hypa V3] Summarizing...',
          subMsg: '2 queued',
          status: 'running',
          queuedCount: 2,
        },
      },
    ])

    const stageRecorder = recordStages()
    setServerProjectionWriteGuardEnabled(true)
    await sendChat(-1, { ...(loaded.fixture.sendChatArgs ?? {}) })
    const stages = stageRecorder.stop()
    const captured = captureSnapshot(stages)

    expect(captured.messages).toEqual(expected.messages)
    expect(captured.generationInfo).toEqual(expected.generationInfo)
    expect(captured.stages).toEqual([1, 3, 4])
    expect(captured.doingChat).toBe(false)
    expect(captured.providerCalls).toEqual([])
    expect(get(hypaV3ProgressStore)).toEqual({
      open: true,
      miniMsg: '2',
      msg: '[Hypa V3] Summarizing...',
      subMsg: '2 queued',
    })
    expect(getServerChatCalls()).toHaveLength(1)
    expect(getServerChatCalls()[0]).toMatchObject({
      url: '/api/v1/generate/chat',
      method: 'POST',
      authHeader: 'fixture-auth-token',
      mode: 'send',
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
    setServerChatPrompt(
      [{ role: 'user', content: 'Hi there' }],
      {},
      {
        formated: [{ role: 'user', content: 'Hi there' }],
      },
    )
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

    setServerProjectionWriteGuardEnabled(true)
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

    setServerChatPrompt(
      [{ role: 'user', content: 'Hi there' }],
      {},
      {
        formated: [{ role: 'user', content: 'Hi there' }],
      },
    )
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

    setServerProjectionWriteGuardEnabled(true)
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
