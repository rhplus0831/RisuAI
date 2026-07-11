import { afterEach, describe, expect, it, vi } from 'vitest'
import { translateRawMessageData, type RawMessageTranslatorType } from '../src/translation/rawMessageTranslation.js'

type FetchInput = Parameters<typeof fetch>[0]

interface ProviderCase {
  name: string
  translatorType: Exclude<RawMessageTranslatorType, 'llm'>
  response: unknown
  expectedText: string
  assertRequest: (input: FetchInput, init: RequestInit | undefined, signal: AbortSignal) => void
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fetchUrl(input: FetchInput): URL {
  if (input instanceof URL) return input
  if (typeof input === 'string') return new URL(input)
  return new URL(input.url)
}

function jsonRequestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') {
    throw new Error('expected fetch to receive a JSON string body')
  }
  return JSON.parse(init.body)
}

function settingsFor(translatorType: Exclude<RawMessageTranslatorType, 'llm'>): Record<string, unknown> {
  const settings: Record<string, unknown> = {
    translatorType,
    translator: 'ko',
    translatorInputLanguage: 'en',
  }
  if (translatorType === 'deepl') {
    settings.deeplOptions = { key: 'deepl-secret', freeApi: true }
  } else if (translatorType === 'deeplX') {
    settings.deeplXOptions = {
      url: 'https://deeplx.example.test/base/',
      token: 'deeplx-secret',
    }
  }
  return settings
}

const providerCases: ProviderCase[] = [
  {
    name: 'Google',
    translatorType: 'google',
    response: [
      [
        ['안녕', 'hello'],
        ['!', '!'],
      ],
    ],
    expectedText: '안녕!',
    assertRequest(input, init, signal) {
      const url = fetchUrl(input)
      expect(`${url.origin}${url.pathname}`).toBe('https://translate.googleapis.com/translate_a/single')
      expect(Object.fromEntries(url.searchParams)).toEqual({
        client: 'gtx',
        dt: 't',
        sl: 'en',
        tl: 'ko',
        q: 'hello',
      })
      expect(init).toEqual({ method: 'GET', signal })
    },
  },
  {
    name: 'DeepL',
    translatorType: 'deepl',
    response: { translations: [{ text: '번역됨' }] },
    expectedText: '번역됨',
    assertRequest(input, init, signal) {
      expect(fetchUrl(input).href).toBe('https://api-free.deepl.com/v2/translate')
      expect(init?.method).toBe('POST')
      expect(init?.signal).toBe(signal)
      expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
        authorization: 'DeepL-Auth-Key deepl-secret',
        'content-type': 'application/json',
      })
      expect(jsonRequestBody(init)).toEqual({ text: ['hello'], target_lang: 'KO' })
    },
  },
  {
    name: 'DeepLX',
    translatorType: 'deeplX',
    response: { data: '번역됨' },
    expectedText: '번역됨',
    assertRequest(input, init, signal) {
      expect(fetchUrl(input).href).toBe('https://deeplx.example.test/base/translate')
      expect(init?.method).toBe('POST')
      expect(init?.signal).toBe(signal)
      expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
        authorization: 'Bearer deeplx-secret',
        'content-type': 'application/json',
      })
      expect(jsonRequestBody(init)).toEqual({
        text: 'hello',
        target_lang: 'KO',
        source_lang: 'EN',
      })
    },
  },
]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('translateRawMessageData', () => {
  it.each(providerCases)('uses the $name wire contract and returns normalized metadata', async (providerCase) => {
    const fetchMock = vi.fn(async (_input: FetchInput, _init?: RequestInit): Promise<Response> => {
      return jsonResponse(providerCase.response)
    })
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal

    const result = await translateRawMessageData({
      settings: settingsFor(providerCase.translatorType),
      text: 'hello',
      signal,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [input, init] = fetchMock.mock.calls[0]
    providerCase.assertRequest(input, init, signal)
    expect(result).toMatchObject({
      text: providerCase.expectedText,
      source: 'raw',
      targetLanguage: 'ko',
      inputLanguage: 'en',
      translatorType: providerCase.translatorType,
    })
    expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.settingsHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.updatedAt).toEqual(expect.any(Number))
  })

  it.each([
    {
      name: 'Google',
      translatorType: 'google' as const,
      body: '{"unexpected":true}',
      error: 'Google translation returned an unexpected response',
    },
    {
      name: 'DeepL',
      translatorType: 'deepl' as const,
      body: '{not-json',
      error: 'DeepL translation returned an unexpected response',
    },
    {
      name: 'DeepLX',
      translatorType: 'deeplX' as const,
      body: '{"data":42}',
      error: 'DeepLX translation returned an unexpected response',
    },
  ])('rejects a malformed $name response', async ({ translatorType, body, error }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (): Promise<Response> => new Response(body, { status: 200 })),
    )

    await expect(
      translateRawMessageData({
        settings: settingsFor(translatorType),
        text: 'hello',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(error)
  })

  it.each([
    { name: 'Google', translatorType: 'google' as const },
    { name: 'DeepL', translatorType: 'deepl' as const },
    { name: 'DeepLX', translatorType: 'deeplX' as const },
  ])('surfaces a non-2xx $name response', async ({ name, translatorType }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (): Promise<Response> => jsonResponse({ error: 'upstream failed' }, 502)),
    )

    await expect(
      translateRawMessageData({
        settings: settingsFor(translatorType),
        text: 'hello',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(`${name} translation failed with HTTP 502`)
  })

  it.each([
    {
      name: 'missing target language',
      settings: { translatorType: 'google', translator: '  ' },
      error: 'translator must be configured before translating a message',
    },
    {
      name: 'missing DeepL key',
      settings: { translatorType: 'deepl', translator: 'ko', deeplOptions: {} },
      error: 'deeplOptions.key is required for DeepL translation',
    },
    {
      name: 'browser-only Bergamot translator',
      settings: { translatorType: 'bergamot', translator: 'ko' },
      error: 'Firefox/Bergamot translation is not supported by server-side raw message translation',
    },
    {
      name: 'disabled translator',
      settings: { translatorType: 'none', translator: 'ko' },
      error: 'Translation is disabled',
    },
    {
      name: 'unknown translator',
      settings: { translatorType: 'custom', translator: 'ko' },
      error: 'Unsupported translator type: custom',
    },
  ])('rejects $name before dispatch', async ({ settings, error }) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      translateRawMessageData({
        settings,
        text: 'hello',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(error)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('translates text chunks without sending protected raw or media lines upstream', async () => {
    const translatedChunks: string[] = []
    const fetchMock = vi.fn(async (input: FetchInput): Promise<Response> => {
      const chunk = fetchUrl(input).searchParams.get('q')
      if (chunk === null) throw new Error('missing Google translation query')
      translatedChunks.push(chunk)
      return jsonResponse(chunk.toUpperCase())
    })
    vi.stubGlobal('fetch', fetchMock)
    const text = [
      'before',
      '{{img::assets/image.png}}',
      'between image and raw',
      '{{raw::leave <b>this</b> alone}}',
      'between raw and video',
      '{{video::assets/video.mp4}}',
      'between video and audio',
      '{{audio::assets/audio.mp3}}',
      'after',
    ].join('\n')

    const result = await translateRawMessageData({
      settings: settingsFor('google'),
      text,
      signal: new AbortController().signal,
    })

    expect(translatedChunks).toEqual([
      'before',
      'between image and raw',
      'between raw and video',
      'between video and audio',
      'after',
    ])
    expect(result.text).toBe(
      [
        'BEFORE',
        '{{img::assets/image.png}}',
        'BETWEEN IMAGE AND RAW',
        '{{raw::leave <b>this</b> alone}}',
        'BETWEEN RAW AND VIDEO',
        '{{video::assets/video.mp4}}',
        'BETWEEN VIDEO AND AUDIO',
        '{{audio::assets/audio.mp3}}',
        'AFTER',
      ].join('\n'),
    )
  })
})
