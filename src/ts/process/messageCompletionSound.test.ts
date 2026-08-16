import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const resourceDatabase = vi.hoisted(() => ({ playMessage: false }))

vi.mock('../server/resourceState.svelte', () => ({
  getResourceDatabase: () => resourceDatabase,
}))

vi.mock('../../etc/send.mp3', () => ({ default: 'send.mp3' }))

interface AudioHarness {
  AudioMock: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  dispatchEnded: () => void
  pause: ReturnType<typeof vi.fn>
  play: ReturnType<typeof vi.fn>
}

function stubAudio(playImplementation: () => Promise<void> = () => Promise.resolve()): AudioHarness {
  let endedListener: EventListenerOrEventListenerObject | undefined
  const play = vi.fn(playImplementation)
  const pause = vi.fn()
  const addEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
    if (type === 'ended') endedListener = listener
  })
  const AudioMock = vi.fn(function (
    this: {
      addEventListener: typeof addEventListener
      currentTime: number
      pause: typeof pause
      play: typeof play
      preload: string
      src: string
    },
    src?: string,
  ) {
    this.src = src ?? ''
    this.preload = ''
    this.currentTime = 7
    this.play = play
    this.pause = pause
    this.addEventListener = addEventListener
  })
  vi.stubGlobal('Audio', AudioMock)

  return {
    AudioMock,
    addEventListener,
    dispatchEnded: () => {
      const event = new Event('ended')
      if (typeof endedListener === 'function') {
        endedListener.call(AudioMock.mock.instances[0], event)
      } else {
        endedListener?.handleEvent(event)
      }
    },
    pause,
    play,
  }
}

async function loadCompletionSoundModule() {
  vi.resetModules()
  return await import('./messageCompletionSound')
}

beforeEach(() => {
  resourceDatabase.playMessage = false
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('completion sound', () => {
  it('lazily creates and reuses one preloaded audio element for enabled completion sounds', async () => {
    const { AudioMock, addEventListener, play } = stubAudio()
    const { playMessageCompletionSoundIfEnabled } = await loadCompletionSoundModule()
    resourceDatabase.playMessage = true

    expect(AudioMock).not.toHaveBeenCalled()
    expect(playMessageCompletionSoundIfEnabled()).toBe(true)
    expect(playMessageCompletionSoundIfEnabled()).toBe(true)

    expect(AudioMock).toHaveBeenCalledOnce()
    expect(AudioMock).toHaveBeenCalledWith('send.mp3')
    expect(AudioMock.mock.instances[0]).toMatchObject({ currentTime: 0, preload: 'auto', src: 'send.mp3' })
    expect(addEventListener).toHaveBeenCalledWith('ended', expect.any(Function))
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('primes synchronously and reuses the primed element for a real ding', async () => {
    const { AudioMock, pause, play } = stubAudio()
    const { playCompletionDing, primeCompletionSound } = await loadCompletionSoundModule()

    primeCompletionSound()

    expect(AudioMock).toHaveBeenCalledOnce()
    expect(play).toHaveBeenCalledOnce()
    expect(pause).toHaveBeenCalledOnce()
    expect(play.mock.invocationCallOrder[0]).toBeLessThan(pause.mock.invocationCallOrder[0])
    expect(AudioMock.mock.instances[0]).toMatchObject({ currentTime: 0 })

    playCompletionDing()

    expect(AudioMock).toHaveBeenCalledOnce()
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('skips priming while a real ding is in flight and resumes after it ends', async () => {
    const { dispatchEnded, pause, play } = stubAudio()
    const { playCompletionDing, primeCompletionSound } = await loadCompletionSoundModule()

    playCompletionDing()
    primeCompletionSound()

    expect(play).toHaveBeenCalledOnce()
    expect(pause).not.toHaveBeenCalled()

    dispatchEnded()
    primeCompletionSound()

    expect(play).toHaveBeenCalledTimes(2)
    expect(pause).toHaveBeenCalledOnce()
  })

  it('warns once for NotAllowedError, warns for other failures, and clears the in-flight guard', async () => {
    const notAllowedError = Object.assign(new Error('gesture required'), { name: 'NotAllowedError' })
    const { pause, play } = stubAudio(() => Promise.reject(notAllowedError))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { playCompletionDing, primeCompletionSound } = await loadCompletionSoundModule()

    playCompletionDing()
    playCompletionDing()
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1))
    expect(warn).toHaveBeenCalledWith('Completion ding playback failed (NotAllowedError): gesture required')

    primeCompletionSound()
    expect(pause).toHaveBeenCalledOnce()

    play.mockRejectedValue(new TypeError('decode failed'))
    playCompletionDing()
    playCompletionDing()
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(3))
    expect(warn).toHaveBeenNthCalledWith(2, 'Completion ding playback failed (TypeError): decode failed')
    expect(warn).toHaveBeenNthCalledWith(3, 'Completion ding playback failed (TypeError): decode failed')
  })

  it('installs the gesture priming listeners only once', async () => {
    const addEventListener = vi.fn()
    vi.stubGlobal('document', { addEventListener })
    const { installCompletionSoundPriming, primeCompletionSound } = await loadCompletionSoundModule()

    installCompletionSoundPriming()
    installCompletionSoundPriming()

    expect(addEventListener).toHaveBeenCalledTimes(2)
    expect(addEventListener).toHaveBeenNthCalledWith(1, 'pointerdown', primeCompletionSound, {
      capture: true,
      passive: true,
    })
    expect(addEventListener).toHaveBeenNthCalledWith(2, 'keydown', primeCompletionSound, {
      capture: true,
      passive: true,
    })
  })

  it('does not construct or play audio when message completion sound is disabled', async () => {
    const { AudioMock, play } = stubAudio()
    const { playMessageCompletionSoundIfEnabled } = await loadCompletionSoundModule()

    expect(playMessageCompletionSoundIfEnabled()).toBe(false)
    expect(AudioMock).not.toHaveBeenCalled()
    expect(play).not.toHaveBeenCalled()
  })
})
