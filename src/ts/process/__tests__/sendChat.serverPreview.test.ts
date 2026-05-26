import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Phase 7-12c preview-path wiring. With `db.useServerPromptAssembly` on and a
// preview / previewPrompt call, sendChat short-circuits to the `/chat` route
// (stubbed by serverChatFetch) and threads the assembled prompt into
// `previewFormated` / `previewBody` without dispatching. The send path stays
// local (7-12d), so this file only exercises the two preview modes.
//
// The mock preamble mirrors sendChat.fixtures.serverBacked.test.ts: index.svelte
// pulls in the post-generation + tokenizer graph at import time, so the
// browser-only leaves are stubbed even though the preview short-circuit returns
// before reaching them.

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
  getServerChatCalls,
  resetServerChatState,
  serverChatFetch,
  setServerChatDispatchResult,
  setServerChatError,
  setServerChatMessagePatch,
  setServerChatPrompt,
} from '../__fixtures__/mocks/serverChatFetch'
import {
  getServerCompletionCalls,
  resetServerCompletionCalls,
  serverCompletionFetch,
} from '../__fixtures__/mocks/serverCompletionFetch'
import { DBState } from '../../stores.svelte'
import { abortChat, chatProcessStage, doingChat } from '../index.svelte'
import * as chatModule from '../index.svelte'

let cleanups: (() => void)[] = []

beforeEach(() => {
  vi.stubGlobal('safeStructuredClone', (v: unknown) => JSON.parse(JSON.stringify(v)))
  platformState.isFastifyServer = true
  resetServerChatState()
  resetServerCompletionCalls()
  doingChat.set(false)
  abortChat.set(false)
  chatProcessStage.set(0)
})

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
  vi.unstubAllGlobals()
})

async function seedEcho(): Promise<void> {
  const loaded = await loadFixture('echo-basic')
  cleanups.push(loaded.cleanup)
  DBState.db.useServerPromptAssembly = true
}

describe('sendChat preview path (server prompt assembly, 7-12c)', () => {
  it('routes mode=preview to /chat and fills previewFormated', async () => {
    await seedEcho()
    setServerChatPrompt(
      [{ role: 'user', content: 'hi' }],
      { promptText: 'hi' },
      {
        formated: [{ role: 'user', content: 'hi', name: 'User' }],
      },
    )
    vi.stubGlobal('fetch', serverChatFetch)

    const ok = await chatModule.sendChat(-1, { preview: true })
    expect(ok).toBe(true)
    expect(chatModule.previewFormated).toEqual([{ role: 'user', content: 'hi', name: 'User' }])

    const calls = getServerChatCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'POST',
      authHeader: 'fixture-auth-token',
      mode: 'preview',
    })
  })

  it('routes mode=previewPrompt to /chat (preview_prompt) and fills previewBody', async () => {
    await seedEcho()
    setServerChatPrompt([{ role: 'user', content: 'hi' }], { promptText: 'FLATTENED PROMPT' })
    vi.stubGlobal('fetch', serverChatFetch)

    const ok = await chatModule.sendChat(-1, { previewPrompt: true })
    expect(ok).toBe(true)
    expect(chatModule.previewBody).toBe('FLATTENED PROMPT')
    expect(getServerChatCalls()[0]).toMatchObject({ mode: 'preview_prompt' })
  })

  it('routes regenerate to /chat with regenerateMessageId and no userMessage', async () => {
    await seedEcho()
    setServerChatPrompt(
      [{ role: 'user', content: 'hi' }],
      { promptText: 'hi' },
      {
        formated: [{ role: 'user', content: 'hi' }],
      },
    )
    setServerChatDispatchResult('regenerated reply', {
      model: 'echo_model',
      generationId: 'uuid-regenerate',
      inputTokens: 7,
      outputTokens: 50,
      maxContext: 4000,
      stageTiming: { stage1: 1, stage2: 0, stage3: 0, stage4: 0 },
    })
    vi.stubGlobal('fetch', serverChatFetch)

    const ok = await chatModule.sendChat(-1, { regenerateMessageId: 'msg-assistant-1' })
    expect(ok).toBe(true)
    expect(getServerChatCalls()[0]).toMatchObject({
      mode: 'regenerate',
      regenerateMessageId: 'msg-assistant-1',
      userMessage: '',
    })
  })

  it('does not route to /chat when the gate is off', async () => {
    await seedEcho()
    DBState.db.useServerPromptAssembly = false
    vi.stubGlobal('fetch', serverChatFetch)

    // With the gate off the local assembly path runs; if it happened to hit
    // the stub it would throw (URL is not /api/v1/generate/chat). We only
    // assert no /chat call was recorded.
    await chatModule.sendChat(-1, { preview: true }).catch(() => {})
    expect(getServerChatCalls()).toHaveLength(0)
  })

  it('routes send through /chat assembly, applies patches, and dispatches locally', async () => {
    await seedEcho()
    setServerChatPrompt(
      [{ role: 'user', content: 'server-only prompt' }],
      { promptText: 'SERVER PROMPT', inputTokens: 11, outputTokens: 22 },
      {
        formated: [{ role: 'user', content: 'server-only prompt' }],
      },
    )
    setServerChatMessagePatch({
      chatId: '',
      characterId: 'char-tess',
      selectedCharID: 0,
      chatPage: 0,
      varChanged: true,
      messageMutations: [
        {
          type: 'replace_all',
          source: 'run_var',
          beforeLength: 1,
          afterLength: 1,
          messages: [{ role: 'user', data: 'patched ping', chatId: 'msg-user-1' }],
        },
      ],
      chatVarMutations: [{ key: '$mood', before: null, after: 'bright' }],
      additionalSystemPrompt: [],
    })
    setServerChatDispatchResult('fixture echo reply', {
      model: 'echo_model',
      generationId: 'uuid-0',
      inputTokens: 7,
      outputTokens: 50,
      maxContext: 4000,
      stageTiming: { stage1: 1, stage2: 0, stage3: 0, stage4: 0 },
    })
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith('/api/v1/generate/chat')) return serverChatFetch(input, init)
      return serverCompletionFetch(input, init)
    })

    const ok = await chatModule.sendChat(-1)
    expect(ok).toBe(true)

    expect(getServerChatCalls()[0]).toMatchObject({
      mode: 'send',
      userMessage: 'ping',
    })
    expect(getServerCompletionCalls()).toEqual([])
    const chat = DBState.db.characters[0].chats[0]
    expect(chat.scriptstate?.$mood).toBe('bright')
    expect(chat.message[0].data).toBe('patched ping')
    expect(chat.message.at(-1)?.data).toBe('fixture echo reply')
    expect(chat.message.at(-1)?.generationInfo).toMatchObject({
      inputTokens: 7,
      outputTokens: 50,
    })
  })

  it('applies stop-trigger patches before surfacing the server assembly error', async () => {
    await seedEcho()
    setServerChatError('prompt assembly was stopped by a trigger', {
      messagePatch: {
        chatId: '',
        characterId: 'char-tess',
        selectedCharID: 0,
        chatPage: 0,
        varChanged: true,
        messageMutations: [
          {
            type: 'replace_all',
            source: 'start_trigger',
            beforeLength: 1,
            afterLength: 2,
            messages: [
              { role: 'user', data: 'patched ping', chatId: 'msg-user-1' },
              { role: 'char', data: 'mutated before stop', chatId: 'msg-char-1' },
            ],
          },
        ],
        chatVarMutations: [{ key: '$mood', before: null, after: 'bright' }],
        additionalSystemPrompt: [],
      },
    })
    vi.stubGlobal('fetch', serverChatFetch)

    const ok = await chatModule.sendChat(-1)
    expect(ok).toBe(false)

    const chat = DBState.db.characters[0].chats[0]
    expect(chat.scriptstate?.$mood).toBe('bright')
    expect(chat.message.map((m) => m.data)).toEqual([
      'patched ping',
      expect.stringContaining('mutated before stop'),
    ])
    expect(getServerCompletionCalls()).toEqual([])
  })
})
