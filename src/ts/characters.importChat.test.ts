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

vi.mock('./storage/nodeStorage', () => ({
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

async function waitForCommand(calls: CapturedFetch[]): Promise<void> {
  await vi.waitFor(() => {
    expect(calls.some((call) => call.url === '/api/v1/commands/characters/char-a/chats')).toBe(true)
  })
}

beforeEach(() => {
  platformState.isFastifyServer = true
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  selectedCharID.set(0)
  selectedFileState.file = null
  DBState.db = {
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
    selectedFileState.file = {
      name: 'chat.json',
      data: Buffer.from(
        JSON.stringify({
          type: 'risuChat',
          ver: 1,
          data: {
            message: [{ role: 'user', data: 'hello' }],
            note: '',
            name: 'Imported Chat',
            localLore: [],
          },
        }),
      ),
    }
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
    await waitForCommand(calls)
    expect(calls.find((call) => call.url === '/api/v1/commands/characters/char-a/chats')).toEqual({
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
})
