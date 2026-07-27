import { afterEach, describe, expect, it, vi } from 'vitest'

const rawTranslationMocks = vi.hoisted(() => ({
  dispatchChatProvider: vi.fn(),
}))

vi.mock('../src/prompt/chatDispatch.js', () => ({
  dispatchChatProvider: rawTranslationMocks.dispatchChatProvider,
}))

import {
  resolveRawMessageTranslatorIdentity,
  translateRawMessageData,
  type RawMessageTranslatorType,
} from '../src/translation/rawMessageTranslation.js'
import { tokenize } from '../src/prompt/tokens.js'

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

function llmSettings(translatorSendTextAsIs: boolean, translatorExcludeThoughts = false): Record<string, unknown> {
  return {
    translatorType: 'llm',
    translator: 'ko',
    translatorInputLanguage: 'en',
    aiModel: 'echo_model',
    translatorSendTextAsIs,
    translatorExcludeThoughts,
  }
}

function historyLlmSettings(count: number, translatorSendTextAsIs = true): Record<string, unknown> {
  return {
    ...llmSettings(translatorSendTextAsIs),
    translatorPrompt: `History:\n{{slot::history::${count}}}\nTranslations:\n{{slot::historytrans::${count}}}\nSource={{slot::content}}`,
  }
}

function historyBlock(role: 'user' | 'char', body: string): string {
  return `${role}: ${body}\n\n---\n\n`
}

function textFrames(text: string) {
  return (async function* () {
    yield { kind: 'token' as const, content: text }
  })()
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
  rawTranslationMocks.dispatchChatProvider.mockReset()
  vi.unstubAllGlobals()
})

describe('translateRawMessageData', () => {
  it('changes the server settings hash for every pipeline execution field but not step labels', () => {
    const createSettings = () => ({
      ...llmSettings(true),
      providerCredentials: [
        {
          id: 'credential-a',
          name: 'Credential A',
          type: 'apiKey',
          apiKey: 'secret-a',
        },
      ],
      modelProfiles: [
        {
          id: 'profile-a',
          name: 'Profile A',
          providerId: 'debug-echo',
          modelId: 'debug-echo',
          providerOptions: { credentialId: 'credential-a' },
        },
      ],
      translatorPresetId: 0,
      translatorPresets: [
        {
          id: 'preset-a',
          name: 'Preset A',
          prompt: 'Prompt {{slot::content}}',
          maxResponse: 100,
          steps: [
            {
              id: 'step-a',
              name: 'Step A',
              enabled: true,
              prompt: 'Prompt {{slot::content}}',
              maxResponse: 100,
              model: { mode: 'inheritTranslate' },
              outputKey: 'draft',
            },
          ],
        },
      ],
    })
    const hash = (settings: Record<string, unknown>) => resolveRawMessageTranslatorIdentity({ settings }).settingsHash
    const baselineSettings = createSettings()
    const baseline = hash(baselineSettings)
    const mutations = [
      (step: any) => (step.prompt = 'Changed {{slot::content}}'),
      (step: any) => (step.maxResponse = 200),
      (step: any) => (step.model = { mode: 'modelProfile', profileId: 'profile-a' }),
      (step: any) => (step.outputKey = 'renamed'),
      (step: any) => (step.enabled = false),
    ]
    for (const mutate of mutations) {
      const changed = createSettings()
      mutate(changed.translatorPresets[0].steps[0])
      expect(hash(changed)).not.toBe(baseline)
    }
    const rotatedCredential = createSettings()
    rotatedCredential.providerCredentials[0].apiKey = 'rotated-secret'
    expect(hash(rotatedCredential)).not.toBe(baseline)
    const relabeled = createSettings()
    relabeled.translatorPresets[0].name = 'Renamed preset'
    relabeled.translatorPresets[0].steps[0].id = 'renamed-step-id'
    relabeled.translatorPresets[0].steps[0].name = 'Renamed step'
    expect(hash(relabeled)).toBe(baseline)

    const excludingThoughts = { ...createSettings(), translatorExcludeThoughts: true }
    expect(hash(excludingThoughts)).not.toBe(baseline)
  })

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
      name: 'unknown translator',
      settings: { translatorType: 'unknown-translator', translator: 'ko' },
      error: 'Unsupported translator type: unknown-translator',
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

  it('sends one untouched LLM request and stores its response verbatim when send-text-as-is is enabled', async () => {
    const text = [
      '  before',
      '<Thoughts>keep this by default</Thoughts>',
      '{{img::assets/image.png}}',
      '',
      '<risu-style>color:red</risu-style>',
      'after  ',
    ].join('\n')
    const rawResponse = '  translated exactly\n\n'
    rawTranslationMocks.dispatchChatProvider.mockImplementation(async () => textFrames(rawResponse))

    const result = await translateRawMessageData({
      settings: llmSettings(true),
      text,
      signal: new AbortController().signal,
    })

    expect(rawTranslationMocks.dispatchChatProvider).toHaveBeenCalledTimes(1)
    const request = rawTranslationMocks.dispatchChatProvider.mock.calls[0][0]
    expect(request.formated).toContainEqual({ role: 'user', content: text })
    expect(result.text).toBe(rawResponse)
  })

  it('removes internal reasoning from send-text-as-is source text when exclusion is enabled', async () => {
    const text =
      '<Thoughts data-private="true">draft secret <think>nested secret</think></Thoughts>\n' +
      'visible source\n<THINK>more private reasoning</THINK>'
    rawTranslationMocks.dispatchChatProvider.mockImplementation(async () => textFrames('translated'))

    await translateRawMessageData({
      settings: llmSettings(true, true),
      text,
      signal: new AbortController().signal,
    })

    expect(rawTranslationMocks.dispatchChatProvider).toHaveBeenCalledTimes(1)
    expect(rawTranslationMocks.dispatchChatProvider.mock.calls[0][0].formated).toContainEqual({
      role: 'user',
      content: 'visible source',
    })
  })

  it('removes internal reasoning wrappers from an LLM translation result', async () => {
    const rawResponse =
      '<Thoughts>private translation reasoning</Thoughts>\n<think>more private reasoning</think>\n번역됨'
    rawTranslationMocks.dispatchChatProvider.mockImplementation(async () => textFrames(rawResponse))

    const result = await translateRawMessageData({
      settings: llmSettings(true),
      text: 'source',
      signal: new AbortController().signal,
    })

    expect(result.text).toBe('번역됨')
  })

  it('runs an LLM translator pipeline sequentially with per-step limits, named outputs, and model profiles', async () => {
    const settings = {
      ...llmSettings(true),
      modelProfiles: [
        {
          id: 'refine-profile',
          name: 'Refine Profile',
          providerId: 'debug-echo',
          modelId: 'debug-echo',
          providerOptions: { baseUrl: 'debug://refine', requestModel: 'refine-model' },
        },
      ],
      translatorPresets: [
        {
          id: 'pipeline',
          name: 'Pipeline',
          prompt: 'Draft {{slot::content}}',
          maxResponse: 111,
          steps: [
            {
              id: 'draft',
              name: 'Draft',
              enabled: true,
              prompt: 'Draft {{slot::content}}',
              maxResponse: 111,
              model: { mode: 'inheritTranslate' },
              outputKey: 'draft',
            },
            {
              id: 'refine',
              name: 'Refine',
              enabled: true,
              prompt: 'Refine {{slot::prev}} / {{slot::out::draft}} / {{slot::content}}',
              maxResponse: 222,
              model: { mode: 'modelProfile', profileId: 'refine-profile' },
            },
          ],
        },
      ],
      translatorPresetId: 0,
    }
    rawTranslationMocks.dispatchChatProvider
      .mockImplementationOnce(async () => textFrames('draft output'))
      .mockImplementationOnce(async () => textFrames('final output'))

    const result = await translateRawMessageData({
      settings,
      text: 'original source',
      signal: new AbortController().signal,
    })

    expect(result.text).toBe('final output')
    expect(rawTranslationMocks.dispatchChatProvider).toHaveBeenCalledTimes(2)
    expect(rawTranslationMocks.dispatchChatProvider.mock.calls[0][0]).toMatchObject({
      outputTokens: 111,
      profile: { modelId: 'echo_model' },
      formated: [{ role: 'system', content: 'Draft original source' }],
    })
    expect(rawTranslationMocks.dispatchChatProvider.mock.calls[1][0]).toMatchObject({
      outputTokens: 222,
      profile: { modelId: 'debug-echo', profileId: 'refine-profile' },
      formated: [
        {
          role: 'system',
          content: 'Refine draft output / draft output / original source',
        },
      ],
    })

    rawTranslationMocks.dispatchChatProvider.mockReset()
    rawTranslationMocks.dispatchChatProvider.mockImplementation(async () => textFrames('changed output'))
    const editedSettings = structuredClone(settings)
    ;(editedSettings.translatorPresets[0].steps[1] as { enabled: boolean }).enabled = false
    const edited = await translateRawMessageData({
      settings: editedSettings,
      text: 'original source',
      signal: new AbortController().signal,
    })
    expect(edited.settingsHash).not.toBe(result.settingsHash)
  })

  it('selects visible history without comments or disabled messages and keeps source and translation blocks aligned', async () => {
    rawTranslationMocks.dispatchChatProvider.mockImplementation(async () => textFrames('translated'))
    const historyContext = {
      messages: [
        { role: 'user', data: 'old source', translation: { text: 'old translated', translatorType: 'google' } },
        { role: 'char', data: 'comment', isComment: true },
        { role: 'user', data: 'disabled', disabled: true },
        { role: 'char', data: 'new source' },
        { role: 'user', data: 'current source' },
      ],
      messageIndex: 4,
      greeting: { source: 'unused greeting' },
    }

    await translateRawMessageData({
      settings: historyLlmSettings(2),
      text: 'current source',
      historyContext,
      signal: new AbortController().signal,
    })

    expect(rawTranslationMocks.dispatchChatProvider.mock.calls[0][0].formated).toEqual([
      {
        role: 'system',
        content:
          `History:\n${historyBlock('user', 'old source')}${historyBlock('char', 'new source')}\n` +
          `Translations:\n${historyBlock('user', 'old translated')}${historyBlock('char', '')}\n` +
          'Source=current source',
      },
    ])
  })

  it('removes internal reasoning from send-text-as-is source and translated history slots', async () => {
    rawTranslationMocks.dispatchChatProvider.mockImplementation(async () => textFrames('translated'))

    await translateRawMessageData({
      settings: {
        ...historyLlmSettings(3),
        translatorExcludeThoughts: true,
      },
      text: '<Thoughts>current private</Thoughts>\ncurrent source',
      historyContext: {
        messages: [
          {
            role: 'user',
            data: '<Thoughts>old private</Thoughts>\nold source',
            translation: { text: '<think>old translated private</think>\nold translated' },
          },
          {
            role: 'char',
            data: 'new source\n<think>new private</think>',
            translation: { text: 'new translated\n<Thoughts>new translated private</Thoughts>' },
          },
          { role: 'user', data: 'current source' },
        ],
        messageIndex: 2,
        greeting: {
          source: '<think>greeting private</think>\ngreeting source',
          translated: '<Thoughts>translated greeting private</Thoughts>\ngreeting translated',
        },
      },
      signal: new AbortController().signal,
    })

    expect(rawTranslationMocks.dispatchChatProvider.mock.calls[0][0].formated[0].content).toBe(
      `History:\n${historyBlock('char', 'greeting source')}${historyBlock('user', 'old source')}${historyBlock('char', 'new source')}\n` +
        `Translations:\n${historyBlock('char', 'greeting translated')}${historyBlock('user', 'old translated')}${historyBlock('char', 'new translated')}\n` +
        'Source=current source',
    )
  })

  it('treats allBefore as a reset boundary and does not restore the greeting behind it', async () => {
    rawTranslationMocks.dispatchChatProvider.mockImplementation(async () => textFrames('translated'))

    await translateRawMessageData({
      settings: historyLlmSettings(5),
      text: 'current source',
      historyContext: {
        messages: [
          { role: 'user', data: 'hidden older' },
          { role: 'char', data: 'reset', disabled: 'allBefore' },
          { role: 'user', data: 'visible newer' },
          { role: 'char', data: 'current source' },
        ],
        messageIndex: 3,
        greeting: { source: 'hidden greeting', translated: 'hidden greeting translated' },
      },
      signal: new AbortController().signal,
    })

    expect(rawTranslationMocks.dispatchChatProvider.mock.calls[0][0].formated[0].content).toBe(
      `History:\n${historyBlock('user', 'visible newer')}\n` +
        `Translations:\n${historyBlock('user', '')}\n` +
        'Source=current source',
    )
  })

  it('prepends the persisted greeting source and translation when history is exhausted', async () => {
    rawTranslationMocks.dispatchChatProvider.mockImplementation(async () => textFrames('translated'))

    await translateRawMessageData({
      settings: historyLlmSettings(2),
      text: 'current source',
      historyContext: {
        messages: [
          { role: 'user', data: 'prior source', translation: { text: 'prior translated' } },
          { role: 'char', data: 'current source' },
        ],
        messageIndex: 1,
        greeting: { source: 'selected greeting', translated: 'selected greeting translated' },
      },
      signal: new AbortController().signal,
    })

    expect(rawTranslationMocks.dispatchChatProvider.mock.calls[0][0].formated[0].content).toBe(
      `History:\n${historyBlock('char', 'selected greeting')}${historyBlock('user', 'prior source')}\n` +
        `Translations:\n${historyBlock('char', 'selected greeting translated')}${historyBlock('user', 'prior translated')}\n` +
        'Source=current source',
    )
  })

  it('drops whole oldest entries from both slots to meet the shared token limit', async () => {
    rawTranslationMocks.dispatchChatProvider.mockImplementation(async () => textFrames('translated'))
    const newestSource = historyBlock('char', 'new source')
    const newestTranslation = historyBlock('char', 'new translated')
    const settings = {
      ...historyLlmSettings(2),
      translatorHistoryMaxTokens: tokenize(newestSource) + tokenize(newestTranslation),
    }

    await translateRawMessageData({
      settings,
      text: 'current source',
      historyContext: {
        messages: [
          { role: 'user', data: 'old source', translation: { text: 'old translated' } },
          { role: 'char', data: 'new source', translation: { text: 'new translated' } },
          { role: 'user', data: 'current source' },
        ],
        messageIndex: 2,
        greeting: { source: '' },
      },
      signal: new AbortController().signal,
    })

    expect(rawTranslationMocks.dispatchChatProvider.mock.calls[0][0].formated[0].content).toBe(
      `History:\n${newestSource}\nTranslations:\n${newestTranslation}\nSource=current source`,
    )
  })

  it('resolves history slots to empty strings in non-as-is LLM mode', async () => {
    rawTranslationMocks.dispatchChatProvider.mockImplementation(async () => textFrames('translated'))

    await translateRawMessageData({
      settings: historyLlmSettings(1, false),
      text: 'current source',
      historyContext: {
        messages: [
          { role: 'user', data: 'must not leak', translation: { text: 'must not leak translated' } },
          { role: 'char', data: 'current source' },
        ],
        messageIndex: 1,
        greeting: { source: 'must not leak greeting', translated: 'must not leak greeting translated' },
      },
      signal: new AbortController().signal,
    })

    expect(rawTranslationMocks.dispatchChatProvider.mock.calls[0][0].formated).toEqual([
      {
        role: 'system',
        content: 'History:\n\nTranslations:\n\nSource=current source',
      },
    ])
  })

  it('keeps LLM chunk protection when send-text-as-is is false and changes the settings hash when toggled', async () => {
    const text = ['before', '{{img::assets/image.png}}', '', 'after'].join('\n')
    rawTranslationMocks.dispatchChatProvider.mockImplementation(async ({ formated }) => {
      const content = formated.at(-1)?.content ?? ''
      return textFrames(`  ${content.toUpperCase()}  `)
    })

    const chunked = await translateRawMessageData({
      settings: llmSettings(false),
      text,
      signal: new AbortController().signal,
    })

    expect(rawTranslationMocks.dispatchChatProvider).toHaveBeenCalledTimes(2)
    expect(
      rawTranslationMocks.dispatchChatProvider.mock.calls.map(([request]) => request.formated.at(-1)?.content),
    ).toEqual(['before', 'after'])
    expect(chunked.text).toBe(['BEFORE', '{{img::assets/image.png}}', '', '', 'AFTER'].join('\n'))

    rawTranslationMocks.dispatchChatProvider.mockReset()
    rawTranslationMocks.dispatchChatProvider.mockImplementation(async () => textFrames('whole response'))
    const asIs = await translateRawMessageData({
      settings: llmSettings(true),
      text,
      signal: new AbortController().signal,
    })

    expect(asIs.settingsHash).not.toBe(chunked.settingsHash)
  })
})
