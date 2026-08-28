import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./globalApi.svelte', () => ({
  globalFetch: vi.fn(),
}))

import {
  _getBgmElementForTesting,
  _resetDomObserverForTesting,
  resetBgmObserverForChatSwitch,
  startObserveDom,
  stopObserveDom,
} from './observer.svelte'

async function flushMutationObserver() {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function countListenerAdds(spy: ReturnType<typeof vi.spyOn>, eventName: string) {
  return spy.mock.calls.filter(([name]) => name === eventName).length
}

beforeEach(() => {
  _resetDomObserverForTesting()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

afterEach(() => {
  _resetDomObserverForTesting()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('startObserveDom', () => {
  it('stops observing new nodes until the optional runtime is restarted', async () => {
    startObserveDom()
    stopObserveDom()

    const stoppedCodeBlock = document.createElement('pre')
    stoppedCodeBlock.setAttribute('x-hl-lang', 'js')
    const stoppedListener = vi.spyOn(stoppedCodeBlock, 'addEventListener')
    document.body.appendChild(stoppedCodeBlock)
    await flushMutationObserver()
    expect(countListenerAdds(stoppedListener, 'contextmenu')).toBe(0)

    startObserveDom()
    const restartedCodeBlock = document.createElement('pre')
    restartedCodeBlock.setAttribute('x-hl-lang', 'ts')
    const restartedListener = vi.spyOn(restartedCodeBlock, 'addEventListener')
    document.body.appendChild(restartedCodeBlock)
    await flushMutationObserver()
    expect(countListenerAdds(restartedListener, 'contextmenu')).toBe(1)
  })

  it('repeated observer starts bind one contextmenu listener per code block', () => {
    const codeBlock = document.createElement('pre')
    codeBlock.setAttribute('x-hl-lang', 'js')
    codeBlock.textContent = 'console.log("once")'
    const addListener = vi.spyOn(codeBlock, 'addEventListener')

    document.body.appendChild(codeBlock)

    startObserveDom()
    startObserveDom()
    startObserveDom()

    expect(countListenerAdds(addListener, 'contextmenu')).toBe(1)
  })

  it('processes nested code blocks inserted through mutations without a polling tick', async () => {
    startObserveDom()

    const wrapper = document.createElement('section')
    const codeBlock = document.createElement('pre')
    codeBlock.setAttribute('x-hl-lang', 'ts')
    codeBlock.textContent = 'const inserted = true'
    const addListener = vi.spyOn(codeBlock, 'addEventListener')
    wrapper.appendChild(document.createElement('div')).appendChild(codeBlock)

    document.body.appendChild(wrapper)
    await flushMutationObserver()

    expect(countListenerAdds(addListener, 'contextmenu')).toBe(1)

    startObserveDom()

    expect(countListenerAdds(addListener, 'contextmenu')).toBe(1)
  })

  it('processes nodes that gain matching attributes after insertion once', async () => {
    startObserveDom()

    const codeBlock = document.createElement('pre')
    codeBlock.textContent = 'late language'
    const addListener = vi.spyOn(codeBlock, 'addEventListener')
    document.body.appendChild(codeBlock)
    await flushMutationObserver()

    codeBlock.setAttribute('x-hl-lang', 'txt')
    await flushMutationObserver()
    codeBlock.setAttribute('x-hl-lang', 'md')
    await flushMutationObserver()

    expect(countListenerAdds(addListener, 'contextmenu')).toBe(1)
  })

  it('keeps code-block context menu copy and download behavior', async () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    const createObjectURL = vi.fn(() => 'blob:code-download')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    const staleMenu = document.createElement('div')
    staleMenu.id = 'code-contextmenu'
    document.body.appendChild(staleMenu)

    const codeBlock = document.createElement('pre')
    codeBlock.setAttribute('x-hl-lang', 'py')
    codeBlock.textContent = 'print("hello")'
    document.body.appendChild(codeBlock)
    startObserveDom()

    const firstContextMenu = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 31,
      clientY: 42,
    })
    const defaultAllowed = codeBlock.dispatchEvent(firstContextMenu)

    expect(defaultAllowed).toBe(false)
    expect(staleMenu.isConnected).toBe(false)

    const menu = document.getElementById('code-contextmenu')
    expect(menu).not.toBeNull()
    expect(menu?.style.left).toBe('31px')
    expect(menu?.style.top).toBe('42px')

    const [copyOption, downloadOption] = Array.from(menu?.children ?? []) as HTMLElement[]
    expect(copyOption.textContent).toBe('Copy')
    expect(downloadOption.textContent).toBe('Download')
    expect(copyOption).toBeInstanceOf(HTMLButtonElement)
    expect(downloadOption).toBeInstanceOf(HTMLButtonElement)
    expect(document.activeElement).toBe(copyOption)

    copyOption.click()

    expect(writeText).toHaveBeenCalledWith('print("hello")')
    expect(document.getElementById('code-contextmenu')).toBeNull()

    codeBlock.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
      }),
    )

    const nextMenu = document.getElementById('code-contextmenu')
    const nextDownloadOption = Array.from(nextMenu?.children ?? [])[1] as HTMLElement
    nextDownloadOption.click()

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:code-download'))
    expect(anchorClick).toHaveBeenCalledTimes(1)
    expect(document.getElementById('code-contextmenu')).toBeNull()
  })

  it('processes each BGM control node once even after repeated scans', () => {
    let endedListener: (() => void) | null = null
    const play = vi.fn()
    const pause = vi.fn()
    const remove = vi.fn()
    const audioInstances: Array<{ src: string; volume: number }> = []
    const AudioMock = vi.fn(function (
      this: {
        src: string
        volume: number
        addEventListener: (name: string, listener: EventListener) => void
        play: () => void
        pause: () => void
        remove: () => void
      },
      src: string,
    ) {
      this.src = src
      this.volume = 0
      this.addEventListener = (name, listener) => {
        if (name === 'ended') {
          endedListener = listener as () => void
        }
      }
      this.play = play
      this.pause = pause
      this.remove = remove
      audioInstances.push(this)
    })
    vi.stubGlobal('Audio', AudioMock)

    const ctrl = document.createElement('div')
    ctrl.setAttribute('risu-ctrl', 'bgm___auto___/bgm.mp3')
    document.body.appendChild(ctrl)

    startObserveDom()
    startObserveDom()

    expect(AudioMock).toHaveBeenCalledTimes(1)
    expect(audioInstances[0]).toMatchObject({ src: '/bgm.mp3', volume: 0.5 })
    expect(play).toHaveBeenCalledTimes(1)

    endedListener?.()
    startObserveDom()

    expect(remove).toHaveBeenCalledTimes(1)
    expect(AudioMock).toHaveBeenCalledTimes(1)
  })

  it('retries rejected BGM playback on the next user interaction without another scan', async () => {
    const play = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('Autoplay blocked', 'NotAllowedError'))
      .mockResolvedValueOnce(undefined)
    const pause = vi.fn()
    const remove = vi.fn()
    const audioInstances: Array<{ src: string; volume: number }> = []
    const AudioMock = vi.fn(function (
      this: {
        src: string
        volume: number
        addEventListener: (name: string, listener: EventListener) => void
        play: () => Promise<void>
        pause: () => void
        remove: () => void
      },
      src: string,
    ) {
      this.src = src
      this.volume = 0
      this.addEventListener = () => {}
      this.play = play
      this.pause = pause
      this.remove = remove
      audioInstances.push(this)
    })
    vi.stubGlobal('Audio', AudioMock)

    const ctrl = document.createElement('div')
    ctrl.setAttribute('risu-ctrl', 'bgm___auto___/blocked-bgm.mp3')
    document.body.appendChild(ctrl)

    startObserveDom()
    await Promise.resolve()

    expect(_getBgmElementForTesting()).toBeNull()
    expect(pause).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledTimes(1)

    document.dispatchEvent(new Event('pointerdown', { bubbles: true }))

    expect(AudioMock).toHaveBeenCalledTimes(2)
    expect(audioInstances[1]).toMatchObject({ src: '/blocked-bgm.mp3', volume: 0.5 })
    expect(_getBgmElementForTesting()).toBe(audioInstances[1])

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(AudioMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry rejected BGM playback after its control is removed', async () => {
    const play = vi.fn().mockRejectedValueOnce(new DOMException('Autoplay blocked', 'NotAllowedError'))
    const AudioMock = vi.fn(function (this: {
      volume: number
      addEventListener: () => void
      play: () => Promise<void>
      pause: () => void
      remove: () => void
    }) {
      this.volume = 0
      this.addEventListener = () => {}
      this.play = play
      this.pause = vi.fn()
      this.remove = vi.fn()
    })
    vi.stubGlobal('Audio', AudioMock)

    const ctrl = document.createElement('div')
    ctrl.setAttribute('risu-ctrl', 'bgm___auto___/removed-bgm.mp3')
    document.body.appendChild(ctrl)

    startObserveDom()
    await Promise.resolve()
    ctrl.remove()
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }))

    expect(AudioMock).toHaveBeenCalledTimes(1)
    expect(_getBgmElementForTesting()).toBeNull()
  })

  it('stops active BGM when the optional DOM runtime is torn down', () => {
    const play = vi.fn()
    const pause = vi.fn()
    const remove = vi.fn()
    const AudioMock = vi.fn(function (this: {
      volume: number
      addEventListener: () => void
      play: () => void
      pause: () => void
      remove: () => void
    }) {
      this.volume = 0
      this.addEventListener = () => {}
      this.play = play
      this.pause = pause
      this.remove = remove
    })
    vi.stubGlobal('Audio', AudioMock)

    const ctrl = document.createElement('div')
    ctrl.setAttribute('risu-ctrl', 'bgm___auto___/teardown-bgm.mp3')
    document.body.appendChild(ctrl)
    startObserveDom()

    stopObserveDom()

    expect(pause).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
    expect(_getBgmElementForTesting()).toBeNull()
  })

  it('cancels a pending autoplay retry when the optional DOM runtime is torn down', async () => {
    const play = vi.fn().mockRejectedValueOnce(new DOMException('Autoplay blocked', 'NotAllowedError'))
    const AudioMock = vi.fn(function (this: {
      volume: number
      addEventListener: () => void
      play: () => Promise<void>
      pause: () => void
      remove: () => void
    }) {
      this.volume = 0
      this.addEventListener = () => {}
      this.play = play
      this.pause = vi.fn()
      this.remove = vi.fn()
    })
    vi.stubGlobal('Audio', AudioMock)

    const ctrl = document.createElement('div')
    ctrl.setAttribute('risu-ctrl', 'bgm___auto___/blocked-teardown-bgm.mp3')
    document.body.appendChild(ctrl)
    startObserveDom()
    await Promise.resolve()

    stopObserveDom()
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }))

    expect(AudioMock).toHaveBeenCalledOnce()
    expect(_getBgmElementForTesting()).toBeNull()
  })

  it('chat switch cleanup pauses current BGM and lets the next control attach', async () => {
    const play = vi.fn()
    const pause = vi.fn()
    const remove = vi.fn()
    const audioInstances: Array<{ src: string; volume: number }> = []
    const AudioMock = vi.fn(function (
      this: {
        src: string
        volume: number
        addEventListener: (name: string, listener: EventListener) => void
        play: () => void
        pause: () => void
        remove: () => void
      },
      src: string,
    ) {
      this.src = src
      this.volume = 0
      this.addEventListener = () => {}
      this.play = play
      this.pause = pause
      this.remove = remove
      audioInstances.push(this)
    })
    vi.stubGlobal('Audio', AudioMock)

    const firstCtrl = document.createElement('div')
    firstCtrl.setAttribute('risu-ctrl', 'bgm___0.25___/old-bgm.mp3')
    document.body.appendChild(firstCtrl)

    startObserveDom()

    expect(AudioMock).toHaveBeenCalledTimes(1)
    expect(audioInstances[0]).toMatchObject({ src: '/old-bgm.mp3', volume: 0.25 })
    expect(_getBgmElementForTesting()).toBe(audioInstances[0])

    resetBgmObserverForChatSwitch()

    expect(pause).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(_getBgmElementForTesting()).toBeNull()

    document.body.textContent = ''
    const nextCtrl = document.createElement('div')
    nextCtrl.setAttribute('risu-ctrl', 'bgm___auto___/new-bgm.mp3')
    document.body.appendChild(nextCtrl)
    await flushMutationObserver()

    expect(AudioMock).toHaveBeenCalledTimes(2)
    expect(audioInstances[1]).toMatchObject({ src: '/new-bgm.mp3', volume: 0.5 })
    expect(play).toHaveBeenCalledTimes(2)
    expect(_getBgmElementForTesting()).toBe(audioInstances[1])
  })
})
