import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

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
} from '../__fixtures__/mocks/serverCompletionFetch'
import { resetSideEffectCalls } from '../__fixtures__/sideEffects'
import { resetProviderState } from '../__fixtures__/providerFake'
import {
  type FixtureSnapshot,
  captureSnapshot,
  recordStages,
} from '../__fixtures__/snapshot'
import { abortChat, chatProcessStage, doingChat, sendChat } from '../index.svelte'

const HERE = dirname(fileURLToPath(import.meta.url))

const DUAL_MODE_FIXTURES = [
  'echo-basic',
  'openai-basic',
  'anthropic-basic',
  'mistral-basic',
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
}

async function loadExpected(name: string): Promise<FixtureSnapshot> {
  const path = resolve(HERE, '..', '__fixtures__', 'expected', `${name}.json`)
  return JSON.parse(await readFile(path, 'utf8')) as FixtureSnapshot
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
