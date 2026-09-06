import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  decodeError: null as DOMException | null,
  env: {} as Record<string, unknown>,
  pipeline: vi.fn(),
}))

vi.mock('@huggingface/transformers', () => ({
  env: testState.env,
  pipeline: testState.pipeline,
}))

vi.mock('wavefile', () => ({
  WaveFile: class {
    fromScratch = vi.fn()
    toBuffer() {
      return new Uint8Array([1, 2, 3, 4])
    }
  },
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  loadAsset: vi.fn(),
  saveAssets: vi.fn(),
}))

vi.mock('src/ts/util', () => ({
  asBuffer: (data: ArrayBuffer | Uint8Array) =>
    data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data,
}))

vi.mock('src/ts/filePicker', () => ({ selectSingleFile: vi.fn() }))

interface StubSource {
  buffer: AudioBuffer | null
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  onended: (() => void) | null
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

class StubAudioContext {
  static instances: StubAudioContext[] = []

  destination = { kind: 'destination' }
  decoded: ArrayBuffer[] = []
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  sources: StubSource[] = []
  state: AudioContextState = 'running'

  constructor() {
    StubAudioContext.instances.push(this)
  }

  decodeAudioData(
    audioData: ArrayBuffer,
    successCallback?: DecodeSuccessCallback | null,
    errorCallback?: DecodeErrorCallback | null,
  ): Promise<AudioBuffer> {
    this.decoded.push(audioData)
    if (testState.decodeError) {
      errorCallback?.(testState.decodeError)
      return Promise.resolve(undefined as unknown as AudioBuffer)
    }
    const decoded = { kind: 'decoded-vits-audio' } as unknown as AudioBuffer
    successCallback?.(decoded)
    return Promise.resolve(decoded)
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = {
      buffer: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      onended: null,
      start: vi.fn(),
      stop: vi.fn(),
    } satisfies StubSource
    this.sources.push(source)
    return source as unknown as AudioBufferSourceNode
  }
}

function makeSynthesizer() {
  const synth = vi.fn(async () => ({
    audio: new Float32Array([0.1, 0.2]),
    sampling_rate: 22_050,
  }))
  return Object.assign(synth, {
    dispose: vi.fn(async () => {}),
  })
}

async function importTransformers() {
  return import('./transformers')
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  StubAudioContext.instances = []
  testState.decodeError = null
  testState.env.localModelPath = ''
  testState.pipeline.mockReset()
  vi.stubGlobal('AudioContext', StubAudioContext)
  vi.stubGlobal('caches', {
    open: vi.fn(async () => ({
      match: vi.fn(),
      put: vi.fn(),
    })),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runVITS lifecycle', () => {
  it('repeated VITS calls reuse one AudioContext and release ended sources', async () => {
    const synth = makeSynthesizer()
    testState.pipeline.mockResolvedValue(synth)
    const { runVITS } = await importTransformers()

    await runVITS('hello', 'model-a')
    await runVITS('again', 'model-a')

    expect(testState.pipeline).toHaveBeenCalledTimes(1)
    expect(StubAudioContext.instances).toHaveLength(1)
    const context = StubAudioContext.instances[0]
    expect(context.sources).toHaveLength(2)
    expect(context.sources[0].start).toHaveBeenCalledTimes(1)

    context.sources[0].onended?.()
    expect(context.sources[0].disconnect).toHaveBeenCalledTimes(1)
  })

  it('decodeAudioData errors reject through the callback path', async () => {
    const synth = makeSynthesizer()
    testState.pipeline.mockResolvedValue(synth)
    testState.decodeError = new DOMException('decode failed')
    const { runVITS } = await importTransformers()

    await expect(runVITS('hello', 'model-a')).rejects.toThrow('decode failed')
    expect(StubAudioContext.instances).toHaveLength(1)
    expect(StubAudioContext.instances[0].sources).toHaveLength(0)
  })

  it('switching VITS models disposes the old synthesizer before replacing it', async () => {
    const synthA = makeSynthesizer()
    const synthB = makeSynthesizer()
    testState.pipeline.mockResolvedValueOnce(synthA).mockResolvedValueOnce(synthB)
    const { runVITS } = await importTransformers()

    await runVITS('first', 'model-a')
    await runVITS('second', 'model-b')

    expect(synthA.dispose).toHaveBeenCalledTimes(1)
    expect(testState.pipeline).toHaveBeenCalledTimes(2)
    expect(synthA.dispose.mock.invocationCallOrder[0]).toBeLessThan(testState.pipeline.mock.invocationCallOrder[1])
  })

  it('does not start late VITS audio after its run is aborted', async () => {
    let resolveSynthesis!: (value: { audio: Float32Array; sampling_rate: number }) => void
    const synth = vi.fn(
      () =>
        new Promise<{ audio: Float32Array; sampling_rate: number }>((resolve) => {
          resolveSynthesis = resolve
        }),
    )
    testState.pipeline.mockResolvedValue(Object.assign(synth, { dispose: vi.fn() }))
    const { runVITS } = await importTransformers()
    const controller = new AbortController()

    const pending = runVITS('hello', 'model-a', { signal: controller.signal })
    await vi.waitFor(() => expect(synth).toHaveBeenCalledTimes(1))
    controller.abort()
    resolveSynthesis({ audio: new Float32Array([0.1]), sampling_rate: 22_050 })

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(StubAudioContext.instances).toHaveLength(0)
  })

  it('stops and disconnects active VITS playback when its run is aborted', async () => {
    testState.pipeline.mockResolvedValue(makeSynthesizer())
    const { runVITS } = await importTransformers()
    const controller = new AbortController()

    await runVITS('hello', 'model-a', { signal: controller.signal })
    const source = StubAudioContext.instances[0].sources[0]
    controller.abort()

    expect(source.stop).toHaveBeenCalledTimes(1)
    expect(source.disconnect).toHaveBeenCalledTimes(1)
  })
})
