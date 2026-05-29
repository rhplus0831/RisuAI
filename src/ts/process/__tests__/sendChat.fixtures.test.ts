import { afterAll, afterEach, beforeAll, beforeEach, describe, it, vi } from 'vitest'

// vi.mock calls are hoisted; they take effect before any of the imports below.
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

// triggers.runTrigger gets called with mode='start' at the top of the
// history window. Existing fixtures have either no triggerscript or one
// targeting 'editRequest', so the real impl correctly returns null for
// them and they're unaffected. The start-trigger-control + start-trigger-stop
// fixtures use a marker in triggerscript[0].comment to dispatch through the
// override below. Other runTrigger call sites (output, manual, display,
// request, editRequest) also flow through here; they continue to hit the
// real impl whenever the marker check misses.
vi.mock('../triggers', async (importActual) => {
  const actual = await importActual<typeof import('../triggers')>()
  return {
    ...actual,
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
        const mutatedChat = {
          ...baseChat,
          message: [
            ...(baseChat.message ?? []),
            {
              role: 'user',
              data: '[trigger-injected]',
              chatId: 'msg-trigger-injected',
              time: 0,
            },
          ],
        }
        return {
          additonalSysPrompt: { start: '', historyend: '', promptend: '' },
          chat: mutatedChat,
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
  }
})

// transformers.runImageEmbedding lazily imports @huggingface/transformers,
// which we don't want vitest to pull in. The history-media-fallback fixture
// exercises the no-image-input caption path, so we replace just that export
// and preserve everything else via importActual.
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

import { loadFixture } from '../__fixtures__/loadFixture'
import {
  installProviderScript,
  loadProviderScript,
  resetProviderState,
} from '../__fixtures__/providerFake'
import { resetSideEffectCalls } from '../__fixtures__/sideEffects'
import { assertOrRecord, captureSnapshot, recordStages } from '../__fixtures__/snapshot'
import { isTokenizerUrl, serveTokenizerFetch } from '../__fixtures__/mocks/tokenizerFetch'
import { abortChat, chatProcessStage, doingChat, sendChat } from '../index.svelte'

const FIXTURES = [
  'simple-send',
  'preview',
  'continue',
  'regenerate',
  'provider-error',
  'auto-continue',
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

  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    originalFetch = globalThis.fetch
    // Intercept the lazy tokenizer JSON/spiece fetches (Claude, NovelAI,
    // Llama, Cohere, Mistral, ...). Other URLs pass through to the real
    // fetch — currently nothing else fetches in this sweep, but we keep
    // the pass-through to avoid masking accidental escapes.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (isTokenizerUrl(url)) return serveTokenizerFetch(url)
      return originalFetch(input as Parameters<typeof originalFetch>[0], init)
    }) as typeof globalThis.fetch
  })

  afterAll(() => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
  })

  beforeEach(() => {
    resetProviderState()
    resetSideEffectCalls()
    // sendChat now owns its own doingChat lifecycle (set on entry, cleared in
    // a finally on every exit). Reset here defensively in case a fixture's
    // expected-state snapshot needs to start from a clean baseline.
    doingChat.set(false)
    abortChat.set(false)
    chatProcessStage.set(0)
    uuidState.counter = 0
  })

  let cleanups: (() => void)[] = []
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()!()
  })

  it.each(FIXTURES)('%s', async (name) => {
    const loaded = await loadFixture(name)
    cleanups.push(loaded.cleanup)

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
