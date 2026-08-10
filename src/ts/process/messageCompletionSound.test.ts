import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getResourceDatabase } from '../server/resourceState.svelte'
import { playMessageCompletionSoundIfEnabled } from './messageCompletionSound'

let previousPlayMessage = false

beforeEach(() => {
  previousPlayMessage = getResourceDatabase().playMessage
})

afterEach(() => {
  getResourceDatabase().playMessage = previousPlayMessage
  vi.unstubAllGlobals()
})

describe('playMessageCompletionSoundIfEnabled', () => {
  it('plays one completion sound when the setting is enabled', () => {
    const play = vi.fn().mockResolvedValue(undefined)
    const AudioMock = vi.fn(function (this: { play: typeof play }) {
      this.play = play
    })
    vi.stubGlobal('Audio', AudioMock)
    getResourceDatabase().playMessage = true

    playMessageCompletionSoundIfEnabled()

    expect(AudioMock).toHaveBeenCalledOnce()
    expect(play).toHaveBeenCalledOnce()
  })

  it('does not construct audio when the setting is disabled', () => {
    const AudioMock = vi.fn()
    vi.stubGlobal('Audio', AudioMock)
    getResourceDatabase().playMessage = false

    playMessageCompletionSoundIfEnabled()

    expect(AudioMock).not.toHaveBeenCalled()
  })
})
