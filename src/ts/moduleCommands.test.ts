import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))

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
  getNodeServerProxyAuth: async () => 'module-command-token',
}))

import { clearCachedServerCommandRevision } from './server/commands'
import { setServerProjectionWriteGuardEnabled } from './server/projectionWriteGuard.svelte'
import { DBState, selectedCharID } from './stores.svelte'
import {
  toggledModuleIds,
  toggleSelectedCharacterModule,
  toggleSelectedChatModule,
} from './moduleCommands'

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
      if (url === '/api/v1/commands/chats/chat-a') {
        return jsonResponse({
          revision: 11,
          event: { type: 'chat.updated', revision: 11, resource: 'chat' },
        })
      }
      if (url === '/api/v1/commands/characters/char-a/modules/reorder') {
        return jsonResponse({
          revision: 11,
          event: { type: 'character.modules.reordered', revision: 11, resource: 'character' },
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

async function waitForCallCount(calls: CapturedFetch[], expected: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && calls.length < expected; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(calls).toHaveLength(expected)
}

beforeEach(() => {
  platformState.isFastifyServer = true
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  selectedCharID.set(0)
  DBState.db = {
    characters: [
      {
        chaId: 'char-a',
        name: 'Character',
        chatPage: 0,
        chats: [{ id: 'chat-a', name: 'Chat', modules: ['mod-a'], message: [] }],
        modules: ['mod-a'],
      },
    ],
    characterOrder: [],
    enabledModules: [],
    modules: [
      { id: 'mod-a', name: 'Module A' },
      { id: 'mod-b', name: 'Module B' },
    ],
  } as any
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('module command projection helpers', () => {
  it('toggles module ids without mutating the input array', () => {
    const current = ['mod-a']

    expect(toggledModuleIds(current, 'mod-b')).toEqual(['mod-a', 'mod-b'])
    expect(toggledModuleIds(current, 'mod-a')).toEqual([])
    expect(current).toEqual(['mod-a'])
  })

  it('routes selected-chat module toggles through a chat command under the projection guard', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    expect(() => {
      DBState.db.characters[0].chats[0].modules.push('direct')
    }).toThrow()

    toggleSelectedChatModule('mod-b')

    expect(DBState.db.characters[0].chats[0].modules).toEqual(['mod-a', 'mod-b'])
    expect(() => {
      DBState.db.characters[0].chats[0].modules.push('direct')
    }).toThrow()

    await waitForCallCount(calls, 2)
    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'module-command-token',
        body: null,
      },
      {
        url: '/api/v1/commands/chats/chat-a',
        method: 'PATCH',
        authHeader: 'module-command-token',
        body: {
          baseRevision: 10,
          patch: { modules: ['mod-a', 'mod-b'] },
          select: false,
        },
      },
    ])
  })

  it('routes selected-character module toggles through the character-module command', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    expect(() => {
      DBState.db.characters[0].modules.push('direct')
    }).toThrow()

    toggleSelectedCharacterModule('mod-b')

    expect(DBState.db.characters[0].modules).toEqual(['mod-a', 'mod-b'])
    expect(() => {
      DBState.db.characters[0].modules.push('direct')
    }).toThrow()

    await waitForCallCount(calls, 2)
    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'module-command-token',
        body: null,
      },
      {
        url: '/api/v1/commands/characters/char-a/modules/reorder',
        method: 'POST',
        authHeader: 'module-command-token',
        body: {
          baseRevision: 10,
          moduleIds: ['mod-a', 'mod-b'],
        },
      },
    ])
  })
})
