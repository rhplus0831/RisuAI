import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))
const selectedFileState = vi.hoisted(() => ({
  file: null as null | { name: string; data: Uint8Array },
}))

vi.mock('./platform', async (importActual) => {
  const actual = await importActual<typeof import('./platform')>()
  return {
    ...actual,
    get isFastifyServer() {
      return platformState.isFastifyServer
    },
  }
})

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'chat-import-token',
}))

vi.mock('./util', () => ({
  changeFullscreen: vi.fn(),
  checkNullish: (data: unknown) => data === undefined || data === null,
  decryptBuffer: vi.fn(),
  findCharacterbyId: vi.fn(),
  getPersonaPrompt: vi.fn(() => ''),
  getUserName: vi.fn(() => 'User'),
  isKnownUri: vi.fn(() => false),
  pickHashRand: vi.fn(() => 0),
  selectFileByDom: vi.fn(),
  selectMultipleFile: vi.fn(),
  selectSingleFile: vi.fn(async () => selectedFileState.file),
  sleep: vi.fn(),
}))

vi.mock('./alert', async (importActual) => {
  const actual = await importActual<typeof import('./alert')>()
  return {
    ...actual,
    alertError: vi.fn(),
    alertNormal: vi.fn(),
  }
})

import { clearCachedServerCommandRevision } from './server/commands'
import { setServerProjectionWriteGuardEnabled } from './server/projectionWriteGuard.svelte'
import { DBState, selectedCharID } from './stores.svelte'
import { importChat } from './characters'

interface CapturedFetch {
  url: string
  method: string
  authHeader: string | null
  body: unknown
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubCommandFetch(): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      const url = String(input)
      calls.push({
        url,
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      })

      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
      if (url === '/api/v1/commands/characters/char-a/chats') {
        return jsonResponse({
          revision: 11,
          event: { type: 'chat.created', revision: 11, resource: 'chat' },
          selectedChatId: null,
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

function createChatCalls(calls: CapturedFetch[]): CapturedFetch[] {
  return calls.filter((call) => call.url === '/api/v1/commands/characters/char-a/chats')
}

async function waitForCreateChatCalls(
  calls: CapturedFetch[],
  expectedCount = 1,
): Promise<CapturedFetch[]> {
  await vi.waitFor(() => {
    expect(createChatCalls(calls)).toHaveLength(expectedCount)
  })
  return createChatCalls(calls)
}

function selectJsonFile(name: string, payload: unknown): void {
  selectedFileState.file = {
    name,
    data: Buffer.from(JSON.stringify(payload)),
  }
}

function selectHtmlChatFile(chat: Record<string, unknown>): void {
  selectedFileState.file = {
    name: 'chat.html',
    data: Buffer.from(
      `<html><body><div class="idat">${JSON.stringify(chat)
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</div></body></html>`,
    ),
  }
}

function importedChat(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    message: [{ role: 'user', data: 'hello' }],
    note: 'note',
    name: 'Imported Chat',
    localLore: [],
    ...overrides,
  }
}

beforeEach(() => {
  platformState.isFastifyServer = true
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  selectedCharID.set(0)
  selectedFileState.file = null
  DBState.db = {
    personas: [
      { id: 'persona-a', name: 'Persona A', personaPrompt: '', icon: '', note: '' },
      { id: 'persona-b', name: 'Persona B', personaPrompt: '', icon: '', note: '' },
    ],
    botPresets: [
      {
        id: 'preset-a',
        name: 'Preset A',
        jailbreak: 'Jailbreak',
        customPromptTemplateToggle: 'mode=Mode=select=warm,cold',
      },
      {
        id: 'preset-b',
        name: 'Preset B',
        jailbreak: '',
        customPromptTemplateToggle: '',
      },
    ],
    characters: [
      {
        chaId: 'char-a',
        name: 'Character',
        chatPage: 0,
        chats: [{ id: 'chat-a', name: 'Chat A', message: [], localLore: [], note: '' }],
        chatFolders: [],
      },
    ],
  } as any
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('chat import projection helpers', () => {
  it('imports a chat through a trusted optimistic projection write and create-chat command', async () => {
    const calls = stubCommandFetch()
    selectJsonFile('chat.json', {
      type: 'risuChat',
      ver: 1,
      data: importedChat({ note: '' }),
    })
    setServerProjectionWriteGuardEnabled(true)

    expect(() => {
      DBState.db.characters[0].chats.unshift({ id: 'direct', name: 'Direct', message: [] } as any)
    }).toThrow()

    await importChat()

    expect(DBState.db.characters[0].chats[0]).toMatchObject({
      name: 'Imported Chat',
      fmIndex: -1,
    })
    expect(() => {
      DBState.db.characters[0].chats.unshift({ id: 'direct-2', name: 'Direct', message: [] } as any)
    }).toThrow()
    const [createCall] = await waitForCreateChatCalls(calls)
    expect(createCall).toEqual({
      url: '/api/v1/commands/characters/char-a/chats',
      method: 'POST',
      authHeader: 'chat-import-token',
      body: {
        baseRevision: 10,
        chat: expect.objectContaining({
          id: expect.any(String),
          name: 'Imported Chat',
          fmIndex: -1,
        }),
        select: false,
      },
    })
  })

  it('normalizes risuChat v1 generation settings to incomplete prefill before create-chat dispatch', async () => {
    const calls = stubCommandFetch()
    selectJsonFile('chat.json', {
      type: 'risuChat',
      ver: 1,
      data: importedChat({
        generationSettings: {
          configured: true,
          personaId: 'persona-a',
          presetId: 'preset-a',
          jailbreakToggle: true,
          sidebarToggles: {
            mode: 'warm',
            ignoredInvalid: false,
          },
        },
      }),
    })

    await importChat()

    const expectedGenerationSettings = {
      configured: false,
      personaId: 'persona-a',
      presetId: 'preset-a',
      jailbreakToggle: true,
      sidebarToggles: {
        mode: 'warm',
      },
    }
    expect(DBState.db.characters[0].chats[0]).toMatchObject({
      generationSettings: expectedGenerationSettings,
    })
    const [createCall] = await waitForCreateChatCalls(calls)
    expect(createCall.body).toMatchObject({
      chat: {
        generationSettings: expectedGenerationSettings,
      },
    })
  })

  it('normalizes v2 all-chat imports and drops invalid generation settings', async () => {
    const calls = stubCommandFetch()
    selectJsonFile('chats.json', {
      type: 'risuAllChats',
      ver: 2,
      data: [
        importedChat({
          name: 'Configured V2',
          generationSettings: {
            configured: true,
            personaId: 'persona-b',
            presetId: 'preset-b',
            jailbreakToggle: false,
            sidebarToggles: {},
          },
        }),
        importedChat({
          name: 'Invalid V2',
          generationSettings: {
            configured: true,
            personaId: 42,
            presetId: 'missing-preset',
            jailbreakToggle: 'yes',
            sidebarToggles: {
              mode: false,
              '': 'bad',
            },
            unsupported: 'field',
          },
        }),
      ],
      folders: [],
    })

    await importChat()

    const [configuredChat, invalidChat] = DBState.db.characters[0].chats
    expect(configuredChat).toMatchObject({
      name: 'Configured V2',
      generationSettings: {
        configured: false,
        personaId: 'persona-b',
        presetId: 'preset-b',
        jailbreakToggle: false,
        sidebarToggles: {},
      },
    })
    expect(invalidChat).toMatchObject({ name: 'Invalid V2' })
    expect(invalidChat).not.toHaveProperty('generationSettings')

    const createCalls = await waitForCreateChatCalls(calls, 2)
    expect(createCalls[0].body).toMatchObject({
      chat: {
        name: 'Configured V2',
        generationSettings: {
          configured: false,
          personaId: 'persona-b',
          presetId: 'preset-b',
          jailbreakToggle: false,
          sidebarToggles: {},
        },
      },
    })
    expect(createCalls[1].body).toMatchObject({
      chat: {
        name: 'Invalid V2',
      },
    })
    expect((createCalls[1].body as any).chat).not.toHaveProperty('generationSettings')
  })

  it('normalizes HTML idat generation settings before create-chat dispatch', async () => {
    const calls = stubCommandFetch()
    selectHtmlChatFile(
      importedChat({
        generationSettings: {
          configured: true,
          personaId: 'persona-a',
          presetId: 'preset-a',
          jailbreakToggle: false,
          sidebarToggles: {
            mode: 'cold',
          },
        },
      }),
    )

    await importChat()

    expect(DBState.db.characters[0].chats[0]).toMatchObject({
      generationSettings: {
        configured: false,
        personaId: 'persona-a',
        presetId: 'preset-a',
        jailbreakToggle: false,
        sidebarToggles: {
          mode: 'cold',
        },
      },
    })
    const [createCall] = await waitForCreateChatCalls(calls)
    expect(createCall.body).toMatchObject({
      chat: {
        generationSettings: {
          configured: false,
          personaId: 'persona-a',
          presetId: 'preset-a',
          jailbreakToggle: false,
          sidebarToggles: {
            mode: 'cold',
          },
        },
      },
    })
  })
})
