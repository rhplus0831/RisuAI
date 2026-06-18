import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))
const selectedFileState = vi.hoisted(() => ({
  file: null as null | { name: string; data: Uint8Array },
  beforeResolve: null as null | (() => void | Promise<void>),
  queuedFiles: [] as Array<Promise<null | { name: string; data: Uint8Array }>>,
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
  selectSingleFile: vi.fn(async () => {
    const queuedFile = selectedFileState.queuedFiles.shift()
    if (queuedFile) {
      return await queuedFile
    }
    await selectedFileState.beforeResolve?.()
    return selectedFileState.file
  }),
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
import {
  setServerProjectionWriteGuardEnabled,
  withTrustedServerProjectionWrite,
} from './server/projectionWriteGuard.svelte'
import { DBState, selectedCharID } from './stores.svelte'
import { importChat } from './characters'

interface CapturedFetch {
  url: string
  method: string
  authHeader: string | null
  body: unknown
}

interface StubCommandFetchOptions {
  failCommandNumber?: number
  onCommand?: (input: { commandNumber: number; url: string; init: RequestInit }) => void | Promise<void>
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

function stubCommandFetch(options: StubCommandFetchOptions = {}): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  let revision = 10
  let commandCount = 0
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
      if (url.startsWith('/api/v1/commands/')) {
        commandCount += 1
        await options.onCommand?.({ commandNumber: commandCount, url, init })
        if (options.failCommandNumber === commandCount) {
          return jsonResponse({ error: 'command failed' }, 500)
        }
      }
      if (url === '/api/v1/commands/characters/char-a/chat-folders') {
        revision += 1
        return jsonResponse({
          revision,
          event: { type: 'chatFolder.created', revision, resource: 'chat-folder' },
          folderId: null,
        })
      }
      if (url === '/api/v1/commands/characters/char-a/chats') {
        revision += 1
        return jsonResponse({
          revision,
          event: { type: 'chat.created', revision, resource: 'chat' },
          selectedChatId: null,
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

function commandCalls(calls: CapturedFetch[]): CapturedFetch[] {
  return calls.filter((call) => call.url.startsWith('/api/v1/commands/'))
}

function createFolderCalls(calls: CapturedFetch[]): CapturedFetch[] {
  return calls.filter((call) => call.url === '/api/v1/commands/characters/char-a/chat-folders')
}

function createChatCalls(calls: CapturedFetch[]): CapturedFetch[] {
  return calls.filter((call) => call.url === '/api/v1/commands/characters/char-a/chats')
}

async function waitForCommandCalls(calls: CapturedFetch[], expectedCount: number): Promise<CapturedFetch[]> {
  await vi.waitFor(() => {
    expect(commandCalls(calls)).toHaveLength(expectedCount)
  })
  return commandCalls(calls)
}

async function waitForCreateChatCalls(calls: CapturedFetch[], expectedCount = 1): Promise<CapturedFetch[]> {
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

function selectJsonlFile(lines: unknown[]): void {
  selectedFileState.file = {
    name: 'chat.jsonl',
    data: Buffer.from(lines.map((line) => JSON.stringify(line)).join('\n')),
  }
}

function jsonlFile(lines: unknown[]): { name: string; data: Uint8Array } {
  return {
    name: 'chat.jsonl',
    data: Buffer.from(lines.map((line) => JSON.stringify(line)).join('\n')),
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
  selectedFileState.beforeResolve = null
  selectedFileState.queuedFiles = []
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

  it('sequences v2 multi-chat imports as folder creates before chat creates with advancing revisions', async () => {
    const calls = stubCommandFetch()
    DBState.db.characters[0].chatFolders = [{ id: 'folder-a', name: 'Existing Folder', color: '#111', folded: false }]
    selectJsonFile('chats.json', {
      type: 'risuAllChats',
      ver: 2,
      folders: [
        { id: 'folder-a', name: 'Folder A', color: '#c00', folded: false },
        { id: 'folder-b', name: 'Folder B', color: '#0c0', folded: true },
      ],
      data: [
        importedChat({ name: 'Imported One', folderId: 'folder-a' }),
        importedChat({ name: 'Imported Two', folderId: 'folder-b' }),
      ],
    })

    await importChat()

    const commands = await waitForCommandCalls(calls, 4)
    expect(commands.map((call) => call.url)).toEqual([
      '/api/v1/commands/characters/char-a/chat-folders',
      '/api/v1/commands/characters/char-a/chat-folders',
      '/api/v1/commands/characters/char-a/chats',
      '/api/v1/commands/characters/char-a/chats',
    ])
    expect(commands.map((call) => (call.body as any).baseRevision)).toEqual([10, 11, 12, 13])
    const folderPayloads = createFolderCalls(calls).map((call) => (call.body as any).folder)
    const chatPayloads = createChatCalls(calls).map((call) => (call.body as any).chat)
    expect(folderPayloads.map((folder) => folder.name)).toEqual(['Folder A', 'Folder B'])
    expect(chatPayloads.map((chat) => chat.name)).toEqual(['Imported One', 'Imported Two'])
    expect(folderPayloads[0].id).not.toBe('folder-a')
    expect(folderPayloads[1].id).toBe('folder-b')
    expect(chatPayloads[0].folderId).toBe(folderPayloads[0].id)
    expect(chatPayloads[1].folderId).toBe('folder-b')
  })

  it('keeps an accepted imported folder when a later folder create fails and skips later commands', async () => {
    const calls = stubCommandFetch({ failCommandNumber: 2 })
    selectJsonFile('chats.json', {
      type: 'risuAllChats',
      ver: 2,
      folders: [
        { id: 'folder-a', name: 'Folder A', color: '#c00', folded: false },
        { id: 'folder-b', name: 'Folder B', color: '#0c0', folded: true },
      ],
      data: [
        importedChat({ name: 'Imported One', folderId: 'folder-a' }),
        importedChat({ name: 'Imported Two', folderId: 'folder-b' }),
      ],
    })

    await importChat()

    await vi.waitFor(() => {
      expect(commandCalls(calls)).toHaveLength(2)
      expect(DBState.db.characters[0].chatFolders).toEqual([
        { id: 'folder-a', name: 'Folder A', color: '#c00', folded: false },
      ])
      expect(DBState.db.characters[0].chats).toHaveLength(1)
    })
    expect(DBState.db.characters[0].chats[0]).toMatchObject({ id: 'chat-a', name: 'Chat A' })
    expect(createChatCalls(calls)).toHaveLength(0)
  })

  it('keeps imported folders when the first chat create fails and removes the chat tail', async () => {
    const calls = stubCommandFetch({ failCommandNumber: 3 })
    selectJsonFile('chats.json', {
      type: 'risuAllChats',
      ver: 2,
      folders: [
        { id: 'folder-a', name: 'Folder A', color: '#c00', folded: false },
        { id: 'folder-b', name: 'Folder B', color: '#0c0', folded: true },
      ],
      data: [
        importedChat({ name: 'Imported One', folderId: 'folder-a' }),
        importedChat({ name: 'Imported Two', folderId: 'folder-b' }),
      ],
    })

    await importChat()

    await vi.waitFor(() => {
      expect(commandCalls(calls)).toHaveLength(3)
      expect(DBState.db.characters[0].chatFolders.map((folder) => folder.name)).toEqual(['Folder A', 'Folder B'])
      expect(DBState.db.characters[0].chats).toHaveLength(1)
    })
    expect(DBState.db.characters[0].chats[0]).toMatchObject({ id: 'chat-a', name: 'Chat A' })
    expect(createChatCalls(calls)).toHaveLength(1)
  })

  it('skips stale imported folder and chat rollback when live rows changed before sequence failure', async () => {
    const calls = stubCommandFetch({
      failCommandNumber: 1,
      onCommand: ({ commandNumber }) => {
        if (commandNumber !== 1) return
        withTrustedServerProjectionWrite(() => {
          const character = DBState.db.characters[0]
          const importedFolder = character.chatFolders.find((folder) => folder.name === 'Folder A')
          const importedChatRow = character.chats.find((chat) => chat.name === 'Imported One')
          if (importedFolder) importedFolder.name = 'Folder A edited'
          if (importedChatRow) importedChatRow.name = 'Imported One edited'
        })
      },
    })
    selectJsonFile('chats.json', {
      type: 'risuAllChats',
      ver: 2,
      folders: [
        { id: 'folder-a', name: 'Folder A', color: '#c00', folded: false },
        { id: 'folder-b', name: 'Folder B', color: '#0c0', folded: true },
      ],
      data: [
        importedChat({ name: 'Imported One', folderId: 'folder-a' }),
        importedChat({ name: 'Imported Two', folderId: 'folder-b' }),
      ],
    })

    await importChat()

    await vi.waitFor(() => {
      expect(commandCalls(calls)).toHaveLength(1)
      expect(DBState.db.characters[0].chatFolders.map((folder) => folder.name)).toEqual(['Folder A edited'])
      expect(DBState.db.characters[0].chats.map((chat) => chat.name)).toEqual(['Imported One edited', 'Chat A'])
    })
  })

  it('imports JSONL into the captured character when selection changes while file selection is pending', async () => {
    const calls = stubCommandFetch()
    DBState.db.characters.push({
      chaId: 'char-b',
      name: 'Character B',
      chatPage: 1,
      chats: [
        { id: 'chat-b-0', name: 'Chat B0', message: [], localLore: [], note: '' },
        { id: 'chat-b-1', name: 'Chat B1', message: [], localLore: [], note: '' },
      ],
      chatFolders: [],
    } as any)
    selectJsonlFile([
      { name: 'User', is_user: true, mes: 'first line is skipped by Tavern import' },
      { name: 'Bot', is_user: false, mes: 'hello from captured target' },
    ])
    selectedFileState.beforeResolve = () => {
      selectedCharID.set(1)
    }

    await importChat()

    expect(DBState.db.characters[0].chats[0]).toMatchObject({ name: 'Imported Chat' })
    expect(DBState.db.characters[0].chatPage).toBe(0)
    expect(DBState.db.characters[1].chatPage).toBe(1)
    expect(DBState.db.characters[1].chats).toEqual([
      { id: 'chat-b-0', name: 'Chat B0', message: [], localLore: [], note: '' },
      { id: 'chat-b-1', name: 'Chat B1', message: [], localLore: [], note: '' },
    ])
    const [createCall] = await waitForCreateChatCalls(calls)
    expect(createCall.url).toBe('/api/v1/commands/characters/char-a/chats')
    expect(createCall.body).toMatchObject({ select: true })
  })

  it('lets the newer same-character chat import win when an older picker resolves later', async () => {
    const calls = stubCommandFetch()
    DBState.db.characters[0].chatPage = 1
    DBState.db.characters[0].chats.push({
      id: 'chat-a-2',
      name: 'Chat A2',
      message: [],
      localLore: [],
      note: '',
    } as any)
    const olderFile = deferred<null | { name: string; data: Uint8Array }>()
    const newerFile = deferred<null | { name: string; data: Uint8Array }>()
    selectedFileState.queuedFiles = [olderFile.promise, newerFile.promise]

    const olderImport = importChat()
    const newerImport = importChat()

    newerFile.resolve(
      jsonlFile([
        { name: 'User', is_user: true, mes: 'first line is skipped by Tavern import' },
        { name: 'Bot', is_user: false, mes: 'newer import wins' },
      ]),
    )
    await newerImport
    DBState.db.characters[0].chatPage = 1

    olderFile.resolve(
      jsonlFile([
        { name: 'User', is_user: true, mes: 'first line is skipped by Tavern import' },
        { name: 'Bot', is_user: false, mes: 'older import should be stale' },
      ]),
    )
    await olderImport

    expect(DBState.db.characters[0].chats.map((chat) => chat.message?.[0]?.data ?? chat.name)).toEqual([
      'newer import wins',
      'Chat A',
      'Chat A2',
    ])
    expect(DBState.db.characters[0].chatPage).toBe(1)
    const [createCall] = await waitForCreateChatCalls(calls)
    expect(createCall.body).toMatchObject({
      select: true,
      chat: {
        message: [
          {
            data: 'newer import wins',
          },
        ],
      },
    })
    expect(createChatCalls(calls)).toHaveLength(1)
  })

  it('sequences v1 all-chat multi-import create-chat commands with advancing revisions', async () => {
    const calls = stubCommandFetch()
    selectJsonFile('chats.json', {
      type: 'risuAllChats',
      ver: 1,
      data: [
        importedChat({ id: 'v1-a', name: 'V1 One' }),
        importedChat({ id: 'v1-b', name: 'V1 Two' }),
        importedChat({ id: 'v1-c', name: 'V1 Three' }),
      ],
    })

    await importChat()

    const commands = await waitForCommandCalls(calls, 3)
    expect(commands.map((call) => call.url)).toEqual([
      '/api/v1/commands/characters/char-a/chats',
      '/api/v1/commands/characters/char-a/chats',
      '/api/v1/commands/characters/char-a/chats',
    ])
    expect(commands.map((call) => (call.body as any).baseRevision)).toEqual([10, 11, 12])
    expect(commands.map((call) => (call.body as any).chat.name)).toEqual(['V1 One', 'V1 Two', 'V1 Three'])
  })

  it('removes an unchanged duplicate-id v1 imported chat when create fails', async () => {
    const calls = stubCommandFetch({ failCommandNumber: 1 })
    selectJsonFile('chats.json', {
      type: 'risuAllChats',
      ver: 1,
      data: [importedChat({ id: 'chat-a', name: 'Imported Duplicate' })],
    })

    await importChat()

    await vi.waitFor(() => {
      expect(commandCalls(calls)).toHaveLength(1)
      expect(DBState.db.characters[0].chats).toEqual([
        { id: 'chat-a', name: 'Chat A', message: [], localLore: [], note: '' },
      ])
    })
    expect((createChatCalls(calls)[0].body as any).chat).toMatchObject({
      id: 'chat-a',
      name: 'Imported Duplicate',
    })
  })

  it('preserves an edited duplicate-id v1 imported chat when create fails', async () => {
    const calls = stubCommandFetch({
      failCommandNumber: 1,
      onCommand: ({ commandNumber }) => {
        if (commandNumber !== 1) return
        withTrustedServerProjectionWrite(() => {
          const importedChatRow = DBState.db.characters[0].chats[0]
          if (importedChatRow?.name === 'Imported Duplicate') {
            importedChatRow.name = 'Imported Duplicate edited'
          }
        })
      },
    })
    selectJsonFile('chats.json', {
      type: 'risuAllChats',
      ver: 1,
      data: [importedChat({ id: 'chat-a', name: 'Imported Duplicate' })],
    })

    await importChat()

    await vi.waitFor(() => {
      expect(commandCalls(calls)).toHaveLength(1)
      expect(DBState.db.characters[0].chats.map((chat) => ({ id: chat.id, name: chat.name }))).toEqual([
        { id: 'chat-a', name: 'Imported Duplicate edited' },
        { id: 'chat-a', name: 'Chat A' },
      ])
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
          jailbreakToggle: false,
          sidebarToggles: {
            mode: 'cold',
          },
        },
      },
    })
  })
})
