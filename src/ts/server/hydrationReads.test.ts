import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'resource-auth-token',
}))

import {
  fetchServerBulkCharacterLorebooks,
  fetchServerBulkChatMessages,
  fetchServerCharacterLorebook,
  fetchServerChatMessages,
  fetchServerGenerationChatMessages,
  fetchServerLegacyPreset,
  fetchServerPromptPresetTemplate,
} from './hydrationReads'

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

function makeResourceFetch(bodyForRequest: (url: string, init: RequestInit) => unknown): {
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

describe('server hydration read clients', () => {
  it('fetches legacy preset detail through the resource endpoint', async () => {
    const controller = new AbortController()
    const responses = [
      {
        revision: 6,
        preset: { id: 'preset-a', name: 'Preset A' },
      },
      {
        revision: 7,
        preset: null,
      },
    ]
    const resourceFetch = makeResourceFetch(() => responses.shift())
    vi.stubGlobal('fetch', resourceFetch.fetch)

    await expect(fetchServerLegacyPreset('preset/a', { signal: controller.signal })).resolves.toEqual({
      status: 'ok',
      revision: 6,
      presetId: 'preset-a',
      preset: { id: 'preset-a', name: 'Preset A' },
    })
    expect(parsedCallUrl(resourceFetch.calls[0]).pathname).toBe('/api/v1/legacy-presets/preset%2Fa')
    expect(resourceFetch.calls[0]).toMatchObject({
      method: 'GET',
      authHeader: 'resource-auth-token',
      contentType: null,
      body: null,
      signal: controller.signal,
    })

    await expect(fetchServerLegacyPreset('preset-b')).resolves.toEqual({
      status: 'error',
      error: 'Invalid preset response',
    })
  })

  it('fetches a prompt preset template by encoded stable id', async () => {
    const controller = new AbortController()
    const resourceFetch = makeResourceFetch(() => ({
      revision: 8,
      promptPresetId: 'preset/one',
      promptTemplate: [{ id: 'prompt-1', text: 'hello' }],
    }))
    vi.stubGlobal('fetch', resourceFetch.fetch)

    await expect(fetchServerPromptPresetTemplate('preset/one', { signal: controller.signal })).resolves.toEqual({
      status: 'ok',
      revision: 8,
      promptPresetId: 'preset/one',
      promptTemplate: [{ id: 'prompt-1', text: 'hello' }],
    })
    expect(parsedCallUrl(resourceFetch.calls[0]).pathname).toBe('/api/v1/prompt-presets/preset%2Fone/template')
    expect(resourceFetch.calls[0]).toMatchObject({
      method: 'GET',
      authHeader: 'resource-auth-token',
      signal: controller.signal,
    })
  })

  it('fetches chat messages with tail or range query params and parses optional ranges', async () => {
    const responses = [
      {
        revision: 10,
        chatId: 'chat/server',
        message: [{ role: 'user', data: 'tail' }],
        hypaV3Data: { summary: 'tail' },
        messageStart: 8,
        messageTotal: 10,
        alternates: [{ index: 1 }],
      },
      {
        revision: 11,
        message: [{ role: 'char', data: 'range' }],
      },
    ]
    const resourceFetch = makeResourceFetch(() => responses.shift())
    vi.stubGlobal('fetch', resourceFetch.fetch)

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

    const tailUrl = parsedCallUrl(resourceFetch.calls[0])
    expect(tailUrl.pathname).toBe('/api/v1/chats/chat%2Frequest/messages')
    expect(tailUrl.searchParams.get('tail')).toBe('2')
    expect(tailUrl.searchParams.has('start')).toBe(false)
    expect(tailUrl.searchParams.has('limit')).toBe(false)
    expect(resourceFetch.calls[0].authHeader).toBe('resource-auth-token')

    const rangeUrl = parsedCallUrl(resourceFetch.calls[1])
    expect(rangeUrl.pathname).toBe('/api/v1/chats/chat%2Frequest/messages')
    expect(rangeUrl.searchParams.has('id')).toBe(false)
    expect(rangeUrl.searchParams.get('start')).toBe('4')
    expect(rangeUrl.searchParams.get('limit')).toBe('8')
  })

  it('fetches a bounded generation suffix by encoded active message id', async () => {
    const controller = new AbortController()
    const resourceFetch = makeResourceFetch(() => ({
      revision: 12,
      chatId: 'chat/request',
      message: [{ role: 'char', data: 'generated' }],
      messageStart: 9,
      messageTotal: 10,
      alternates: [{ role: 'char', data: 'alternate' }],
    }))
    vi.stubGlobal('fetch', resourceFetch.fetch)

    await expect(
      fetchServerGenerationChatMessages('chat/request', 'message/generated', { signal: controller.signal }),
    ).resolves.toEqual({
      status: 'ok',
      revision: 12,
      chatId: 'chat/request',
      message: [{ role: 'char', data: 'generated' }],
      hypaV3Data: undefined,
      messageStart: 9,
      messageTotal: 10,
      alternates: [{ role: 'char', data: 'alternate' }],
    })

    const url = parsedCallUrl(resourceFetch.calls[0])
    expect(url.pathname).toBe('/api/v1/chats/chat%2Frequest/messages')
    expect(url.searchParams.get('generationMessageId')).toBe('message/generated')
    expect(resourceFetch.calls[0]).toMatchObject({
      method: 'GET',
      authHeader: 'resource-auth-token',
      signal: controller.signal,
    })

    await expect(fetchServerGenerationChatMessages('chat-a', '')).resolves.toEqual({
      status: 'error',
      error: 'Generation message id is required',
    })
    expect(resourceFetch.calls).toHaveLength(1)
  })

  it('posts bulk chat hydration with JSON body and filters malformed missing ids', async () => {
    const resourceFetch = makeResourceFetch(() => ({
      revision: 12,
      chats: [
        { chatId: 'chat-a', message: [{ data: 'A' }], hypaV3Data: { a: true } },
        { chatId: 'chat-b', message: [] },
      ],
      missing: ['chat-c', 42, null],
    }))
    vi.stubGlobal('fetch', resourceFetch.fetch)

    await expect(fetchServerBulkChatMessages(['chat-a', 'chat-b', 'chat-c'])).resolves.toEqual({
      status: 'ok',
      revision: 12,
      chats: [
        { chatId: 'chat-a', message: [{ data: 'A' }], hypaV3Data: { a: true } },
        { chatId: 'chat-b', message: [], hypaV3Data: undefined },
      ],
      missing: ['chat-c'],
    })

    expect(resourceFetch.calls).toEqual([
      {
        url: '/api/v1/chats/messages/bulk',
        method: 'POST',
        authHeader: 'resource-auth-token',
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
        characterId: 'char/server',
        globalLore: [{ key: 'server' }],
      },
      {
        revision: 14,
        globalLore: [{ key: 'fallback' }],
      },
    ]
    const resourceFetch = makeResourceFetch(() => responses.shift())
    vi.stubGlobal('fetch', resourceFetch.fetch)

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

    expect(resourceFetch.calls[0].url).toBe('/api/v1/characters/char%2Frequest%20one/lorebook')
    expect(resourceFetch.calls[1].url).toBe('/api/v1/characters/char%2Frequest%20two/lorebook')
  })

  it('posts bulk character lorebook hydration with JSON body and filters malformed missing ids', async () => {
    const resourceFetch = makeResourceFetch(() => ({
      revision: 15,
      characters: [
        { characterId: 'char-a', globalLore: [{ key: 'A' }] },
        { characterId: 'char-b', globalLore: [] },
      ],
      missing: ['char-c', false],
    }))
    vi.stubGlobal('fetch', resourceFetch.fetch)

    await expect(fetchServerBulkCharacterLorebooks(['char-a', 'char-b', 'char-c'])).resolves.toEqual({
      status: 'ok',
      revision: 15,
      characters: [
        { characterId: 'char-a', globalLore: [{ key: 'A' }] },
        { characterId: 'char-b', globalLore: [] },
      ],
      missing: ['char-c'],
    })

    expect(resourceFetch.calls).toEqual([
      {
        url: '/api/v1/characters/lorebooks/bulk',
        method: 'POST',
        authHeader: 'resource-auth-token',
        contentType: 'application/json',
        body: { ids: ['char-a', 'char-b', 'char-c'] },
        signal: null,
      },
    ])
  })

  it('returns status errors for server, network, and malformed responses', async () => {
    const responses = [
      jsonResponse({ reason: 'active_writer_stale' }, 423),
      { revision: 'bad', promptPresetId: 'preset-a', promptTemplate: [] },
      { revision: 1, promptPresetId: 'preset-a', promptTemplate: {} },
      {
        revision: 1,
        chatId: 'chat-a',
        message: [],
        messageStart: 3,
        messageTotal: 2,
      },
      {
        revision: 1,
        chats: [{ chatId: 'chat-a' }],
      },
      {
        revision: 1,
        characters: [{ characterId: 'char-a' }],
      },
    ]
    const resourceFetch = makeResourceFetch(() => responses.shift())
    vi.stubGlobal('fetch', resourceFetch.fetch)

    await expect(fetchServerLegacyPreset('preset-a')).resolves.toEqual({
      status: 'error',
      error: 'active_writer_stale',
    })
    await expect(fetchServerPromptPresetTemplate('preset-a')).resolves.toEqual({
      status: 'error',
      error: 'Invalid resource revision',
    })
    await expect(fetchServerPromptPresetTemplate('preset-a')).resolves.toEqual({
      status: 'error',
      error: 'Invalid prompt preset template response',
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
