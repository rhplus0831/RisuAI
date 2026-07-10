import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'projection-auth-token',
}))

import {
  canUseServerProjection,
  fetchServerBulkCharacterLorebooks,
  fetchServerBulkChatMessages,
  fetchServerCharacterLorebook,
  fetchServerChatMessages,
  fetchServerPresetProjection,
  fetchServerProjectionResource,
} from './projection'

interface CapturedFetch {
  url: string
  method: string
  authHeader: string | null
  contentType: string | null
  body: unknown
  signal: AbortSignal | null
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeProjectionFetch(bodyForRequest: (url: string, init: RequestInit) => unknown): {
  calls: CapturedFetch[]
  fetch: typeof fetch
} {
  const calls: CapturedFetch[] = []

  return {
    calls,
    fetch: vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      const rawBody = typeof init.body === 'string' ? JSON.parse(init.body) : null
      const url = String(input)

      calls.push({
        url,
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
        contentType: headers?.['content-type'] ?? null,
        body: rawBody,
        signal: init.signal ?? null,
      })

      const body = bodyForRequest(url, init)
      return body instanceof Response ? body : jsonResponse(body)
    }) as unknown as typeof fetch,
  }
}

function parsedCallUrl(call: CapturedFetch): URL {
  return new URL(call.url, 'http://localhost')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('server projection API adapter', () => {
  it('reports availability unconditionally', () => {
    expect(canUseServerProjection()).toBe(true)
  })

  it('fetches targeted projection resources with encoded query params, auth, and signal', async () => {
    const controller = new AbortController()
    const projectionFetch = makeProjectionFetch(() => ({
      revision: 9,
      mode: 'fields',
      fields: { language: 'en', currentCharacter: 1 },
    }))
    vi.stubGlobal('fetch', projectionFetch.fetch)

    const result = await fetchServerProjectionResource('character/row', {
      id: 'char/one&two',
      parentId: 'preset one',
      signal: controller.signal,
    })

    expect(result).toEqual({
      status: 'ok',
      revision: 9,
      mode: 'fields',
      fields: { language: 'en', currentCharacter: 1 },
    })
    expect(projectionFetch.calls).toHaveLength(1)
    expect(projectionFetch.calls[0]).toMatchObject({
      method: 'GET',
      authHeader: 'projection-auth-token',
      contentType: null,
      body: null,
      signal: controller.signal,
    })
    const url = parsedCallUrl(projectionFetch.calls[0])
    expect(url.pathname).toBe('/api/v1/projection/character%2Frow')
    expect(url.searchParams.get('id')).toBe('char/one&two')
    expect(url.searchParams.get('parentId')).toBe('preset one')
  })

  it('parses targeted projection resource modes', async () => {
    const responses = [
      { revision: 1, mode: 'full' },
      {
        revision: 2,
        mode: 'character-selection',
        characterId: 'char-a',
        currentChar: 0,
        lastInteraction: 123,
      },
      {
        revision: 3,
        mode: 'character-lorebook',
        characterId: 'char-b',
        globalLore: [{ key: 'entry' }],
      },
      {
        revision: 4,
        mode: 'character-row',
        characterId: 'char-c',
        character: { chaId: 'char-c', name: 'C' },
      },
      {
        revision: 5,
        mode: 'chat-transcript',
        characterId: 'char-d',
        character: { chaId: 'char-d', chats: [{ id: 'chat-d', message: [] }] },
        chatId: 'chat-d',
        message: [{ role: 'user', data: 'rewritten' }],
        hypaV3Data: { assembly: true },
        alternates: [],
      },
      {
        revision: 6,
        mode: 'generation-chat',
        chatId: 'chat-a',
        message: [{ role: 'user', data: 'hi' }],
        hypaV3Data: { enabled: true },
        messageStart: 4,
        messageTotal: 5,
        alternates: [{ swipe: 1 }],
      },
      {
        revision: 7,
        mode: 'preset-collection',
        fields: {
          botPresets: [{ id: 'preset-a', name: 'A' }],
          botPresetsId: 0,
          mainPrompt: 'applied prompt',
        },
        presetRows: [{ id: 'preset-a', name: 'A', mainPrompt: 'preset prompt' }],
      },
    ]
    const projectionFetch = makeProjectionFetch(() => responses.shift())
    vi.stubGlobal('fetch', projectionFetch.fetch)

    await expect(fetchServerProjectionResource('state')).resolves.toEqual({
      status: 'ok',
      revision: 1,
      mode: 'full',
    })
    await expect(fetchServerProjectionResource('characterSelection')).resolves.toEqual({
      status: 'ok',
      revision: 2,
      mode: 'character-selection',
      characterId: 'char-a',
      currentChar: 0,
      lastInteraction: 123,
    })
    await expect(fetchServerProjectionResource('characterLorebook')).resolves.toEqual({
      status: 'ok',
      revision: 3,
      mode: 'character-lorebook',
      characterId: 'char-b',
      globalLore: [{ key: 'entry' }],
    })
    await expect(fetchServerProjectionResource('characterRow')).resolves.toEqual({
      status: 'ok',
      revision: 4,
      mode: 'character-row',
      characterId: 'char-c',
      character: { chaId: 'char-c', name: 'C' },
    })
    await expect(fetchServerProjectionResource('chatTranscript')).resolves.toEqual({
      status: 'ok',
      revision: 5,
      mode: 'chat-transcript',
      characterId: 'char-d',
      character: { chaId: 'char-d', chats: [{ id: 'chat-d', message: [] }] },
      chatId: 'chat-d',
      message: [{ role: 'user', data: 'rewritten' }],
      hypaV3Data: { assembly: true },
      alternates: [],
    })
    await expect(fetchServerProjectionResource('generation.persisted')).resolves.toEqual({
      status: 'ok',
      revision: 6,
      mode: 'generation-chat',
      chatId: 'chat-a',
      message: [{ role: 'user', data: 'hi' }],
      hypaV3Data: { enabled: true },
      messageStart: 4,
      messageTotal: 5,
      alternates: [{ swipe: 1 }],
    })
    await expect(fetchServerProjectionResource('presetApplied')).resolves.toEqual({
      status: 'ok',
      revision: 7,
      mode: 'preset-collection',
      fields: {
        botPresets: [{ id: 'preset-a', name: 'A' }],
        botPresetsId: 0,
        mainPrompt: 'applied prompt',
      },
      presetRows: [{ id: 'preset-a', name: 'A', mainPrompt: 'preset prompt' }],
    })
  })

  it('unwraps preset projections and validates the resource mode', async () => {
    const responses = [
      {
        revision: 6,
        mode: 'preset',
        presetId: 'preset-a',
        preset: { name: 'Preset A' },
      },
      {
        revision: 7,
        mode: 'full',
      },
    ]
    const projectionFetch = makeProjectionFetch(() => responses.shift())
    vi.stubGlobal('fetch', projectionFetch.fetch)

    await expect(fetchServerPresetProjection('preset/a')).resolves.toEqual({
      status: 'ok',
      revision: 6,
      presetId: 'preset-a',
      preset: { name: 'Preset A' },
    })
    expect(parsedCallUrl(projectionFetch.calls[0]).searchParams.get('id')).toBe('preset/a')

    await expect(fetchServerPresetProjection('preset-b')).resolves.toEqual({
      status: 'error',
      error: 'Invalid preset response mode: full',
    })
  })

  it('fetches chat messages with tail or range query params and parses optional ranges', async () => {
    const responses = [
      {
        revision: 10,
        mode: 'chat-messages',
        chatId: 'chat/server',
        message: [{ role: 'user', data: 'tail' }],
        hypaV3Data: { summary: 'tail' },
        messageStart: 8,
        messageTotal: 10,
        alternates: [{ index: 1 }],
      },
      {
        revision: 11,
        mode: 'chat-messages',
        message: [{ role: 'char', data: 'range' }],
      },
    ]
    const projectionFetch = makeProjectionFetch(() => responses.shift())
    vi.stubGlobal('fetch', projectionFetch.fetch)

    await expect(fetchServerChatMessages('chat/request', { tail: 2, start: 4, limit: 99 })).resolves.toEqual({
      status: 'ok',
      revision: 10,
      chatId: 'chat/server',
      message: [{ role: 'user', data: 'tail' }],
      hypaV3Data: { summary: 'tail' },
      messageStart: 8,
      messageTotal: 10,
      alternates: [{ index: 1 }],
    })
    await expect(fetchServerChatMessages('chat/request', { start: 4, limit: 8 })).resolves.toEqual({
      status: 'ok',
      revision: 11,
      chatId: 'chat/request',
      message: [{ role: 'char', data: 'range' }],
      hypaV3Data: undefined,
      alternates: [],
    })

    const tailUrl = parsedCallUrl(projectionFetch.calls[0])
    expect(tailUrl.pathname).toBe('/api/v1/projection/chatMessages')
    expect(tailUrl.searchParams.get('id')).toBe('chat/request')
    expect(tailUrl.searchParams.get('tail')).toBe('2')
    expect(tailUrl.searchParams.has('start')).toBe(false)
    expect(tailUrl.searchParams.has('limit')).toBe(false)
    expect(projectionFetch.calls[0].authHeader).toBe('projection-auth-token')

    const rangeUrl = parsedCallUrl(projectionFetch.calls[1])
    expect(rangeUrl.searchParams.get('id')).toBe('chat/request')
    expect(rangeUrl.searchParams.get('start')).toBe('4')
    expect(rangeUrl.searchParams.get('limit')).toBe('8')
  })

  it('posts bulk chat hydration with JSON body and filters malformed missing ids', async () => {
    const projectionFetch = makeProjectionFetch(() => ({
      revision: 12,
      mode: 'chat-messages-bulk',
      chats: [
        { chatId: 'chat-a', message: [{ data: 'A' }], hypaV3Data: { a: true } },
        { chatId: 'chat-b', message: [] },
      ],
      missing: ['chat-c', 42, null],
    }))
    vi.stubGlobal('fetch', projectionFetch.fetch)

    await expect(fetchServerBulkChatMessages(['chat-a', 'chat-b', 'chat-c'])).resolves.toEqual({
      status: 'ok',
      revision: 12,
      chats: [
        { chatId: 'chat-a', message: [{ data: 'A' }], hypaV3Data: { a: true } },
        { chatId: 'chat-b', message: [], hypaV3Data: undefined },
      ],
      missing: ['chat-c'],
    })

    expect(projectionFetch.calls).toEqual([
      {
        url: '/api/v1/projection/chatMessages/bulk',
        method: 'POST',
        authHeader: 'projection-auth-token',
        contentType: 'application/json',
        body: { ids: ['chat-a', 'chat-b', 'chat-c'] },
        signal: null,
      },
    ])
  })

  it('fetches character lorebooks with encoded ids and response-id fallback', async () => {
    const responses = [
      {
        revision: 13,
        mode: 'character-lorebook',
        characterId: 'char/server',
        globalLore: [{ key: 'server' }],
      },
      {
        revision: 14,
        mode: 'character-lorebook',
        globalLore: [{ key: 'fallback' }],
      },
    ]
    const projectionFetch = makeProjectionFetch(() => responses.shift())
    vi.stubGlobal('fetch', projectionFetch.fetch)

    await expect(fetchServerCharacterLorebook('char/request one')).resolves.toEqual({
      status: 'ok',
      revision: 13,
      characterId: 'char/server',
      globalLore: [{ key: 'server' }],
    })
    await expect(fetchServerCharacterLorebook('char/request two')).resolves.toEqual({
      status: 'ok',
      revision: 14,
      characterId: 'char/request two',
      globalLore: [{ key: 'fallback' }],
    })

    expect(projectionFetch.calls[0].url).toBe('/api/v1/projection/characterLorebook?id=char%2Frequest%20one')
    expect(projectionFetch.calls[1].url).toBe('/api/v1/projection/characterLorebook?id=char%2Frequest%20two')
  })

  it('posts bulk character lorebook hydration with JSON body and filters malformed missing ids', async () => {
    const projectionFetch = makeProjectionFetch(() => ({
      revision: 15,
      mode: 'character-lorebooks-bulk',
      characters: [
        { characterId: 'char-a', globalLore: [{ key: 'A' }] },
        { characterId: 'char-b', globalLore: [] },
      ],
      missing: ['char-c', false],
    }))
    vi.stubGlobal('fetch', projectionFetch.fetch)

    await expect(fetchServerBulkCharacterLorebooks(['char-a', 'char-b', 'char-c'])).resolves.toEqual({
      status: 'ok',
      revision: 15,
      characters: [
        { characterId: 'char-a', globalLore: [{ key: 'A' }] },
        { characterId: 'char-b', globalLore: [] },
      ],
      missing: ['char-c'],
    })

    expect(projectionFetch.calls).toEqual([
      {
        url: '/api/v1/projection/characterLorebooks/bulk',
        method: 'POST',
        authHeader: 'projection-auth-token',
        contentType: 'application/json',
        body: { ids: ['char-a', 'char-b', 'char-c'] },
        signal: null,
      },
    ])
  })

  it('returns status errors for server, network, and malformed responses', async () => {
    const responses = [
      jsonResponse({ reason: 'active_writer_stale' }, 423),
      { revision: 'bad', mode: 'fields', fields: {} },
      { revision: 1, mode: 'fields', fields: [] },
      {
        revision: 1,
        mode: 'chat-messages',
        chatId: 'chat-a',
        message: [],
        messageStart: 3,
        messageTotal: 2,
      },
      {
        revision: 1,
        mode: 'chat-messages-bulk',
        chats: [{ chatId: 'chat-a' }],
      },
      {
        revision: 1,
        mode: 'character-lorebooks-bulk',
        characters: [{ characterId: 'char-a' }],
      },
    ]
    const projectionFetch = makeProjectionFetch(() => responses.shift())
    vi.stubGlobal('fetch', projectionFetch.fetch)

    await expect(fetchServerProjectionResource('state')).resolves.toEqual({
      status: 'error',
      error: 'active_writer_stale',
    })
    await expect(fetchServerProjectionResource('state')).resolves.toEqual({
      status: 'error',
      error: 'Invalid projection revision',
    })
    await expect(fetchServerProjectionResource('state')).resolves.toEqual({
      status: 'error',
      error: 'Invalid projection fields',
    })
    await expect(fetchServerChatMessages('chat-a')).resolves.toEqual({
      status: 'error',
      error: 'Invalid chat-messages range',
    })
    await expect(fetchServerBulkChatMessages(['chat-a'])).resolves.toEqual({
      status: 'error',
      error: 'Invalid bulk chat-messages entry',
    })
    await expect(fetchServerBulkCharacterLorebooks(['char-a'])).resolves.toEqual({
      status: 'error',
      error: 'Invalid bulk character-lorebook entry',
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }) as unknown as typeof fetch,
    )

    await expect(fetchServerCharacterLorebook('char-a')).resolves.toEqual({
      status: 'error',
      error: 'Network error: offline',
    })
  })
})
