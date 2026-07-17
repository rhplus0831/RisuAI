import { IDBFactory } from 'fake-indexeddb'
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
const alertState = vi.hoisted(() => ({ errors: [] as string[] }))

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

vi.mock('../../alert', async (importActual) => {
  const actual = await importActual<typeof import('../../alert')>()
  return {
    ...actual,
    alertError: (message: string) => {
      alertState.errors.push(message)
    },
  }
})

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
import { getResourceDatabase, replaceResourceDatabase } from '../../server/resourceState.svelte'
import { abortChat, activeGenerationTarget, chatProcessStage, doingChat } from '../index.svelte'
import * as chatModule from '../index.svelte'
import { dispatchSaveChatGenerationSettings } from '../../chatCommands'
import { currentPersonaStateSnapshot, queueSelectedPersonaUpdate, updateSelectedPersonaField } from '../../persona'
import { clearCachedServerCommandRevision } from '../../server/commands'
import { language } from '../../../lang'
import {
  clearPendingMutationOutbox,
  listPendingMutations,
  preparePendingMutationOutbox,
  resetPendingMutationOutboxForTests,
} from '../../server/pendingMutationOutbox'

const testDatabaseState = {
  get db() {
    return getResourceDatabase()
  },
  set db(value: ReturnType<typeof getResourceDatabase>) {
    replaceResourceDatabase(value)
  },
}

let cleanups: (() => void)[] = []
let contextCommandRevision = 1

beforeEach(() => {
  clearCachedServerCommandRevision()
  resetServerChatState()
  resetServerCompletionCalls()
  doingChat.set(false)
  activeGenerationTarget.set(null)
  abortChat.set(false)
  chatProcessStage.set(0)
  localAssemblerState.throwIfEntered = false
  alertState.errors = []
  contextCommandRevision = 1
})

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
  vi.unstubAllGlobals()
})

function markActiveChatGenerationSettingsReady(): void {
  const db = testDatabaseState.db as typeof testDatabaseState.db & {
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

async function waitForState(assertion: () => void): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  throw lastError
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function contextCommandSuccessResponse(init?: RequestInit): Response {
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as { baseRevision?: unknown }) : undefined
  const baseRevision = typeof body?.baseRevision === 'number' ? body.baseRevision : contextCommandRevision
  contextCommandRevision = Math.max(contextCommandRevision, baseRevision) + 1
  return jsonResponse({
    revision: contextCommandRevision,
    event: {
      type: 'context.updated',
      revision: contextCommandRevision,
      resource: 'context',
    },
  })
}

async function serverChatWithContextFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  if (/\/api\/v1\/commands\/characters\/[^/]+$/.test(url) && (init?.method ?? 'GET') === 'PATCH') {
    return contextCommandSuccessResponse(init)
  }
  return serverChatFetch(input, init)
}

function queuePersonaPromptSave(prompt: string): string {
  testDatabaseState.db.personas = Array.isArray(testDatabaseState.db.personas) ? testDatabaseState.db.personas : []
  const character = testDatabaseState.db.characters?.[0]
  const chat = character?.chats?.[character.chatPage ?? 0]
  const personaId = chat?.generationSettings?.personaId ?? 'test-chat-persona'
  let selectedPersona = testDatabaseState.db.personas.findIndex((persona) => persona.id === personaId)
  if (selectedPersona < 0) {
    selectedPersona = testDatabaseState.db.personas.length
    testDatabaseState.db.personas.push({
      id: personaId,
      name: testDatabaseState.db.username ?? 'User',
      icon: testDatabaseState.db.userIcon ?? '',
      personaPrompt: testDatabaseState.db.personaPrompt ?? '',
      note: testDatabaseState.db.userNote ?? '',
      largePortrait: false,
    })
  }
  testDatabaseState.db.selectedPersona = selectedPersona
  const persona = testDatabaseState.db.personas[selectedPersona]
  if (!persona?.id) throw new Error('Fixture did not seed a selected persona')
  const previous = currentPersonaStateSnapshot()
  updateSelectedPersonaField('personaPrompt', prompt)
  const attempted = currentPersonaStateSnapshot()
  queueSelectedPersonaUpdate(previous, attempted)
  return persona.id
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
    vi.stubGlobal('fetch', serverChatWithContextFetch)

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
    vi.stubGlobal('fetch', serverChatWithContextFetch)

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
      vi.stubGlobal('fetch', serverChatWithContextFetch)
      const beforeLastInteraction = testDatabaseState.db.characters[0].lastInteraction

      const ok = await chatModule.sendChat(-1, args)

      expect(ok).toBe(false)
      expect(getServerChatCalls()).toHaveLength(0)
      expect(get(doingChat)).toBe(false)
      expect(get(chatProcessStage)).toBe(0)
      expect(testDatabaseState.db.characters[0].lastInteraction).toBe(beforeLastInteraction)
      expect(testDatabaseState.db.characters[0].chats[0].message).toEqual([
        { role: 'user', data: 'ping', chatId: 'msg-user-1', time: 0 },
      ])
    },
  )

  it('waits for a pending chat generation-settings save before server generation', async () => {
    await seedEcho()
    setServerChatDispatchResult('server reply', { model: 'echo_model', outputTokens: 2, maxContext: 4000 })
    let resolveSettingsSave: (response: Response) => void = () => {
      throw new Error('generation settings save was not requested')
    }
    const pendingSettingsSave = new Promise<Response>((resolve) => {
      resolveSettingsSave = resolve
    })
    let settingsSaveRequests = 0
    let settingsSaveBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/generation-settings')) {
          settingsSaveRequests += 1
          settingsSaveBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null
          return pendingSettingsSave
        }
        return serverChatWithContextFetch(input, init)
      }) as unknown as typeof fetch,
    )

    const activeChat = testDatabaseState.db.characters[0].chats[0]
    const characterId = testDatabaseState.db.characters[0].chaId
    activeChat.id = 'chat-1'
    expect(
      dispatchSaveChatGenerationSettings(activeChat.id, {
        ...activeChat.generationSettings!,
        jailbreakToggle: true,
      }),
    ).toBe(true)
    await waitForState(() => expect(settingsSaveRequests).toBe(1))
    expect(settingsSaveBody).toEqual({
      baseRevision: expect.any(Number),
      baseGenerationSettingsDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      patch: { jailbreakToggle: true },
    })

    const sendPromise = chatModule.sendChat(-1)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getServerChatCalls()).toHaveLength(0)
    expect(get(activeGenerationTarget)).toEqual({
      selectedCharID: 0,
      chatPage: 0,
      characterId,
      chatId: 'chat-1',
    })

    resolveSettingsSave(
      new Response(
        JSON.stringify({
          revision: 2,
          event: {
            type: 'chat.updated',
            revision: 2,
            resource: 'characterRow',
            id: 'chat-1',
            parentId: characterId,
          },
          chatId: 'chat-1',
          characterId,
          certificate: 'chat-generation-settings-sparse-v1',
          patchedKeys: ['jailbreakToggle'],
          deletedKeys: [],
          sidebarTogglePatchedKeys: [],
          sidebarToggleDeletedKeys: [],
          prunedSidebarToggleKeys: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(sendPromise).resolves.toBe(true)
    expect(get(activeGenerationTarget)).toBeNull()
    expect(getServerChatCalls()).toHaveLength(1)
  })

  it('waits for held message-id tail persistence before starting server generation', async () => {
    await seedEcho()
    setServerChatDispatchResult('server reply', { model: 'echo_model', outputTokens: 2, maxContext: 4000 })
    const chat = testDatabaseState.db.characters[0].chats[0]
    chat.id = 'chat-1'
    chat.message.push({
      role: 'user',
      data: 'wait for my durable id',
      chatId: undefined as unknown as string,
      time: 1,
    })

    let resolveTail: (response: Response) => void = () => {
      throw new Error('message tail persistence was not requested')
    }
    const heldTail = new Promise<Response>((resolve) => {
      resolveTail = resolve
    })
    let tailInit: RequestInit | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.endsWith('/api/v1/commands/chats/chat-1/messages/tail')) {
          tailInit = init
          return heldTail
        }
        return serverChatWithContextFetch(input, init)
      }) as unknown as typeof fetch,
    )

    const sendPromise = chatModule.sendChat(-1)
    await waitForState(() => expect(tailInit).toBeDefined())

    expect(getServerChatCalls()).toHaveLength(0)
    resolveTail(contextCommandSuccessResponse(tailInit))

    await expect(sendPromise).resolves.toBe(true)
    expect(getServerChatCalls()).toHaveLength(1)
  })

  it('rechecks the active target after context persistence before generation', async () => {
    await seedEcho()
    const character = testDatabaseState.db.characters[0]
    const firstChat = character.chats[0]
    firstChat.id = 'chat-1'
    character.chats.push({
      ...safeStructuredClone(firstChat),
      id: 'chat-2',
      name: 'other chat',
      message: [{ role: 'user', data: 'other chat message', chatId: 'other-message' }],
    })

    let resolveContext: (response: Response) => void = () => {
      throw new Error('context persistence was not requested')
    }
    const heldContext = new Promise<Response>((resolve) => {
      resolveContext = resolve
    })
    let contextInit: RequestInit | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (/\/api\/v1\/commands\/characters\/[^/]+$/.test(url)) {
          contextInit = init
          return heldContext
        }
        return serverChatWithContextFetch(input, init)
      }) as unknown as typeof fetch,
    )

    const sendPromise = chatModule.sendChat(-1)
    await waitForState(() => expect(contextInit).toBeDefined())
    character.chatPage = 1
    resolveContext(contextCommandSuccessResponse(contextInit))

    await expect(sendPromise).resolves.toBe(false)
    expect(getServerChatCalls()).toHaveLength(0)
    expect(get(activeGenerationTarget)).toBeNull()
  })

  it('blocks generation and shows a localized error when context persistence fails', async () => {
    await seedEcho()
    const previousLastInteraction = testDatabaseState.db.characters[0].lastInteraction
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (/\/api\/v1\/commands\/characters\/[^/]+$/.test(url)) {
          return jsonResponse({ error: 'invalid timestamp' }, 400)
        }
        return serverChatWithContextFetch(input, init)
      }) as unknown as typeof fetch,
    )

    await expect(chatModule.sendChat(-1)).resolves.toBe(false)

    expect(getServerChatCalls()).toHaveLength(0)
    expect(alertState.errors).toEqual([language.errors.sendContextPersistenceFailed])
    expect(testDatabaseState.db.characters[0].lastInteraction).toBe(previousLastInteraction)
    expect(get(doingChat)).toBe(false)
  })

  it('blocks generation on a retained context write while keeping its optimistic projection queued', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-send-gate',
      writerEpoch: 8,
      databaseLineage: 'lineage-send-gate',
      requestedWriterWasActive: true,
    })
    await seedEcho()
    const previousLastInteraction = testDatabaseState.db.characters[0].lastInteraction
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (/\/api\/v1\/commands\/characters\/[^/]+$/.test(url)) {
          return jsonResponse({ error: 'temporarily unavailable' }, 503)
        }
        if (url.endsWith('/api/v1/commands/mutation-receipts/ack')) {
          return jsonResponse({ acknowledged: true })
        }
        return serverChatWithContextFetch(input, init)
      }) as unknown as typeof fetch,
    )

    try {
      await expect(chatModule.sendChat(-1)).resolves.toBe(false)

      expect(getServerChatCalls()).toHaveLength(0)
      expect(alertState.errors).toEqual([language.errors.sendContextPersistenceFailed])
      expect(testDatabaseState.db.characters[0].lastInteraction).not.toBe(previousLastInteraction)
      expect(await listPendingMutations()).toMatchObject([
        {
          handle: { key: 'character-owner:char-tess' },
          intent: {
            requests: [
              {
                method: 'PATCH',
                path: '/characters/char-tess',
                body: { patch: { lastInteraction: expect.any(Number) } },
              },
            ],
          },
        },
      ])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('reattaches without issuing or waiting for context maintenance writes', async () => {
    await seedEcho()
    setServerChatDispatchResult('reattached reply', {
      model: 'echo_model',
      outputTokens: 2,
      maxContext: 4000,
    })
    const previousLastInteraction = testDatabaseState.db.characters[0].lastInteraction
    const maintenanceCalls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes('/api/v1/commands/')) maintenanceCalls.push(url)
        return serverChatWithContextFetch(input, init)
      }) as unknown as typeof fetch,
    )

    await expect(chatModule.sendChat(-1, { reattachJobId: 'job-reattach' })).resolves.toBe(true)

    expect(maintenanceCalls).toEqual([])
    expect(testDatabaseState.db.characters[0].lastInteraction).toBe(previousLastInteraction)
    expect(getServerChatCalls()).toHaveLength(1)
  })

  it.each([
    ['preview', { preview: true }],
    ['send', {}],
  ] as const)('flushes pending persona updates before server-backed %s', async (_mode, args) => {
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

    const personaId = queuePersonaPromptSave('fresh persona prompt for generation')
    const requestOrder: string[] = []
    const personaPatchCalls: Array<{ url: string; body: Record<string, unknown> }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.endsWith('/api/v1/bootstrap')) {
          return jsonResponse({ revision: 1, database: {} })
        }
        if (url.includes(`/api/v1/commands/personas/${encodeURIComponent(personaId)}`)) {
          requestOrder.push('persona')
          personaPatchCalls.push({
            url,
            body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {},
          })
          return jsonResponse({
            revision: 2,
            event: { type: 'persona.updated', revision: 2, resource: 'persona', id: personaId },
            personaId,
          })
        }
        if (url.endsWith('/api/v1/generate/chat')) {
          requestOrder.push('chat')
          return serverChatWithContextFetch(input, init)
        }
        return serverChatWithContextFetch(input, init)
      }) as unknown as typeof fetch,
    )

    const ok = await chatModule.sendChat(-1, args)

    expect(ok).toBe(true)
    expect(personaPatchCalls).toHaveLength(1)
    expect(personaPatchCalls[0].body).toMatchObject({
      patch: { personaPrompt: 'fresh persona prompt for generation' },
      mirrorLegacyProfile: true,
    })
    expect(requestOrder).toEqual(['persona', 'chat'])
    expect(getServerChatCalls()).toHaveLength(1)
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
    vi.stubGlobal('fetch', serverChatWithContextFetch)

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
      if (/\/api\/v1\/commands\/characters\/[^/]+$/.test(url)) {
        return serverChatWithContextFetch(input, init)
      }
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
    const chat = testDatabaseState.db.characters[0].chats[0]
    expect(chat.scriptstate?.$mood).toBe('bright')
    expect(chat.message[0].data).toBe('patched ping')
    expect(chat.message.at(-1)?.data).toBe('fixture echo reply')
    expect(chat.message.at(-1)?.generationInfo).toMatchObject({
      inputTokens: 7,
      outputTokens: 50,
    })
  })

  it('streams a server-dispatched send without receiving assembled prompt rows', async () => {
    await seedEcho()
    setServerChatPrompt([], { inputTokens: 11, outputTokens: 22 }, {})
    setServerChatDispatchResult('metadata-only reply', {
      model: 'echo_model',
      generationId: 'uuid-metadata-only',
      inputTokens: 11,
      outputTokens: 22,
      maxContext: 4000,
      stageTiming: { stage1: 1, stage2: 0, stage3: 0, stage4: 0 },
    })
    vi.stubGlobal('fetch', serverChatWithContextFetch)

    await expect(chatModule.sendChat(-1)).resolves.toBe(true)
    expect(testDatabaseState.db.characters[0].chats[0].message.at(-1)?.data).toBe('metadata-only reply')
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
    vi.stubGlobal('fetch', serverChatWithContextFetch)

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
    vi.stubGlobal('fetch', serverChatWithContextFetch)

    const ok = await chatModule.sendChat(-1)

    expect(ok).toBe(false)
    expect(getServerChatCalls()).toHaveLength(2)
    expect(getServerCompletionCalls()).toEqual([])
  })

  it('applies stop-trigger patches before surfacing the server assembly error', async () => {
    await seedEcho()
    setServerChatError('Generation was stopped by a start trigger.', {
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
    vi.stubGlobal('fetch', serverChatWithContextFetch)

    const ok = await chatModule.sendChat(-1)
    expect(ok).toBe(false)

    const chat = testDatabaseState.db.characters[0].chats[0]
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
    vi.stubGlobal('fetch', serverChatWithContextFetch)

    const ok = await chatModule.sendChat(-1)
    expect(ok).toBe(true)
    expect(getServerChatCalls()[0]).toMatchObject({ mode: 'send', userMessage: 'ping' })
  })

  it('hard-fails an interactive Lua source before /chat when Strict Script Check is enabled', async () => {
    await seedEcho()
    localAssemblerState.throwIfEntered = true
    testDatabaseState.db.strictScriptCheck = true
    // With Strict Script Check enabled, a script referencing an interactive
    // dialog API is rejected by the browser classifier before /chat. With the
    // default setting off, the server Lua runtime fails only if the API is
    // actually invoked during prompt assembly.
    testDatabaseState.db.characters[0].triggerscript = [
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
    vi.stubGlobal('fetch', serverChatWithContextFetch)

    const ok = await chatModule.sendChat(-1)
    expect(ok).toBe(false)
    expect(getServerChatCalls()).toHaveLength(0)
  })

  it('routes a non-interactive Lua trigger to /chat (slice 3b: the VM runs editRequest server-side)', async () => {
    await seedEcho()
    // Armed: a non-interactive Lua char is now in-subset (server-mandatory), so the
    // local assembler must never be entered.
    localAssemblerState.throwIfEntered = true
    testDatabaseState.db.characters[0].triggerscript = [
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
    vi.stubGlobal('fetch', serverChatWithContextFetch)

    const ok = await chatModule.sendChat(-1)
    expect(ok).toBe(true)
    expect(getServerChatCalls()[0]).toMatchObject({ mode: 'send', userMessage: 'ping' })
  })
})
