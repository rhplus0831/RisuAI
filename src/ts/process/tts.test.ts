import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { character } from '../storage/database.svelte'

const testState = vi.hoisted(() => ({
  alertError: vi.fn(),
  db: {} as any,
  currentCharacter: null as character | null,
  globalFetch: vi.fn(),
  loadAsset: vi.fn(),
  runTranslator: vi.fn(),
  translateVox: vi.fn(),
  runVITS: vi.fn(),
  sleep: vi.fn(async () => {}),
}))

vi.mock('../alert', () => ({
  alertError: testState.alertError,
}))

vi.mock('../globalApi.svelte', () => ({
  globalFetch: testState.globalFetch,
  loadAsset: testState.loadAsset,
}))

vi.mock('../storage/database.svelte', () => ({
  getCurrentCharacter: () => testState.currentCharacter,
  getDatabase: () => testState.db,
}))

vi.mock('../translator/translator', () => ({
  runTranslator: testState.runTranslator,
  translateVox: testState.translateVox,
}))

vi.mock('../util', () => ({
  sleep: testState.sleep,
}))

vi.mock('./transformers', () => ({
  runVITS: testState.runVITS,
}))

vi.mock('src/lang', () => ({
  language: {
    errors: {
      httpError: 'HTTP: ',
    },
  },
}))

interface StubSource {
  buffer: AudioBuffer | null
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  onended: (() => void) | null
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

interface StubGain {
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  gain: {
    value: number
  }
}

class StubAudioContext {
  static instances: StubAudioContext[] = []

  decoded: ArrayBuffer[] = []
  destination = { kind: 'destination' }
  gains: StubGain[] = []
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  sources: StubSource[] = []
  state: AudioContextState = 'running'

  constructor() {
    StubAudioContext.instances.push(this)
  }

  async decodeAudioData(audio: ArrayBuffer): Promise<AudioBuffer> {
    this.decoded.push(audio)
    return { kind: 'decoded-audio' } as unknown as AudioBuffer
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = {
      buffer: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      onended: null,
      start: vi.fn(),
      stop: vi.fn(() => {
        source.onended?.()
      }),
    } satisfies StubSource
    this.sources.push(source)
    return source as unknown as AudioBufferSourceNode
  }

  createGain(): GainNode {
    const gain = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      gain: {
        value: 1,
      },
    } satisfies StubGain
    this.gains.push(gain)
    return gain as unknown as GainNode
  }
}

function audioResponse(bytes = new Uint8Array([1, 2, 3]), contentType = 'audio/wav') {
  return {
    status: 200,
    headers: {
      get: vi.fn((name: string) => (name.toLowerCase() === 'content-type' ? contentType : null)),
    },
    arrayBuffer: vi.fn(async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    json: vi.fn(),
    text: vi.fn(async () => ''),
  } as unknown as Response
}

function hf503Response(estimatedTime = 0.001) {
  return {
    status: 503,
    headers: {
      get: vi.fn((name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null)),
    },
    arrayBuffer: vi.fn(),
    json: vi.fn(async () => ({ estimated_time: estimatedTime })),
    text: vi.fn(async () => ''),
  } as unknown as Response
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body),
  } as unknown as Response
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeCharacter(overrides: Partial<character> = {}): character {
  return {
    chaId: 'char-tts',
    name: 'TTS Test',
    ttsMode: 'elevenlab',
    ttsSpeech: 'voice-a',
    ...overrides,
  } as character
}

function makeGptSoVitsCharacter(volume = 0.5): character {
  return makeCharacter({
    ttsMode: 'gptsovits',
    gptSoVitsConfig: {
      url: 'https://gptsovits.example.test',
      use_auto_path: false,
      ref_audio_path: '/voice',
      use_long_audio: false,
      ref_audio_data: {
        fileName: 'ref.wav',
        assetId: 'asset-ref',
      },
      volume,
      text_lang: 'en',
      use_prompt: false,
      prompt: null,
      prompt_lang: 'en',
      top_p: 1,
      temperature: 1,
      speed: 1,
      top_k: 5,
      text_split_method: 'cut0',
    },
  })
}

function makeFishSpeechCharacter(): character {
  return makeCharacter({
    ttsMode: 'fishspeech',
    fishSpeechConfig: {
      chunk_length: 200,
      model: {
        _id: 'fish-voice',
        title: 'Fish Voice',
        description: 'Fish speech voice fixture',
      },
      normalize: true,
    },
  })
}

async function importTTS() {
  return import('./tts')
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  StubAudioContext.instances.length = 0
  testState.db = {
    elevenLabKey: 'eleven-key',
    huggingfaceKey: 'hf-key',
  }
  testState.currentCharacter = null
  testState.loadAsset.mockResolvedValue(new Uint8Array([9, 8, 7]))
  testState.runTranslator.mockResolvedValue('translated text')
  testState.translateVox.mockResolvedValue('translated vox')
  testState.globalFetch.mockReset()
  testState.sleep.mockResolvedValue(undefined)
  vi.stubGlobal('AudioContext', StubAudioContext)
  vi.stubGlobal('speechSynthesis', {
    cancel: vi.fn(),
    getVoices: vi.fn(() => []),
    speak: vi.fn(),
  })
  vi.stubGlobal('SpeechSynthesisUtterance', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TTS provider catalog request caching', () => {
  it('dedupes ElevenLabs catalogs by API key and retries failed requests', async () => {
    const pending = deferred<Response>()
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(jsonResponse({ voices: [{ voice_id: 'voice-b', name: 'Voice B' }] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'temporary' }, 503))
      .mockResolvedValueOnce(jsonResponse({ voices: [{ voice_id: 'voice-c', name: 'Voice C' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const { getElevenTTSVoices } = await importTTS()

    const first = getElevenTTSVoices()
    const concurrent = getElevenTTSVoices()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    pending.resolve(jsonResponse({ voices: [{ voice_id: 'voice-a', name: 'Voice A' }] }))

    await expect(Promise.all([first, concurrent])).resolves.toEqual([
      [{ voice_id: 'voice-a', name: 'Voice A' }],
      [{ voice_id: 'voice-a', name: 'Voice A' }],
    ])
    await expect(getElevenTTSVoices()).resolves.toEqual([{ voice_id: 'voice-a', name: 'Voice A' }])
    expect(fetchMock).toHaveBeenCalledTimes(1)

    testState.db.elevenLabKey = 'eleven-key-b'
    await expect(getElevenTTSVoices()).resolves.toEqual([{ voice_id: 'voice-b', name: 'Voice B' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': 'eleven-key-b' },
    })

    testState.db.elevenLabKey = 'eleven-key-retry'
    await expect(getElevenTTSVoices()).rejects.toThrow('ElevenLabs catalog request failed (503)')
    await expect(getElevenTTSVoices()).resolves.toEqual([{ voice_id: 'voice-c', name: 'Voice C' }])
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('dedupes VOICEVOX catalogs by normalized URL and retries malformed responses', async () => {
    testState.db.voicevoxUrl = 'https://voicevox-a.example.test///'
    const pending = deferred<Response>()
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(jsonResponse([{ name: 'Speaker B', styles: [{ name: 'Normal', id: '2' }] }]))
      .mockResolvedValueOnce(jsonResponse({ speakers: [] }))
      .mockResolvedValueOnce(jsonResponse([{ name: 'Speaker C', styles: [{ name: 'Normal', id: 3 }] }]))
    vi.stubGlobal('fetch', fetchMock)
    const { getVOICEVOXVoices } = await importTTS()

    const first = getVOICEVOXVoices()
    const concurrent = getVOICEVOXVoices()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    pending.resolve(jsonResponse([{ name: 'Speaker A', styles: [{ name: 'Normal', id: 1 }] }]))

    const expectedFirst = [
      { name: 'None', list: null },
      { name: 'Speaker A', list: JSON.stringify([{ name: 'Normal', id: '1' }]) },
    ]
    await expect(Promise.all([first, concurrent])).resolves.toEqual([expectedFirst, expectedFirst])
    testState.db.voicevoxUrl = 'https://voicevox-a.example.test'
    await expect(getVOICEVOXVoices()).resolves.toEqual(expectedFirst)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://voicevox-a.example.test/speakers')

    testState.db.voicevoxUrl = 'https://voicevox-b.example.test/'
    await expect(getVOICEVOXVoices()).resolves.toEqual([
      { name: 'None', list: null },
      { name: 'Speaker B', list: JSON.stringify([{ name: 'Normal', id: '2' }]) },
    ])
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://voicevox-b.example.test/speakers')

    testState.db.voicevoxUrl = 'https://voicevox-retry.example.test'
    await expect(getVOICEVOXVoices()).rejects.toThrow('VOICEVOX speaker catalog response was malformed')
    await expect(getVOICEVOXVoices()).resolves.toEqual([
      { name: 'None', list: null },
      { name: 'Speaker C', list: JSON.stringify([{ name: 'Normal', id: '3' }]) },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('dedupes Fish Speech catalogs by API key and retries failed requests', async () => {
    testState.db.fishSpeechKey = 'fish-key-a'
    const pending = deferred<Response>()
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(jsonResponse({ items: [{ _id: 'fish-b', title: 'Fish B', description: 'Second' }] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'temporary' }, 502))
      .mockResolvedValueOnce(jsonResponse({ items: [{ _id: 'fish-c', title: 'Fish C', description: 'Retry' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const { getFishSpeechModels } = await importTTS()

    const first = getFishSpeechModels()
    const concurrent = getFishSpeechModels()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    pending.resolve(jsonResponse({ items: [{ _id: 'fish-a', title: 'Fish A', description: 'First' }] }))

    const expectedFirst = [{ _id: 'fish-a', title: 'Fish A', description: 'First' }]
    await expect(Promise.all([first, concurrent])).resolves.toEqual([expectedFirst, expectedFirst])
    await expect(getFishSpeechModels()).resolves.toEqual(expectedFirst)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    testState.db.fishSpeechKey = 'fish-key-b'
    await expect(getFishSpeechModels()).resolves.toEqual([{ _id: 'fish-b', title: 'Fish B', description: 'Second' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.fish.audio/model?self=true', {
      headers: { Authorization: 'Bearer fish-key-b' },
    })

    testState.db.fishSpeechKey = 'fish-key-retry'
    await expect(getFishSpeechModels()).rejects.toThrow('Fish Speech catalog request failed (502)')
    await expect(getFishSpeechModels()).resolves.toEqual([{ _id: 'fish-c', title: 'Fish C', description: 'Retry' }])
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})

describe('sayTTS AudioContext lifecycle', () => {
  it('M18: repeated network TTS playbacks reuse one AudioContext and release ended sources', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(audioResponse(new Uint8Array([1, 2, 3]), 'audio/mpeg'))
      .mockResolvedValueOnce(audioResponse(new Uint8Array([4, 5, 6]), 'audio/mpeg'))
    vi.stubGlobal('fetch', fetchMock)
    const { sayTTS } = await importTTS()

    await sayTTS(makeCharacter(), 'hello')
    expect(StubAudioContext.instances).toHaveLength(1)
    const context = StubAudioContext.instances[0]
    const firstSource = context.sources[0]

    firstSource.onended?.()
    expect(firstSource.disconnect).toHaveBeenCalledTimes(1)

    await sayTTS(makeCharacter(), 'again')
    expect(StubAudioContext.instances).toHaveLength(1)
    expect(context.sources).toHaveLength(2)
    expect(context.sources[1].start).toHaveBeenCalledTimes(1)
  })

  it('M18: gptsovits gain path reuses one AudioContext and releases its gain graph', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    testState.globalFetch
      .mockResolvedValueOnce({
        ok: true,
        data: {
          buffer: new Uint8Array([3, 2, 1]).buffer,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          buffer: new Uint8Array([6, 5, 4]).buffer,
        },
      })
    const { sayTTS } = await importTTS()

    try {
      await sayTTS(makeGptSoVitsCharacter(0.25), 'hello')
      await sayTTS(makeGptSoVitsCharacter(0.25), 'again')
    } finally {
      logSpy.mockRestore()
    }

    expect(StubAudioContext.instances).toHaveLength(1)
    const context = StubAudioContext.instances[0]
    expect(context.sources).toHaveLength(2)
    expect(context.gains).toHaveLength(2)
    expect(context.gains[0].gain.value).toBe(0.25)
    expect(context.sources[0].connect).toHaveBeenCalledWith(context.gains[0])
    expect(context.gains[0].connect).toHaveBeenCalledWith(context.destination)

    context.sources[0].onended?.()
    expect(context.sources[0].disconnect).toHaveBeenCalledTimes(1)
    expect(context.gains[0].disconnect).toHaveBeenCalledTimes(1)
  })

  it('L50/I16: GPT-SoVITS and FishSpeech do not console-log request or response bodies', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    testState.db.fishSpeechKey = 'fish-key'
    testState.globalFetch
      .mockResolvedValueOnce({
        ok: true,
        data: {
          buffer: new Uint8Array([3, 2, 1]).buffer,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          buffer: new Uint8Array([6, 5, 4]).buffer,
        },
      })
    const { sayTTS } = await importTTS()

    try {
      await sayTTS(makeGptSoVitsCharacter(1), 'hello')
      await sayTTS(makeFishSpeechCharacter(), 'again')
      expect(logSpy).not.toHaveBeenCalled()
    } finally {
      logSpy.mockRestore()
    }

    expect(testState.globalFetch).toHaveBeenCalledTimes(2)
    expect(StubAudioContext.instances).toHaveLength(1)
  })

  it('M18: stopTTS stops the active source and clears stale playback refs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse(new Uint8Array([1, 2, 3])))
    vi.stubGlobal('fetch', fetchMock)
    const { sayTTS, stopTTS } = await importTTS()

    await sayTTS(makeCharacter(), 'hello')
    const source = StubAudioContext.instances[0].sources[0]

    stopTTS()
    stopTTS()

    expect(source.stop).toHaveBeenCalledTimes(1)
    expect(source.disconnect).toHaveBeenCalledTimes(1)
    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(2)
  })
})

describe('sayTTS HuggingFace retry bounds', () => {
  it('L48: caps HuggingFace 503 retries and reports failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(hf503Response())
      .mockResolvedValueOnce(hf503Response())
      .mockResolvedValueOnce(hf503Response())
      .mockResolvedValueOnce(hf503Response())
      .mockResolvedValueOnce(hf503Response())
    vi.stubGlobal('fetch', fetchMock)
    const { sayTTS } = await importTTS()

    await sayTTS(
      makeCharacter({
        ttsMode: 'huggingface',
        hfTTS: {
          model: 'hf/model',
          language: 'en',
        },
      }),
      'hello',
    )

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(testState.sleep).toHaveBeenCalledTimes(4)
    expect(testState.alertError).toHaveBeenCalledWith(
      'HTTP: HuggingFace TTS model did not become ready after 5 attempts',
    )
    expect(StubAudioContext.instances).toHaveLength(0)
  })

  it('L48: translates non-English HuggingFace TTS text once across retries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(hf503Response())
      .mockResolvedValueOnce(hf503Response())
      .mockResolvedValueOnce(audioResponse(new Uint8Array([7, 8, 9]), 'audio/wav'))
    vi.stubGlobal('fetch', fetchMock)
    const { sayTTS } = await importTTS()

    await sayTTS(
      makeCharacter({
        ttsMode: 'huggingface',
        hfTTS: {
          model: 'hf/model',
          language: 'ko',
        },
      }),
      'original text',
    )

    expect(testState.runTranslator).toHaveBeenCalledTimes(1)
    expect(testState.runTranslator).toHaveBeenCalledWith('original text', false, 'en', 'ko')
    expect(testState.sleep).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.parse(String((init as RequestInit).body))).toEqual({
        inputs: 'translated text',
      })
    }
    expect(StubAudioContext.instances).toHaveLength(1)
  })
})
