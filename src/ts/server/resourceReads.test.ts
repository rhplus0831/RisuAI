import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'resource-auth-token',
}))

import { SERVER_COLLECTION_NAMES } from './resourceState.svelte'
import { clearResourceCache, sha256JsonValue } from './resourceCache'
import {
  SERVER_CHARACTER_SHELL_MARKER,
  SERVER_CHARACTER_SUMMARY_VERSION,
  type ServerCharacterSummary,
} from './characterSummaryProtocol'
import {
  fetchServerCharacter,
  fetchServerCharacterOrder,
  fetchServerCharacterSelection,
  fetchServerCharacters,
  fetchServerCollection,
  fetchServerCollections,
  fetchServerInlayCatalog,
  fetchServerSettings,
  fetchServerSettingsGroup,
} from './resourceReads'

interface CapturedFetch {
  url: string
  method: string
  authHeader: string | null
  signal: AbortSignal | null
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubResourceFetch(bodyForUrl: (url: string) => unknown): CapturedFetch[] {
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
        signal: init.signal ?? null,
      })
      const body = bodyForUrl(url)
      return body instanceof Response ? body : jsonResponse(body)
    }) as unknown as typeof fetch,
  )
  return calls
}

function completeCollections(): Record<string, unknown> {
  return Object.fromEntries(
    SERVER_COLLECTION_NAMES.map((name) => [name, name === 'pluginCustomStorage' ? { plugin: { count: 1 } } : []]),
  )
}

function characterSummary(overrides: Partial<ServerCharacterSummary> = {}): ServerCharacterSummary {
  return {
    [SERVER_CHARACTER_SHELL_MARKER]: true,
    chaId: 'char-a',
    type: 'character',
    name: 'Ada',
    displayName: 'Ada Lovelace',
    image: 'asset://ada',
    creatorNotes: 'First programmer',
    trashTime: null,
    creation_date: 1,
    modification_date: 2,
    lastInteraction: 3,
    chatCount: 2,
    activeChatId: 'chat-a',
    chatIds: ['chat-a', 'chat-b'],
    pinnedChats: [{ id: 'chat-b', name: 'Pinned' }],
    ...overrides,
  }
}

function characterSummaryEnvelope(revision: number, characters: ServerCharacterSummary[] = [characterSummary()]) {
  return {
    version: SERVER_CHARACTER_SUMMARY_VERSION,
    revision,
    characters,
    characterOrder: characters.map((character) => character.chaId),
    currentChar: characters.length > 0 ? 0 : -1,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('server resource read clients', () => {
  it('reads and validates the revisioned inlay catalog', async () => {
    const assetId = 'a'.repeat(64)
    const responses = [
      {
        revision: 6,
        assets: [{ assetId, aliases: ['friendly-id'], ext: 'png', name: 'shared.png', size: 12, type: 'image' }],
      },
      { revision: 7, assets: [{ assetId, aliases: [], ext: 'png', name: 'broken.png', size: -1, type: 'image' }] },
    ]
    const calls = stubResourceFetch(() => responses.shift())

    await expect(fetchServerInlayCatalog()).resolves.toMatchObject({
      status: 'ok',
      revision: 6,
      assets: [{ assetId, aliases: ['friendly-id'], name: 'shared.png' }],
    })
    await expect(fetchServerInlayCatalog()).resolves.toEqual({
      status: 'error',
      error: 'Invalid inlay catalog response',
    })
    expect(calls.map((call) => call.url)).toEqual(['/api/v1/inlay-assets', '/api/v1/inlay-assets'])
  })

  it('reads settings with auth and preserves the request signal', async () => {
    const controller = new AbortController()
    const calls = stubResourceFetch(() => ({
      revision: 7,
      settings: { language: 'en', currentChar: 1, promptPresetsId: 2 },
    }))

    await expect(fetchServerSettings(controller.signal)).resolves.toEqual({
      status: 'ok',
      revision: 7,
      settings: { language: 'en', currentChar: 1, promptPresetsId: 2 },
    })
    expect(calls).toEqual([
      {
        url: '/api/v1/settings',
        method: 'GET',
        authHeader: 'resource-auth-token',
        signal: controller.signal,
      },
    ])
  })

  it('rejects collection data smuggled into the settings resource', async () => {
    stubResourceFetch(() => ({ revision: 1, settings: { language: 'en', modules: [] } }))

    await expect(fetchServerSettings()).resolves.toEqual({
      status: 'error',
      error: 'Settings response contained non-setting resources',
    })
  })

  it('reads one authoritative settings group and rejects cross-group fields', async () => {
    const responses = [
      { revision: 8, group: 'display', settings: { theme: 'dark', zoomsize: 90 } },
      { revision: 9, group: 'display', settings: { openAIKey: 'smuggled' } },
      { revision: 10, group: 'sidebar', settings: { lastLoadedLoadoutName: 'Loadout A' } },
      {
        revision: 11,
        group: 'agents',
        settings: {
          agentPresets: [{ id: 'agent-a', name: 'Agent A', enabled: true, version: 1, steps: [] }],
          agentPresetDefaultId: 'agent-a',
        },
      },
      { revision: 12, group: 'agents', settings: { theme: 'smuggled' } },
      {
        revision: 13,
        group: 'models',
        settings: {
          modelProfiles: [{ id: 'profile-a', name: 'Profile A' }],
          modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'profile-a' } },
          modelRuntimeDefaults: { maxContext: 8_192 },
        },
      },
      { revision: 14, group: 'models', settings: { openAIKey: 'smuggled' } },
    ]
    const calls = stubResourceFetch(() => responses.shift())

    await expect(fetchServerSettingsGroup('display')).resolves.toEqual({
      status: 'ok',
      revision: 8,
      group: 'display',
      settings: { theme: 'dark', zoomsize: 90 },
    })
    await expect(fetchServerSettingsGroup('display')).resolves.toEqual({
      status: 'error',
      error: 'Invalid display settings response',
    })
    await expect(fetchServerSettingsGroup('sidebar')).resolves.toEqual({
      status: 'ok',
      revision: 10,
      group: 'sidebar',
      settings: { lastLoadedLoadoutName: 'Loadout A' },
    })
    await expect(fetchServerSettingsGroup('agents')).resolves.toEqual({
      status: 'ok',
      revision: 11,
      group: 'agents',
      settings: {
        agentPresets: [{ id: 'agent-a', name: 'Agent A', enabled: true, version: 1, steps: [] }],
        agentPresetDefaultId: 'agent-a',
      },
    })
    await expect(fetchServerSettingsGroup('agents')).resolves.toEqual({
      status: 'error',
      error: 'Invalid agents settings response',
    })
    await expect(fetchServerSettingsGroup('models')).resolves.toEqual({
      status: 'ok',
      revision: 13,
      group: 'models',
      settings: {
        modelProfiles: [{ id: 'profile-a', name: 'Profile A' }],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'profile-a' } },
        modelRuntimeDefaults: { maxContext: 8_192 },
      },
    })
    await expect(fetchServerSettingsGroup('models')).resolves.toEqual({
      status: 'error',
      error: 'Invalid models settings response',
    })
    expect(calls.map((call) => call.url)).toEqual([
      '/api/v1/settings/display',
      '/api/v1/settings/display',
      '/api/v1/settings/sidebar',
      '/api/v1/settings/agents',
      '/api/v1/settings/agents',
      '/api/v1/settings/models',
      '/api/v1/settings/models',
    ])
  })

  it('accepts all moved prompt fields only from the prompt settings group', async () => {
    const promptSettings = {
      mainPrompt: 'MAIN',
      outputImageModal: true,
      fallbackModels: ['model-a'],
      fallbackWhenBlankResponse: true,
      doNotChangeFallbackModels: false,
    }
    const responses = [
      { revision: 11, group: 'prompt', settings: promptSettings },
      { revision: 12, group: 'media', settings: { outputImageModal: true } },
      { revision: 13, group: 'runtime', settings: { fallbackModels: ['model-a'] } },
      { revision: 14, group: 'prompt', settings: { theme: 'smuggled' } },
    ]
    const calls = stubResourceFetch(() => responses.shift())

    await expect(fetchServerSettingsGroup('prompt')).resolves.toEqual({
      status: 'ok',
      revision: 11,
      group: 'prompt',
      settings: promptSettings,
    })
    await expect(fetchServerSettingsGroup('media')).resolves.toEqual({
      status: 'error',
      error: 'Invalid media settings response',
    })
    await expect(fetchServerSettingsGroup('runtime')).resolves.toEqual({
      status: 'error',
      error: 'Invalid runtime settings response',
    })
    await expect(fetchServerSettingsGroup('prompt')).resolves.toEqual({
      status: 'error',
      error: 'Invalid prompt settings response',
    })
    expect(calls.map((call) => call.url)).toEqual([
      '/api/v1/settings/prompt',
      '/api/v1/settings/media',
      '/api/v1/settings/runtime',
      '/api/v1/settings/prompt',
    ])
  })

  it('reads the complete and targeted collection envelopes', async () => {
    const calls = stubResourceFetch((url) =>
      url.endsWith('/modules')
        ? { revision: 9, collections: { modules: [{ id: 'module-a' }] } }
        : { revision: 8, collections: completeCollections() },
    )

    await expect(fetchServerCollections()).resolves.toMatchObject({
      status: 'ok',
      revision: 8,
      collections: { pluginCustomStorage: { plugin: { count: 1 } } },
    })
    await expect(fetchServerCollection('modules')).resolves.toEqual({
      status: 'ok',
      revision: 9,
      collections: { modules: [{ id: 'module-a' }] },
    })
    expect(calls.map((call) => call.url)).toEqual(['/api/v1/collections', '/api/v1/collections/modules'])
  })

  it('rejects global lorebook projections without stable unique ids', async () => {
    const responses = [
      { revision: 8, collections: { loreBook: [{ name: 'Missing id', data: [] }] } },
      {
        revision: 9,
        collections: {
          loreBook: [
            {
              id: 'book-a',
              name: 'Duplicate entries',
              data: [{ id: 'entry-a' }, { id: 'entry-a' }],
            },
          ],
        },
      },
      {
        revision: 10,
        collections: {
          loreBook: [{ id: 'book-a', name: 'Valid', data: [{ id: 'entry-a' }] }],
        },
      },
    ]
    stubResourceFetch(() => responses.shift())

    await expect(fetchServerCollection('loreBook')).resolves.toEqual({
      status: 'error',
      error: 'Invalid loreBook collection response',
    })
    await expect(fetchServerCollection('loreBook')).resolves.toEqual({
      status: 'error',
      error: 'Invalid loreBook collection response',
    })
    await expect(fetchServerCollection('loreBook')).resolves.toMatchObject({ status: 'ok', revision: 10 })
  })

  it('reconstructs collection hits while preserving a literal hash-shaped miss', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    await clearResourceCache()

    const module = { id: 'module-a', cjs: 'module.exports = true' }
    const storage = { 'plugin-a:state': { enabled: true } }
    const moduleHash = await sha256JsonValue(module)
    const storageHash = await sha256JsonValue(storage)
    const calls: Array<{ method: string; body: Record<string, any> }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        const body = JSON.parse(String(init.body)) as Record<string, any>
        calls.push({ method: init.method ?? 'GET', body })
        const secondRequest = calls.length === 2
        return jsonResponse({
          revision: secondRequest ? 9 : 8,
          cache: { version: 2, algorithm: 'sha256' },
          collections: Object.fromEntries(
            SERVER_COLLECTION_NAMES.map((name) => {
              if (name === 'modules') {
                return [name, secondRequest ? [{ hash: moduleHash }, { value: moduleHash }] : [{ value: module }]]
              }
              if (name === 'pluginCustomStorage') return [name, secondRequest ? storageHash : storage]
              return [name, []]
            }),
          ),
        })
      }) as unknown as typeof fetch,
    )

    try {
      await expect(fetchServerCollections()).resolves.toMatchObject({
        status: 'ok',
        revision: 8,
        collections: { modules: [module], pluginCustomStorage: storage },
      })
      await expect(fetchServerCollections()).resolves.toMatchObject({
        status: 'ok',
        revision: 9,
        collections: { modules: [module, moduleHash], pluginCustomStorage: storage },
      })

      expect(calls).toHaveLength(2)
      expect(calls.every((call) => call.method === 'POST')).toBe(true)
      expect(calls[0]?.body).toEqual({
        cache: {
          version: 2,
          hashes: Object.fromEntries(SERVER_COLLECTION_NAMES.map((name) => [name, []])),
        },
      })
      expect(calls[1]?.body.cache.hashes.modules).toEqual([moduleHash])
      expect(calls[1]?.body.cache.hashes.pluginCustomStorage).toEqual([storageHash])
    } finally {
      await clearResourceCache()
    }
  })

  it('falls back to GET when IndexedDB cannot be opened', async () => {
    vi.stubGlobal('indexedDB', {
      open() {
        throw new Error('IndexedDB disabled')
      },
    })
    const calls = stubResourceFetch(() => ({
      revision: 8,
      collections: completeCollections(),
    }))

    await expect(fetchServerCollections()).resolves.toMatchObject({ status: 'ok', revision: 8 })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('GET')
  })

  it('falls back to full GETs when cache POST envelopes are malformed', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    await clearResourceCache()
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        const method = init.method ?? 'GET'
        calls.push(`${method} ${url}`)
        if (method === 'POST' && url === '/api/v1/settings') {
          return jsonResponse({
            revision: 1,
            cache: { version: 2, algorithm: 'sha256' },
            settings: { language: 'en', modules: [] },
          })
        }
        if (method === 'POST' && url === '/api/v1/collections') {
          return jsonResponse({
            revision: 1,
            cache: { version: 2, algorithm: 'sha256' },
            collections: { ...completeCollections(), pluginCustomStorage: [] },
          })
        }
        if (method === 'POST' && url === '/api/v1/characters/summaries') {
          return jsonResponse({
            version: SERVER_CHARACTER_SUMMARY_VERSION,
            revision: 1,
            cache: { version: 2, algorithm: 'sha256' },
            characters: [
              {
                value: { ...characterSummary(), chats: [] },
              },
            ],
            characterOrder: ['char-a'],
            currentChar: 0,
          })
        }
        if (url === '/api/v1/settings') return jsonResponse({ revision: 2, settings: { language: 'en' } })
        if (url === '/api/v1/collections') {
          return jsonResponse({ revision: 2, collections: completeCollections() })
        }
        return jsonResponse(characterSummaryEnvelope(2))
      }) as unknown as typeof fetch,
    )

    try {
      await expect(fetchServerSettings()).resolves.toMatchObject({ status: 'ok', revision: 2 })
      await expect(fetchServerCollections()).resolves.toMatchObject({ status: 'ok', revision: 2 })
      await expect(fetchServerCharacters()).resolves.toMatchObject({ status: 'ok', revision: 2 })
      expect(calls).toEqual([
        'POST /api/v1/settings',
        'GET /api/v1/settings',
        'POST /api/v1/collections',
        'GET /api/v1/collections',
        'POST /api/v1/characters/summaries',
        'GET /api/v1/characters/summaries',
      ])
    } finally {
      await clearResourceCache()
    }
  })

  it('reuses whole settings and versioned character summaries from IndexedDB', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    await clearResourceCache()

    const settings = { language: 'en', currentChar: 0, agentPresets: [{ id: 'agent-a', steps: [] }] }
    const characters = [characterSummary()]
    const settingsHash = await sha256JsonValue(settings)
    const characterHash = await sha256JsonValue(characters[0])
    const requestBodies: Record<string, Array<Record<string, any>>> = { settings: [], characters: [] }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const kind = String(input).endsWith('/settings') ? 'settings' : 'characters'
        const body = JSON.parse(String(init.body)) as Record<string, any>
        requestBodies[kind]?.push(body)
        const requestCount = requestBodies[kind]?.length ?? 0
        if (kind === 'settings') {
          return jsonResponse({
            revision: requestCount,
            cache: { version: 2, algorithm: 'sha256' },
            settings: requestCount === 1 ? settings : settingsHash,
          })
        }
        return jsonResponse({
          version: SERVER_CHARACTER_SUMMARY_VERSION,
          revision: requestCount,
          cache: { version: 2, algorithm: 'sha256' },
          characters: requestCount === 1 ? characters.map((value) => ({ value })) : [{ hash: characterHash }],
          characterOrder: ['char-a'],
          currentChar: 0,
        })
      }) as unknown as typeof fetch,
    )

    try {
      await expect(fetchServerSettings()).resolves.toMatchObject({ status: 'ok', settings })
      await expect(fetchServerCharacters()).resolves.toMatchObject({
        status: 'ok',
        version: SERVER_CHARACTER_SUMMARY_VERSION,
        characters: [
          {
            [SERVER_CHARACTER_SHELL_MARKER]: true,
            chaId: 'char-a',
            chatCount: 2,
            chats: [
              { id: 'chat-a', name: '', message: [] },
              { id: 'chat-b', name: 'Pinned', pinned: true, message: [] },
            ],
            chatPage: 0,
          },
        ],
      })
      await expect(fetchServerSettings()).resolves.toMatchObject({ status: 'ok', settings })
      await expect(fetchServerCharacters()).resolves.toMatchObject({
        status: 'ok',
        version: SERVER_CHARACTER_SUMMARY_VERSION,
        characters: [{ [SERVER_CHARACTER_SHELL_MARKER]: true, chaId: 'char-a' }],
      })

      expect(requestBodies.settings?.[0]?.cache.hashes.settings).toEqual([])
      expect(requestBodies.settings?.[1]?.cache.hashes.settings).toEqual([settingsHash])
      expect(requestBodies.characters?.[0]?.cache.hashes.characters).toEqual([])
      expect(requestBodies.characters?.[1]?.cache.hashes.characters).toEqual([characterHash])
    } finally {
      await clearResourceCache()
    }
  })

  it('rejects incomplete full collection envelopes and malformed collection values', async () => {
    const responses = [
      { revision: 1, collections: { modules: [] } },
      { revision: 2, collections: { pluginCustomStorage: [] } },
    ]
    stubResourceFetch(() => responses.shift())

    await expect(fetchServerCollections()).resolves.toEqual({
      status: 'error',
      error: 'Invalid collections response',
    })
    await expect(fetchServerCollection('pluginCustomStorage')).resolves.toEqual({
      status: 'error',
      error: 'Invalid pluginCustomStorage collection response',
    })
  })

  it('reads exact versioned character summaries and rejects detail fields', async () => {
    const responses = [
      characterSummaryEnvelope(4),
      {
        ...characterSummaryEnvelope(5),
        characters: [{ ...characterSummary(), chats: [] }],
        characterOrder: ['char-a'],
      },
    ]
    stubResourceFetch(() => responses.shift())

    await expect(fetchServerCharacters()).resolves.toMatchObject({
      status: 'ok',
      version: SERVER_CHARACTER_SUMMARY_VERSION,
      revision: 4,
      currentChar: 0,
      characters: [{ [SERVER_CHARACTER_SHELL_MARKER]: true, chats: expect.any(Array) }],
    })
    await expect(fetchServerCharacters()).resolves.toEqual({
      status: 'error',
      error: 'Invalid characters response',
    })
  })

  it('reads one character by encoded stable id and rejects mismatched ids', async () => {
    const calls = stubResourceFetch((url) => ({
      revision: 11,
      character: { chaId: url.includes('char%2Fone') ? 'char/one' : 'wrong', name: 'One', chats: [] },
    }))

    await expect(fetchServerCharacter('char/one')).resolves.toMatchObject({
      status: 'ok',
      revision: 11,
      character: { chaId: 'char/one' },
    })
    expect(calls[0]?.url).toBe('/api/v1/characters/char%2Fone')

    await expect(fetchServerCharacter('expected')).resolves.toEqual({
      status: 'error',
      error: 'Invalid character response',
    })
  })

  it('reads narrow character order and selection resources', async () => {
    const calls = stubResourceFetch((url) =>
      url.endsWith('/order')
        ? { revision: 12, characterOrder: ['char-b', 'char-a'] }
        : {
            revision: 13,
            characterId: 'char/one',
            currentChar: 1,
            lastInteraction: 456,
          },
    )

    await expect(fetchServerCharacterOrder()).resolves.toEqual({
      status: 'ok',
      revision: 12,
      characterOrder: ['char-b', 'char-a'],
    })
    await expect(fetchServerCharacterSelection('char/one')).resolves.toEqual({
      status: 'ok',
      revision: 13,
      characterId: 'char/one',
      currentChar: 1,
      lastInteraction: 456,
    })
    expect(calls.map((call) => call.url)).toEqual([
      '/api/v1/characters/order',
      '/api/v1/characters/char%2Fone/selection',
    ])
  })
})
