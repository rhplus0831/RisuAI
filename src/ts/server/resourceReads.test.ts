import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'resource-auth-token',
}))

import { SERVER_COLLECTION_NAMES } from './resourceState.svelte'
import {
  fetchServerCharacter,
  fetchServerCharacterOrder,
  fetchServerCharacterSelection,
  fetchServerCharacters,
  fetchServerCollection,
  fetchServerCollections,
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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('server resource read clients', () => {
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
    expect(calls.map((call) => call.url)).toEqual([
      '/api/v1/settings/display',
      '/api/v1/settings/display',
      '/api/v1/settings/sidebar',
      '/api/v1/settings/agents',
      '/api/v1/settings/agents',
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

  it('reads message-free character metadata and rejects embedded transcripts', async () => {
    const responses = [
      {
        revision: 4,
        characters: [{ chaId: 'char-a', name: 'Ada', chats: [{ id: 'chat-a', message: [] }] }],
        characterOrder: ['char-a'],
        currentChar: 0,
      },
      {
        revision: 5,
        characters: [
          { chaId: 'char-a', name: 'Ada', chats: [{ id: 'chat-a', message: [{ role: 'user', data: 'secret' }] }] },
        ],
        characterOrder: ['char-a'],
        currentChar: 0,
      },
    ]
    stubResourceFetch(() => responses.shift())

    await expect(fetchServerCharacters()).resolves.toMatchObject({
      status: 'ok',
      revision: 4,
      currentChar: 0,
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
