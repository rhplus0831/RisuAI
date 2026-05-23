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
  setServerChatPrompt,
} from '../__fixtures__/mocks/serverChatFetch'
import { DBState } from '../../stores.svelte'
import { abortChat, chatProcessStage, doingChat } from '../index.svelte'
import * as chatModule from '../index.svelte'

let cleanups: (() => void)[] = []

beforeEach(() => {
  platformState.isFastifyServer = true
  resetServerChatState()
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
})
