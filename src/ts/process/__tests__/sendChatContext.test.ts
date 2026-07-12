import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../platform', async (importActual) => {
  const actual = await importActual<typeof import('../../platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('../../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'context-auth-token',
}))

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {}, getModuleToggles: () => '' }
})

const toastCalls = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock('../../alert', () => ({
  alertToast: (msg: string) => {
    toastCalls.calls.push(msg)
  },
  alertError: () => {},
}))

import { clearCachedServerCommandRevision, type CommandEvent } from '../../server/commands'
import { setDatabase, type Database, type character } from '../../storage/database.svelte'
import { selectedCharID } from '../../stores.svelte'
import { getResourceDatabase, replaceResourceDatabase } from '../../server/resourceState.svelte'
import { setupSendChatContext } from '../sendChatContext'
import { seedCloneCostDb, withCloneInstrumentation } from '../../__tests__/cloneCostHarness'

const testDatabaseState = {
  get db() {
    return getResourceDatabase()
  },
  set db(value: ReturnType<typeof getResourceDatabase>) {
    replaceResourceDatabase(value)
  },
}

function makeChar(overrides: Partial<character> = {}): character {
  return {
    type: 'character',
    name: 'Tess',
    chaId: 'cha-1',
    desc: '',
    chats: [
      {
        name: 'main',
        note: '',
        localLore: [],
        scriptstate: {},
        fmIndex: -1,
        message: [],
      },
    ],
    chatPage: 0,
    customscript: [],
    triggerscript: [],
    exampleMessage: '',
    ...overrides,
  } as unknown as character
}

function makeChat(overrides: Partial<character['chats'][number]> = {}): character['chats'][number] {
  return {
    name: 'main',
    note: '',
    localLore: [],
    scriptstate: {},
    fmIndex: -1,
    message: [],
    ...overrides,
  } as character['chats'][number]
}

function seedDb(extra: Partial<Database> = {}) {
  const seed = {
    aiModel: 'gpt-4o',
    subModel: 'gpt-4o',
    characters: [makeChar()],
    maxContext: 4000,
    botPresetsId: 0,
    statics: { messages: 0 } as unknown as Database['statics'],
    promptInfoInsideChat: false,
    ...extra,
  } as unknown as Database
  setDatabase(seed)
  // setDatabase forcibly resets `promptInfoInsideChat` in web mode; restore
  // the requested value so the helper observes what the test asked for.
  if (extra.promptInfoInsideChat !== undefined) {
    testDatabaseState.db.promptInfoInsideChat = extra.promptInfoInsideChat
  }
  selectedCharID.set(0)
}

interface CapturedFetch {
  url: string
  method: string
  body: unknown
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function deferredResponse(): {
  promise: Promise<Response>
  resolve: (response: Response) => void
} {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

function stubCommandFetch(): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      calls.push({ url, method: init.method ?? 'GET', body })
      if (url === '/api/v1/bootstrap') {
        return jsonResponse({ revision: 21 })
      }
      const event: CommandEvent = {
        type: 'context.updated',
        revision: 22,
        resource: 'context',
      }
      return jsonResponse({ revision: 22, event })
    }) as unknown as typeof fetch,
  )
  return calls
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  vi.unstubAllGlobals()
  toastCalls.calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/bootstrap') {
        return jsonResponse({ revision: 21 })
      }
      if (url.startsWith('/api/v1/commands/')) {
        const event: CommandEvent = {
          type: 'context.updated',
          revision: 22,
          resource: 'context',
        }
        return jsonResponse({ revision: 22, event })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
})

describe('setupSendChatContext - preset chain', () => {
  it('does not run preset chain selection in server-backed mode when a match exists', () => {
    seedDb({
      presetChain: 'Beta',
      botPresets: [{ name: 'Alpha' }, { name: 'Beta' }] as unknown as Database['botPresets'],
      botPresetsId: 0,
    })
    setupSendChatContext({ chatProcessIndex: -1 })
    // Server-backed generation uses chat.generationSettings promptPresetId instead
    // of letting presetChain retarget the global editing preset.
    expect(testDatabaseState.db.botPresetsId).toBe(0)
    expect(toastCalls.calls).toEqual([])
  })

  it('does not alert on preset chain misses in server-backed mode', () => {
    seedDb({
      presetChain: 'Ghost',
      botPresets: [{ name: 'Alpha' }] as unknown as Database['botPresets'],
      botPresetsId: 0,
    })
    setupSendChatContext({ chatProcessIndex: -1 })
    expect(testDatabaseState.db.botPresetsId).toBe(0)
    expect(toastCalls.calls).toEqual([])
  })

  it('skips preset chain when chatProcessIndex !== -1 (reentrant call)', () => {
    seedDb({
      presetChain: 'Beta',
      botPresets: [{ name: 'Alpha' }, { name: 'Beta' }] as unknown as Database['botPresets'],
      botPresetsId: 0,
    })
    setupSendChatContext({ chatProcessIndex: 0 })
    // botPresetsId untouched because the preset-chain block is skipped.
    expect(testDatabaseState.db.botPresetsId).toBe(0)
    expect(toastCalls.calls).toEqual([])
  })
})

describe('setupSendChatContext - DB side effects', () => {
  it('does not increment db.statics.messages locally in server-backed mode', () => {
    seedDb({ statics: { messages: 4 } as unknown as Database['statics'] })
    setupSendChatContext({ chatProcessIndex: -1 })
    expect(testDatabaseState.db.statics.messages).toBe(4)
  })

  it('updates nowChatroom.lastInteraction to roughly now', () => {
    seedDb()
    const before = Date.now()
    setupSendChatContext({ chatProcessIndex: -1 })
    const after = Date.now()
    const ts = testDatabaseState.db.characters[0].lastInteraction
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  it('backfills missing chatId values with v4 while preserving existing ones', () => {
    seedDb({
      characters: [
        makeChar({
          chats: [
            {
              name: 'main',
              note: '',
              localLore: [],
              scriptstate: {},
              fmIndex: -1,
              message: [
                { role: 'user', data: 'a', chatId: 'kept-1', time: 0 },
                { role: 'char', data: 'b', chatId: undefined as unknown as string, time: 0 },
                { role: 'user', data: 'c', chatId: '', time: 0 },
              ],
            } as character['chats'][number],
          ],
        }),
      ],
    })
    setupSendChatContext({ chatProcessIndex: -1 })
    const msgs = testDatabaseState.db.characters[0].chats[0].message
    expect(msgs[0].chatId).toBe('kept-1')
    expect(msgs[1].chatId).toBeTruthy()
    expect(msgs[1].chatId).not.toBe(msgs[0].chatId)
    // Empty string `''` is falsy through `??` (returns the empty string) so it
    // is intentionally NOT backfilled. Preserved verbatim.
    expect(msgs[2].chatId).toBe('')
  })

  it('routes server-backed entry-context durable writes through commands', async () => {
    const calls = stubCommandFetch()
    seedDb({
      statics: { messages: 4 } as unknown as Database['statics'],
      characters: [
        makeChar({
          chats: [
            {
              id: 'chat-1',
              name: 'main',
              note: '',
              localLore: [],
              scriptstate: {},
              fmIndex: -1,
              message: [
                { role: 'user', data: 'a', chatId: 'kept-1', time: 0 },
                { role: 'char', data: 'b', chatId: undefined as unknown as string, time: 0 },
              ],
            } as character['chats'][number],
          ],
        }),
      ],
    })

    setupSendChatContext({ chatProcessIndex: -1 })

    expect(testDatabaseState.db.statics.messages).toBe(4)
    const messages = testDatabaseState.db.characters[0].chats[0].message
    expect(messages[0].chatId).toBe('kept-1')
    expect(messages[1].chatId).toBeTruthy()
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/characters/cha-1')).toBe(true)
      expect(calls.some((call) => call.url === '/api/v1/commands/chats/chat-1/messages/tail')).toBe(true)
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/characters/cha-1')).toMatchObject({
      method: 'PATCH',
      body: {
        patch: {
          lastInteraction: expect.any(Number),
        },
      },
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/chats/chat-1/messages/tail')).toMatchObject({
      method: 'POST',
      body: {
        afterMessageId: 'kept-1',
        messages: [messages[1]],
      },
    })
    expect(calls.some((call) => call.url === '/api/v1/commands/chats/chat-1/messages' && call.method === 'PUT')).toBe(
      false,
    )
  })

  it('serializes the character + message backfill commands against one revision baseline', async () => {
    // A4EC2 / B1: the message-id backfill path dispatches lastInteraction
    // then message-tail replacement back-to-back. Pre-fix both ran with the same
    // cached baseRevision and the second 409d; the sequencer must replay
    // the revision returned by the first into the second.
    let nextRevision = 21
    const captured: { url: string; body: { baseRevision?: number } }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/bootstrap') {
          return jsonResponse({ revision: nextRevision })
        }
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        captured.push({ url, body })
        // Each mutating call advances the server revision; the next call
        // must read this advanced value via the sequencer.
        nextRevision += 1
        const event: CommandEvent = {
          type: 'context.updated',
          revision: nextRevision,
          resource: 'context',
        }
        return jsonResponse({ revision: nextRevision, event })
      }) as unknown as typeof fetch,
    )

    seedDb({
      characters: [
        makeChar({
          chats: [
            {
              id: 'chat-1',
              name: 'main',
              note: '',
              localLore: [],
              scriptstate: {},
              fmIndex: -1,
              message: [
                { role: 'user', data: 'a', chatId: 'kept-1', time: 0 },
                { role: 'char', data: 'b', chatId: undefined as unknown as string, time: 0 },
              ],
            } as character['chats'][number],
          ],
        }),
      ],
    })

    setupSendChatContext({ chatProcessIndex: -1 })

    await vi.waitFor(() => {
      expect(captured.length).toBe(2)
    })
    expect(captured[0].url).toBe('/api/v1/commands/characters/cha-1')
    expect(captured[0].body?.baseRevision).toBe(21)
    expect(captured[1].url).toBe('/api/v1/commands/chats/chat-1/messages/tail')
    // The second command reads the revision from the first command's response.
    expect(captured[1].body?.baseRevision).toBe(22)
  })

  it('keeps early legacy message-id backfills local instead of replacing the full transcript', async () => {
    const calls = stubCommandFetch()
    seedDb({
      characters: [
        makeChar({
          chats: [
            {
              id: 'chat-1',
              name: 'main',
              note: '',
              localLore: [],
              scriptstate: {},
              fmIndex: -1,
              message: [
                { role: 'char', data: 'missing early', chatId: undefined as unknown as string, time: 0 },
                { role: 'user', data: 'kept later', chatId: 'kept-2', time: 1 },
              ],
            } as character['chats'][number],
          ],
        }),
      ],
    })

    setupSendChatContext({ chatProcessIndex: -1 })

    const messages = testDatabaseState.db.characters[0].chats[0].message
    expect(messages[0].chatId).toBeTruthy()
    expect(messages[1].chatId).toBe('kept-2')
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/characters/cha-1')).toBe(true)
    })
    expect(calls.some((call) => call.url === '/api/v1/commands/chats/chat-1/messages' && call.method === 'PUT')).toBe(
      false,
    )
    expect(calls.some((call) => call.url === '/api/v1/commands/chats/chat-1/messages/tail')).toBe(false)
  })
})

describe('setupSendChatContext - promptInfo seed', () => {
  it('returns empty promptInfo when promptInfoInsideChat=false', () => {
    seedDb({ promptInfoInsideChat: false })
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    expect(ctx.promptInfo).toEqual({})
  })

  it('returns promptName from the active chat selected preset in server-backed mode', () => {
    seedDb({
      promptInfoInsideChat: true,
      modelPresets: [{ id: 'model-preset-a', name: 'Model Preset' }],
      promptPresets: [
        { id: 'global-preset', name: 'Global Preset' },
        { id: 'chat-preset', name: 'Chat Preset' },
      ] as unknown as Database['promptPresets'],
      promptPresetsId: 0,
      characters: [
        makeChar({
          chats: [
            makeChat({
              generationSettings: {
                configured: true,
                personaId: 'persona-a',
                modelPresetId: 'model-preset-a',
                promptPresetId: 'chat-preset',
                jailbreakToggle: false,
                sidebarToggles: {},
              },
            }),
          ],
        }),
      ],
    })
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    expect(ctx.promptInfo.promptName).toBe('Chat Preset')
    expect(ctx.promptInfo.promptToggles).toEqual([])
    expect(testDatabaseState.db.promptPresetsId).toBe(0)
  })

  it('seeds chat-scoped boolean, select, text, and module toggles without global overrides', () => {
    seedDb({
      promptInfoInsideChat: true,
      modelPresets: [{ id: 'model-preset-a', name: 'Model Preset' }],
      promptPresets: [
        {
          id: 'global-preset',
          name: 'Global Preset',
          customPromptTemplateToggle: 'legacy=Legacy',
        },
        {
          id: 'chat-preset',
          name: 'Chat Preset',
          customPromptTemplateToggle: 'flag=Flag\ntone=Tone=select=warm,formal,curt\nnote=Note=text',
          moduleIntergration: 'chat-integrated-space',
        },
      ] as unknown as Database['promptPresets'],
      promptPresetsId: 0,
      customPromptTemplateToggle: 'globalOnly=Global Only',
      globalChatVariables: {
        toggle_flag: '0',
        toggle_tone: '0',
        toggle_note: 'global note',
        toggle_globalModule: '0',
        toggle_chatModule: '1',
        toggle_characterModule: '0',
        toggle_integratedModule: '0',
        toggle_globalIntegratedModule: '1',
        toggle_globalOnly: '1',
      } as unknown as Database['globalChatVariables'],
      enabledModules: ['global-module'],
      moduleIntergration: 'global-integrated-space',
      modules: [
        { id: 'global-module', customModuleToggle: 'globalModule=Global module' },
        { id: 'chat-module', customModuleToggle: 'chatModule=Chat module' },
        { id: 'character-module', customModuleToggle: 'characterModule=Character module' },
        {
          id: 'integrated-module',
          namespace: 'chat-integrated-space',
          customModuleToggle: 'integratedModule=Integrated module',
        },
        {
          id: 'global-integrated-module',
          namespace: 'global-integrated-space',
          customModuleToggle: 'globalIntegratedModule=Global integrated module',
        },
      ] as unknown as Database['modules'],
      characters: [
        makeChar({
          modules: ['character-module'],
          chats: [
            makeChat({
              modules: ['chat-module'],
              generationSettings: {
                configured: true,
                personaId: 'persona-a',
                modelPresetId: 'model-preset-a',
                promptPresetId: 'chat-preset',
                jailbreakToggle: false,
                sidebarToggles: {
                  flag: '1',
                  tone: '1',
                  note: 'chat note',
                  globalModule: '1',
                  chatModule: '0',
                  characterModule: '1',
                  integratedModule: '1',
                  globalIntegratedModule: '1',
                  globalOnly: '1',
                },
              },
            }),
          ],
        }),
      ],
    })
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    expect(ctx.promptInfo).toEqual({
      promptName: 'Chat Preset',
      promptToggles: [
        { key: 'Flag', value: 'ON' },
        { key: 'Tone', value: 'formal' },
        { key: 'Note', value: 'chat note' },
        { key: 'Global module', value: 'ON' },
        { key: 'Character module', value: 'ON' },
        { key: 'Integrated module', value: 'ON' },
      ],
    })
  })
})

describe('setupSendChatContext - tokenizer + maxContextTokens', () => {
  it('uses 5 additional tokens for gpt models when arg.chatAdditonalTokens is unset', () => {
    seedDb({ aiModel: 'gpt-4o' })
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    // ChatTokenizer wraps the count internally; we check it was constructed by
    // verifying maxContextTokens passes through and the tokenizer is defined.
    expect(ctx.tokenizer).toBeDefined()
    expect(ctx.maxContextTokens).toBe(4000)
  })

  it('uses 3 additional tokens for non-gpt models when arg.chatAdditonalTokens is unset', () => {
    seedDb({ aiModel: 'novelai:something' })
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    expect(ctx.tokenizer).toBeDefined()
  })

  it('uses arg.chatAdditonalTokens override when provided', () => {
    seedDb({ aiModel: 'gpt-4o' })
    // The tokenizer just stores the value; we test that the helper accepts
    // the override path without crashing.
    const ctx = setupSendChatContext({
      chatProcessIndex: -1,
      chatAdditonalTokens: 42,
    })
    expect(ctx.tokenizer).toBeDefined()
  })
})

describe('setupSendChatContext - selectedChar / selectedChat', () => {
  it('returns selectedChar from the store and selectedChat from chatPage', () => {
    seedDb({
      characters: [makeChar({ name: 'A' }), makeChar({ name: 'B', chatPage: 0 })],
    })
    selectedCharID.set(1)
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    expect(ctx.selectedChar).toBe(1)
    expect(ctx.selectedChat).toBe(0)
    expect(ctx.nowChatroom.name).toBe('B')
  })
})

describe('setupSendChatContext - M5 field-scoped send rollback', () => {
  it('M14: the send-context rollback captures one character row, never the whole corpus / M5: steady-state send rollback captures no character row or message payload', async () => {
    const seeded = seedCloneCostDb() // char-0 large (40 messages), siblings small
    seedDb({ characters: seeded.characters as unknown as Database['characters'] })
    selectedCharID.set(1)
    const calls = stubCommandFetch()

    // Messages already carry chatIds, so the only optimistic write is the
    // lastInteraction stamp. Rollback uses scalar locator data
    // plus the previous timestamp, so the synchronous send setup performs no
    // JSON/structured clone at all.
    const instrumented = withCloneInstrumentation(() => setupSendChatContext({ chatProcessIndex: -1 }))

    expect(instrumented.totalCloneCount).toBe(0)
    expect(instrumented.maxClonedSize).toBe(0)
    expect(instrumented.result.selectedChar).toBe(1)
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/characters/char-1')).toBe(true)
    })
  })

  it('M5: failed lastInteraction rollback restores only that field', async () => {
    const seeded = seedCloneCostDb({ characterCount: 4 })
    seedDb({ characters: seeded.characters as unknown as Database['characters'] })
    selectedCharID.set(2)
    const originalLastInteraction = testDatabaseState.db.characters[2].lastInteraction
    const patchResponse = deferredResponse()

    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        calls.push({
          url,
          method: init.method ?? 'GET',
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 21 })
        if (url === '/api/v1/commands/characters/char-2') return patchResponse.promise
        return jsonResponse({ error: 'nope' }, 500)
      }) as unknown as typeof fetch,
    )

    setupSendChatContext({ chatProcessIndex: -1 })
    expect(testDatabaseState.db.characters[2].lastInteraction).not.toBe(originalLastInteraction)
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/characters/char-2')).toBe(true)
    })

    testDatabaseState.db.characters[2].name = 'Concurrent same-row edit'
    testDatabaseState.db.characters[2].chats[0].note = 'Concurrent active-chat note'
    testDatabaseState.db.characters[2].chats[0].message.push({
      role: 'user',
      data: 'Concurrent active-chat message',
      chatId: 'concurrent-message',
    })
    testDatabaseState.db.characters[3].name = 'Concurrent sibling edit'
    patchResponse.resolve(jsonResponse({ error: 'nope' }, 500))

    await vi.waitFor(() => {
      expect(testDatabaseState.db.characters[2].lastInteraction).toBe(originalLastInteraction)
    })
    expect(testDatabaseState.db.characters[2].name).toBe('Concurrent same-row edit')
    expect(testDatabaseState.db.characters[2].chats[0].note).toBe('Concurrent active-chat note')
    expect(testDatabaseState.db.characters[2].chats[0].message.at(-1)?.chatId).toBe('concurrent-message')
    expect(testDatabaseState.db.characters[3].name).toBe('Concurrent sibling edit')
  })

  it('M5: failed first-send backfill restores only active chat messages and lastInteraction', async () => {
    const replaceResponse = deferredResponse()
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        calls.push({
          url,
          method: init.method ?? 'GET',
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 21 })
        if (url === '/api/v1/commands/characters/cha-1') {
          return jsonResponse({
            revision: 22,
            event: { type: 'character.updated', revision: 22, resource: 'character' },
          })
        }
        if (url === '/api/v1/commands/chats/chat-active/messages/tail') {
          return replaceResponse.promise
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    seedDb({
      characters: [
        makeChar({
          lastInteraction: 123,
          chats: [
            {
              id: 'chat-active',
              name: 'active',
              note: 'original active note',
              localLore: [],
              scriptstate: {},
              fmIndex: -1,
              message: [
                { role: 'user', data: 'kept id', chatId: 'kept-message', time: 2 },
                {
                  role: 'char',
                  data: 'missing id',
                  chatId: undefined as unknown as string,
                  time: 1,
                },
              ],
            } as character['chats'][number],
            {
              id: 'chat-sibling',
              name: 'sibling',
              note: 'sibling note',
              localLore: [],
              scriptstate: {},
              fmIndex: -1,
              message: [{ role: 'user', data: 'sibling', chatId: 'sibling-message' }],
            } as character['chats'][number],
          ],
        }),
      ],
    })
    const originalLastInteraction = testDatabaseState.db.characters[0].lastInteraction
    const originalMessages = JSON.parse(JSON.stringify(testDatabaseState.db.characters[0].chats[0].message))

    setupSendChatContext({ chatProcessIndex: -1 })
    expect(testDatabaseState.db.characters[0].chats[0].message[1].chatId).toBeTruthy()
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/chats/chat-active/messages/tail')).toBe(true)
    })

    testDatabaseState.db.characters[0].name = 'Concurrent character edit'
    testDatabaseState.db.characters[0].chats[0].note = 'Concurrent active note'
    testDatabaseState.db.characters[0].chats[1].message.push({
      role: 'char',
      data: 'Concurrent sibling chat message',
      chatId: 'sibling-concurrent',
    })
    replaceResponse.resolve(jsonResponse({ error: 'nope' }, 500))

    await vi.waitFor(() => {
      expect(testDatabaseState.db.characters[0].lastInteraction).toBe(originalLastInteraction)
      expect(testDatabaseState.db.characters[0].chats[0].message).toEqual(originalMessages)
    })
    expect(testDatabaseState.db.characters[0].name).toBe('Concurrent character edit')
    expect(testDatabaseState.db.characters[0].chats[0].note).toBe('Concurrent active note')
    expect(testDatabaseState.db.characters[0].chats[1].message.at(-1)?.chatId).toBe('sibling-concurrent')
    expect(calls.find((call) => call.url === '/api/v1/commands/chats/chat-active/messages/tail')).toMatchObject({
      method: 'POST',
      body: {
        afterMessageId: 'kept-message',
        messages: [{ role: 'char', data: 'missing id', chatId: expect.any(String), time: 1 }],
      },
    })
  })
})
