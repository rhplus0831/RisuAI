import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock calls are hoisted; they take effect before any of the imports below.

// With isFastifyServer unconditionally true, resolveServerPromptAssembly always
// returns 'server' or 'unsupported'. This test suite exercises the local
// assembly path (mocked requestChatData), so force the classifier to 'local'.
vi.mock('../request/serverPromptAssembly', async (importActual) => {
  const actual = await importActual<typeof import('../request/serverPromptAssembly')>()
  return {
    ...actual,
    resolveServerPromptAssembly: () => ({ type: 'local' as const }),
  }
})
vi.mock('../request/durableGeneration', async (importActual) => {
  const actual = await importActual<typeof import('../request/durableGeneration')>()
  return {
    ...actual,
    resolveDurableGeneration: () => ({ type: 'non-durable' as const, reason: 'test' }),
  }
})

// fastifyStorage.getNodeServerProxyAuth touches indexedDB which is unavailable
// in the jsdom test environment. Stub it to prevent the ReferenceError.
vi.mock('../../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'fixture-auth-token',
}))
vi.mock('../request/request', () => import('../__fixtures__/mocks/request'))
vi.mock('../tts', () => import('../__fixtures__/mocks/tts'))
vi.mock('../inlayScreen', () => import('../__fixtures__/mocks/inlayScreen'))
vi.mock('../stableDiff', () => import('../__fixtures__/mocks/stableDiff'))
vi.mock('../prereroll', () => import('../__fixtures__/mocks/prereroll'))
vi.mock('../files/inlays', () => import('../__fixtures__/mocks/inlays'))

// memory/hypav3 exports other items (createHypaV3Preset, types) that
// database.svelte.ts pulls in during setDatabase(). Preserve them via
// importActual; only replace hypaMemoryV3.
vi.mock('../memory/hypav3', async (importActual) => {
  const actual = await importActual<typeof import('../memory/hypav3')>()
  const fake = await import('../__fixtures__/mocks/hypav3')
  return { ...actual, hypaMemoryV3: fake.hypaMemoryV3 }
})

// scriptings.ts imports wasmoon at module load. wasmoon's createRequire call
// fails in the vitest happy-dom env (non-file URL), so we replace the whole
// module rather than importActual-ing it. sendChat, scripts.ts, and
// triggers.ts only consume runLuaEditTrigger and runScripted from this
// module - the mock supplies both as no-ops, plus a fixture-driven
// editRequest marker hook.
vi.mock('../scriptings', () => import('../__fixtures__/mocks/scriptings'))

// Importing the real trigger module from this mock re-enters the sendChat module
// graph through command.ts before Vitest can install the override. Keep the
// fixture double self-contained: only the two marker scenarios need a result;
// all other runTrigger modes are inert in this corpus.
vi.mock('../triggers', () => ({
  clearManualTriggerAbortController: () => {},
  createManualTriggerAbortController: () => new AbortController(),
  runTrigger: async (
    char: { triggerscript?: Array<{ type?: string; comment?: string }> },
    mode: string,
    arg: { chat?: { message?: Array<unknown>; [k: string]: unknown } },
  ) => {
    const scripts = (char.triggerscript ?? []).filter((s) => s.type === mode)
    if (scripts.length === 0) return null
    const marker = scripts[0]?.comment ?? ''
    if (mode === 'start' && marker === '__test_start_mutate') {
      const baseChat = (arg.chat ?? { message: [] }) as {
        message: unknown[]
        [k: string]: unknown
      }
      baseChat.message.push({
        role: 'user',
        data: '[trigger-injected]',
        chatId: 'msg-trigger-injected',
        time: 0,
      })
      return {
        additonalSysPrompt: { start: '', historyend: '', promptend: '' },
        chat: baseChat,
        tokens: 25,
        stopSending: false,
        sendAIprompt: false,
      }
    }
    if (mode === 'start' && marker === '__test_start_stop') {
      return {
        additonalSysPrompt: { start: '', historyend: '', promptend: '' },
        chat: arg.chat,
        tokens: 0,
        stopSending: true,
        sendAIprompt: false,
      }
    }
    return null
  },
}))

// The package's Node entry eagerly loads onnxruntime-node, whose native addon
// cannot self-register in a second worker thread when the warm Vitest context
// reruns this suite. The fixtures only need the browser-safe Gemma tokenizer,
// so expose that implementation without evaluating the Node entrypoint.
vi.mock('@huggingface/transformers', async () => {
  const packageEntry = import.meta.resolve('@huggingface/transformers')
  const browserEntryUrl = new URL('./transformers.web.js', packageEntry).href
  const { GemmaTokenizer } = await import(/* @vite-ignore */ browserEntryUrl)
  return { GemmaTokenizer }
})

// The history-media-fallback fixture exercises the no-image-input caption
// path, so replace runImageEmbedding and preserve the remaining local module.
vi.mock('../transformers', async (importActual) => {
  const actual = await importActual<typeof import('../transformers')>()
  return {
    ...actual,
    runImageEmbedding: async () => [{ generated_text: 'fake caption' }],
  }
})

// globalApi.svelte.readImage reads via localforage in the browser; in
// vitest forageStorage returns undefined and Buffer.from(undefined) crashes.
// history-media-fallback hits readImage for the {{asset_prompt::icon}} path;
// we replace just that export and keep the rest via importActual.

// Stable UUIDs so generationId / chatId are deterministic in snapshots.
// The counter is exposed via a reset hook so each fixture starts at uuid-0,
// keeping snapshots independent of test order.
const uuidState = { counter: 0 }
vi.mock('uuid', () => ({
  v4: () => `uuid-${uuidState.counter++}`,
}))

// @mlc-ai/web-tokenizers is a WASM module that doesn't init in happy-dom.
// Anthropic / NovelAI / Llama / Cohere / Mistral / etc. tokenizers route
// through Tokenizer.fromJSON / fromSentencePiece + .encode. Stub the
// module with a simple word-splitter so token counts are deterministic and
// no WASM is touched.
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

import { loadFixture, markFixtureActiveChatGenerationSettingsReady } from '../__fixtures__/loadFixture'
import { installProviderScript, loadProviderScript, resetProviderState } from '../__fixtures__/providerFake'
import { resetSideEffectCalls } from '../__fixtures__/sideEffects'
import { assertOrRecord, captureSnapshot, recordStages } from '../__fixtures__/snapshot'
import { isTokenizerUrl, serveTokenizerFetch } from '../__fixtures__/mocks/tokenizerFetch'
import { abortChat, chatProcessStage, doingChat, sendChat } from '../index.svelte'

const BOOTSTRAP_ENDPOINT = '/api/v1/bootstrap'
const LOCAL_TEST_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0'])

function isLocalTestEndpoint(url: string, path: string): boolean {
  if (url === path) return true
  try {
    const parsed = new URL(url)
    return LOCAL_TEST_HOSTS.has(parsed.hostname) && parsed.pathname === path
  } catch {
    return false
  }
}

const FIXTURES = [
  'simple-send',
  'preview',
  'continue',
  'regenerate',
  'provider-error',
  'author-note',
  'cache-point',
  'persona',
  'lorebook-keyword',
  'lorebook-constant',
  'lorebook-recursive',
  'multimodal-image',
  'image-gen-emotion',
  'image-gen-imggen',
  'hypav3-memory',
  'editrequest-trigger',
  'editoutput-trigger',
  'client-abort',
  'prompt-template-basic',
  'utility-bot-template',
  'lorebook-position-depth',
  'prompt-template-memory-cache',
  'history-media-fallback',
  'start-trigger-control',
  'start-trigger-stop',
  'prompt-info-text',
  'preview-prompt',
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

describe('sendChat fixtures', () => {
  let originalFetch: typeof globalThis.fetch
  const unexpectedFetches: string[] = []

  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    originalFetch = globalThis.fetch
    // Intercept the lazy tokenizer JSON/spiece fetches (Claude, NovelAI,
    // Llama, Cohere, Mistral, ...) and the command-revision bootstrap probe.
    // This local prompt-assembly sweep does not run a Fastify server, so
    // unexpected fetches should fail the owning fixture instead of reaching
    // happy-dom's default http://localhost:3000 origin.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (isTokenizerUrl(url)) return serveTokenizerFetch(url)
      if (isLocalTestEndpoint(url, BOOTSTRAP_ENDPOINT)) {
        return new Response(JSON.stringify({ error: 'fixture bootstrap unavailable' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        })
      }
      unexpectedFetches.push(url)
      throw new Error(`Unmocked fetch in sendChat fixture test: ${url}`)
    }) as typeof globalThis.fetch
  })

  afterAll(() => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
  })

  beforeEach(() => {
    resetProviderState()
    resetSideEffectCalls()
    // sendChat owns the doingChat lifecycle (set on entry, cleared in finally on
    // every exit). Reset defensively so fixtures start from a clean baseline.
    doingChat.set(false)
    abortChat.set(false)
    chatProcessStage.set(0)
    uuidState.counter = 0
  })

  let cleanups: (() => void)[] = []
  afterEach(() => {
    try {
      expect(unexpectedFetches).toEqual([])
    } finally {
      unexpectedFetches.length = 0
      while (cleanups.length > 0) cleanups.pop()!()
    }
  })

  it.each(FIXTURES)('%s', async (name) => {
    const loaded = await loadFixture(name)
    cleanups.push(loaded.cleanup)
    markFixtureActiveChatGenerationSettingsReady()

    // Preview-mode fixtures return before any provider call, so the upstream
    // script may be absent. Load it lazily and tolerate ENOENT.
    try {
      const script = await loadProviderScript(name)
      installProviderScript(script)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw err
    }

    const stageRecorder = recordStages()

    const args: Parameters<typeof sendChat>[1] = { ...(loaded.fixture.sendChatArgs ?? {}) }
    if (loaded.fixture.aborted) {
      const controller = new AbortController()
      controller.abort()
      args.signal = controller.signal
    }
    await sendChat(-1, args)

    const stages = stageRecorder.stop()
    const captured = captureSnapshot(stages)
    await assertOrRecord(name, captured)
  })
})
