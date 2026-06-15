import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

// Preview-path wiring. In Fastify mode, preview / previewPrompt calls
// short-circuit to the `/chat` route (stubbed by serverChatFetch) and thread the
// assembled prompt into `previewFormated` / `previewBody` without dispatching.
//
// The mock preamble mirrors sendChat.fixtures.serverBacked.test.ts: index.svelte
// pulls in the post-generation + tokenizer graph at import time, so the
// browser-only leaves are stubbed even though the preview short-circuit returns
// before reaching them.

const localAssemblerState = vi.hoisted(() => ({ throwIfEntered: false }))

vi.mock('../../platform', async (importActual) => {
  const actual = await importActual<typeof import('../../platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('../../storage/fastifyStorage', () => ({
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

vi.mock('../sendChatPromptAssembly', async (importActual) => {
  const actual = await importActual<typeof import('../sendChatPromptAssembly')>()
  return {
    ...actual,
    assembleLocalSendChatPrompt: (...args: Parameters<typeof actual.assembleLocalSendChatPrompt>) => {
      if (localAssemblerState.throwIfEntered) {
        throw new Error('local assembler entered for a server-mandatory subset')
      }
      return actual.assembleLocalSendChatPrompt(...args)
    },
  }
})

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
  setServerChatPostGenerationQueue,
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
  resetServerChatState()
  resetServerCompletionCalls()
  doingChat.set(false)
  abortChat.set(false)
  chatProcessStage.set(0)
  localAssemblerState.throwIfEntered = false
})

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
  vi.unstubAllGlobals()
})

function markActiveChatGenerationSettingsReady(): void {
  const db = DBState.db as typeof DBState.db & {
    personas?: Array<Record<string, unknown>>
    botPresets?: Array<Record<string, unknown>>
  }
  db.personas = Array.isArray(db.personas) ? db.personas : []
  db.botPresets = Array.isArray(db.botPresets) ? db.botPresets : []

  const personaId = 'test-chat-persona'
  if (!db.personas.some((persona) => persona.id === personaId)) {
    db.personas.push({
      id: personaId,
      name: db.username ?? 'User',
      icon: db.userIcon ?? '',
      personaPrompt: db.personaPrompt ?? '',
      note: db.userNote ?? '',
      largePortrait: false,
    })
  }

  const modelPresetId = 'test-chat-model-preset'
  if (!db.modelPresets.some((preset) => preset.id === modelPresetId)) {
    db.modelPresets.push({
      id: modelPresetId,
      name: 'Chat Test Model Preset',
    })
  }

  const promptPresetId = 'test-chat-preset'
  if (!db.promptPresets.some((preset) => preset.id === promptPresetId)) {
    db.promptPresets.push({
      id: promptPresetId,
      name: 'Chat Test Preset',
    })
  }

  const character = db.characters?.[0]
  const chat = character?.chats?.[character.chatPage ?? 0]
  if (!chat) throw new Error('Fixture did not seed an active chat')
  chat.generationSettings = {
    configured: true,
    personaId,
    modelPresetId,
    promptPresetId,
    jailbreakToggle: false,
    sidebarToggles: {},
  }
}

async function seedEcho(options: { ready?: boolean } = {}): Promise<void> {
  const loaded = await loadFixture('echo-basic')
  cleanups.push(loaded.cleanup)
  if (options.ready !== false) {
    markActiveChatGenerationSettingsReady()
  }
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

  it.each([
    ['send', {}],
    ['continue', { continue: true }],
    ['regenerate', { regenerateMessageId: 'msg-assistant-1' }],
    ['preview', { preview: true }],
    ['previewPrompt', { previewPrompt: true }],
  ] as const)(
    'blocks %s before /chat, doingChat, and lifecycle writes when chat settings are incomplete',
    async (_mode, args) => {
      await seedEcho({ ready: false })
      vi.stubGlobal('fetch', serverChatFetch)
      const beforeLastInteraction = DBState.db.characters[0].lastInteraction

      const ok = await chatModule.sendChat(-1, args)

      expect(ok).toBe(false)
      expect(getServerChatCalls()).toHaveLength(0)
      expect(get(doingChat)).toBe(false)
      expect(get(chatProcessStage)).toBe(0)
      expect(DBState.db.characters[0].lastInteraction).toBe(beforeLastInteraction)
      expect(DBState.db.characters[0].chats[0].message).toEqual([
        { role: 'user', data: 'ping', chatId: 'msg-user-1', time: 0 },
      ])
    },
  )

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
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
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

  it('allows one server-requested resend for a root send', async () => {
    await seedEcho()
    setServerChatPrompt(
      [{ role: 'user', content: 'server-only prompt' }],
      { promptText: 'SERVER PROMPT', inputTokens: 11, outputTokens: 22 },
      { formated: [{ role: 'user', content: 'server-only prompt' }] },
    )
    setServerChatDispatchResult('fixture echo reply', {
      model: 'echo_model',
      generationId: 'uuid-0',
      inputTokens: 7,
      outputTokens: 50,
      maxContext: 4000,
      stageTiming: { stage1: 1, stage2: 0, stage3: 0, stage4: 0 },
    })
    setServerChatPostGenerationQueue([{ resendChat: true }, {}])
    vi.stubGlobal('fetch', serverChatFetch)

    const ok = await chatModule.sendChat(-1)

    expect(ok).toBe(true)
    expect(getServerChatCalls()).toHaveLength(2)
    expect(getServerCompletionCalls()).toEqual([])
  })

  it('caps repeated server-requested resend cycles for a root send', async () => {
    await seedEcho()
    setServerChatPrompt(
      [{ role: 'user', content: 'server-only prompt' }],
      { promptText: 'SERVER PROMPT', inputTokens: 11, outputTokens: 22 },
      { formated: [{ role: 'user', content: 'server-only prompt' }] },
    )
    setServerChatDispatchResult('fixture echo reply', {
      model: 'echo_model',
      generationId: 'uuid-0',
      inputTokens: 7,
      outputTokens: 50,
      maxContext: 4000,
      stageTiming: { stage1: 1, stage2: 0, stage3: 0, stage4: 0 },
    })
    setServerChatPostGenerationQueue([{ resendChat: true }, { resendChat: true }])
    vi.stubGlobal('fetch', serverChatFetch)

    const ok = await chatModule.sendChat(-1)

    expect(ok).toBe(false)
    expect(getServerChatCalls()).toHaveLength(2)
    expect(getServerCompletionCalls()).toEqual([])
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
    expect(chat.message.map((m) => m.data)).toEqual(['patched ping', expect.stringContaining('mutated before stop')])
    expect(getServerCompletionCalls()).toEqual([])
  })

  it('does not enter the local assembler for the supported subset (server-mandatory)', async () => {
    await seedEcho()
    // Armed: if the classifier wrongly routed this in-subset send to local, the
    // local assembler would throw and the await below would reject.
    localAssemblerState.throwIfEntered = true
    setServerChatPrompt(
      [{ role: 'user', content: 'server-only prompt' }],
      { promptText: 'SERVER PROMPT', inputTokens: 11, outputTokens: 22 },
      { formated: [{ role: 'user', content: 'server-only prompt' }] },
    )
    setServerChatDispatchResult('fixture echo reply', {
      model: 'echo_model',
      generationId: 'uuid-0',
      inputTokens: 7,
      outputTokens: 50,
      maxContext: 4000,
      stageTiming: { stage1: 1, stage2: 0, stage3: 0, stage4: 0 },
    })
    vi.stubGlobal('fetch', serverChatFetch)

    const ok = await chatModule.sendChat(-1)
    expect(ok).toBe(true)
    expect(getServerChatCalls()[0]).toMatchObject({ mode: 'send', userMessage: 'ping' })
  })

  it('hard-fails an out-of-subset send (interactive Lua) as unsupported, never reaching local or /chat', async () => {
    await seedEcho()
    localAssemblerState.throwIfEntered = true
    // Non-interactive Lua routes to `server` because the VM runs the editRequest
    // hook. A script using an interactive dialog API still has no server
    // equivalent, so the classifier must return `unsupported` rather than
    // assembling on the server or falling back to local.
    DBState.db.characters[0].triggerscript = [
      {
        comment: '',
        type: 'start',
        conditions: [],
        lowLevelAccess: false,
        effect: [
          {
            type: 'triggerlua',
            code: "listenEdit('editRequest', function(id, data) alertInput(id, 'pick') return data end)",
          },
        ],
      },
    ] as never
    vi.stubGlobal('fetch', serverChatFetch)

    const ok = await chatModule.sendChat(-1)
    expect(ok).toBe(false)
    expect(getServerChatCalls()).toHaveLength(0)
  })

  it('routes a non-interactive Lua trigger to /chat (slice 3b: the VM runs editRequest server-side)', async () => {
    await seedEcho()
    // Armed: a non-interactive Lua char is now in-subset (server-mandatory), so the
    // local assembler must never be entered.
    localAssemblerState.throwIfEntered = true
    DBState.db.characters[0].triggerscript = [
      {
        comment: '',
        type: 'request',
        conditions: [],
        lowLevelAccess: false,
        effect: [
          {
            type: 'triggerlua',
            code: "listenEdit('editRequest', function(id, data) return data end)",
          },
        ],
      },
    ] as never
    setServerChatPrompt(
      [{ role: 'user', content: 'server-only prompt' }],
      { promptText: 'SERVER PROMPT', inputTokens: 11, outputTokens: 22 },
      { formated: [{ role: 'user', content: 'server-only prompt' }] },
    )
    setServerChatDispatchResult('fixture echo reply', {
      model: 'echo_model',
      generationId: 'uuid-0',
      inputTokens: 7,
      outputTokens: 50,
      maxContext: 4000,
      stageTiming: { stage1: 1, stage2: 0, stage3: 0, stage4: 0 },
    })
    vi.stubGlobal('fetch', serverChatFetch)

    const ok = await chatModule.sendChat(-1)
    expect(ok).toBe(true)
    expect(getServerChatCalls()[0]).toMatchObject({ mode: 'send', userMessage: 'ping' })
  })
})
