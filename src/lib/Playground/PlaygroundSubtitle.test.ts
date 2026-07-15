import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeAudioFileWithTemporaryContext, probeVideoDuration, stereoAudioChannels } from './subtitleMedia'

class StubAudioContext {
  static instances: StubAudioContext[] = []
  static rejectDecode = false

  close = vi.fn(async () => {})
  decodeAudioData = vi.fn(async (_audio: ArrayBuffer) => {
    if (StubAudioContext.rejectDecode) {
      throw new Error('decode failed')
    }
    return { kind: 'decoded' } as unknown as AudioBuffer
  })

  constructor() {
    StubAudioContext.instances.push(this)
  }
}

beforeEach(() => {
  StubAudioContext.instances = []
  StubAudioContext.rejectDecode = false
  vi.stubGlobal('AudioContext', StubAudioContext)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Playground subtitle media cleanup', () => {
  it('duplicates mono input for stereo MP3 encoding instead of reading a missing channel', () => {
    const mono = new Float32Array([0.25, -0.25])
    const getChannelData = vi.fn(() => mono)

    expect(stereoAudioChannels({ numberOfChannels: 1, getChannelData } as any)).toEqual([mono, mono])
    expect(getChannelData).toHaveBeenCalledOnce()
  })

  it('L55: probeVideoDuration revokes the probe object URL after metadata probing', async () => {
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:subtitle-probe')
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const video = {
      duration: 42,
      muted: false,
      pause: vi.fn(),
      play: vi.fn(async () => {}),
      preload: '',
      remove: vi.fn(),
      src: '',
    }
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'video') return video as unknown as HTMLVideoElement
      return originalCreateElement(tag)
    })

    await expect(probeVideoDuration(new Blob(['video']))).resolves.toBe(42)

    expect(video.play).toHaveBeenCalledTimes(1)
    expect(video.pause).toHaveBeenCalledTimes(1)
    expect(video.remove).toHaveBeenCalledTimes(1)
    expect(createUrl).toHaveBeenCalledTimes(1)
    expect(revokeUrl).toHaveBeenCalledWith('blob:subtitle-probe')
  })

  it('L55: temporary whisper AudioContexts close after decode success and failure', async () => {
    await expect(decodeAudioFileWithTemporaryContext(new Blob(['audio']))).resolves.toEqual({
      kind: 'decoded',
    })
    expect(StubAudioContext.instances).toHaveLength(1)
    expect(StubAudioContext.instances[0].close).toHaveBeenCalledTimes(1)

    StubAudioContext.rejectDecode = true
    await expect(decodeAudioFileWithTemporaryContext(new Blob(['bad-audio']))).rejects.toThrow('decode failed')
    expect(StubAudioContext.instances).toHaveLength(2)
    expect(StubAudioContext.instances[1].close).toHaveBeenCalledTimes(1)
  })
})
