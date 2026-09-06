import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signature: 'client-a',
  auth: vi.fn(async () => 'auth-token'),
}))

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: mocks.auth,
}))
vi.mock('../translator/translator', () => ({
  getTranslatorSettingsSignatureKey: () => mocks.signature,
}))

import {
  applyGreetingTranslationCommandReceipt,
  applyGreetingTranslationProjection,
  clearGreetingTranslationProjection,
  findGreetingTranslation,
  getGreetingTranslationProjection,
  refreshGreetingTranslationProjection,
} from './greetingTranslations.svelte'

function hash(value: string): string {
  const known: Record<string, string> = {
    primary: '986a1b7135f4986150aa5fa0028feeaa66cdaf3ed6a00a355dd86e042f7fb494',
    alternate: '3f251db73f53a7fba1944fa7823e4fe9a2b83a001723311507ada0cef0ce16bc',
  }
  return known[value]
}

function translation(source: string, settingsHash = 'server-a') {
  return {
    text: `${source} translated`,
    source: 'raw' as const,
    sourceHash: hash(source),
    targetLanguage: 'ko',
    inputLanguage: 'en',
    translatorType: 'google' as const,
    settingsHash,
    updatedAt: 123,
  }
}

beforeEach(() => {
  vi.unstubAllGlobals()
  clearGreetingTranslationProjection()
  mocks.signature = 'client-a'
  vi.restoreAllMocks()
})

describe('greeting translation projection', () => {
  it('reports authentication setup failures without leaking a rejected effect promise', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    mocks.auth.mockRejectedValueOnce(new Error('auth unavailable'))

    await expect(refreshGreetingTranslationProjection('char-a', 'chat-a')).resolves.toEqual({
      status: 'error',
      error: 'Network error: auth unavailable',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('filters by current source and applies a fenced command receipt', () => {
    expect(
      applyGreetingTranslationProjection({
        revision: 2,
        characterId: 'char-a',
        chatId: 'chat-a',
        settingsHash: 'server-a',
        clientSettingsSignature: 'client-a',
        translations: [{ greetingIndex: -1, translation: translation('primary') }],
      }),
    ).toBe(true)
    expect(
      findGreetingTranslation({
        characterId: 'char-a',
        chatId: 'chat-a',
        greetingIndex: -1,
        source: 'primary',
        clientSettingsSignature: 'client-a',
      })?.text,
    ).toBe('primary translated')
    expect(
      findGreetingTranslation({
        characterId: 'char-a',
        chatId: 'chat-a',
        greetingIndex: -1,
        source: 'edited',
        clientSettingsSignature: 'client-a',
      }),
    ).toBeNull()

    expect(
      applyGreetingTranslationCommandReceipt({
        revision: 3,
        characterId: 'char-a',
        chatId: 'chat-a',
        greetingIndex: 0,
        settingsHash: 'server-a',
        clientSettingsSignature: 'client-a',
        translation: translation('alternate'),
      }),
    ).toBe(true)
    expect(getGreetingTranslationProjection('char-a', 'chat-a')?.translations).toHaveLength(2)
    expect(
      applyGreetingTranslationCommandReceipt({
        revision: 4,
        characterId: 'char-a',
        chatId: 'chat-a',
        greetingIndex: 0,
        settingsHash: 'other-server',
        clientSettingsSignature: 'client-a',
        translation: translation('alternate', 'other-server'),
      }),
    ).toBe(false)
  })

  it('clears the old signature before fetching and rejects an older invalidation response', async () => {
    applyGreetingTranslationProjection({
      revision: 5,
      characterId: 'char-a',
      chatId: 'chat-a',
      settingsHash: 'server-a',
      clientSettingsSignature: 'client-a',
      translations: [{ greetingIndex: -1, translation: translation('primary') }],
    })
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (resolveFetch = resolve)))
    vi.stubGlobal('fetch', fetchMock)

    const pending = refreshGreetingTranslationProjection('char-a', 'chat-a', {
      clientSettingsSignature: 'client-b',
      minimumRevision: 9,
    })
    expect(getGreetingTranslationProjection('char-a', 'chat-a')).toBeNull()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    resolveFetch(
      new Response(
        JSON.stringify({
          revision: 8,
          characterId: 'char-a',
          chatId: 'chat-a',
          settingsHash: 'server-b',
          translations: [],
        }),
        { status: 200 },
      ),
    )
    await expect(pending).resolves.toEqual({
      status: 'error',
      error: 'Greeting translation projection is older than the invalidating event',
    })
    expect(getGreetingTranslationProjection('char-a', 'chat-a')).toBeNull()
  })

  it('does not let an older overlapping read replace the latest projection', async () => {
    const resolvers: Array<(response: Response) => void> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolvers.push(resolve)
          }),
      ),
    )
    const older = refreshGreetingTranslationProjection('char-a', 'chat-a')
    const newer = refreshGreetingTranslationProjection('char-a', 'chat-a')
    await vi.waitFor(() => expect(resolvers).toHaveLength(2))
    resolvers[1](
      new Response(
        JSON.stringify({
          revision: 4,
          characterId: 'char-a',
          chatId: 'chat-a',
          settingsHash: 'server-new',
          translations: [],
        }),
        { status: 200 },
      ),
    )
    await expect(newer).resolves.toMatchObject({ status: 'ok', revision: 4 })
    resolvers[0](
      new Response(
        JSON.stringify({
          revision: 3,
          characterId: 'char-a',
          chatId: 'chat-a',
          settingsHash: 'server-old',
          translations: [],
        }),
        { status: 200 },
      ),
    )
    await expect(older).resolves.toMatchObject({ status: 'ok', revision: 3 })
    expect(getGreetingTranslationProjection('char-a', 'chat-a')).toMatchObject({
      revision: 4,
      settingsHash: 'server-new',
    })
  })
})
