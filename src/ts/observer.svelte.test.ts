import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./globalApi.svelte', () => ({
  globalFetch: vi.fn(),
}))

import { _resetDomObserverForTesting, startObserveDom } from './observer.svelte'

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
  it('M14: repeated observer starts bind one contextmenu listener per code block', () => {
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

  it('M14: processes nested code blocks inserted through mutations without a polling tick', async () => {
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

  it('M14: processes nodes that gain matching attributes after insertion once', async () => {
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

  it('keeps code-block context menu copy and download behavior', () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    const createObjectURL = vi.fn(() => 'blob:code-download')
    vi.stubGlobal('URL', { createObjectURL })
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

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
    expect(anchorClick).toHaveBeenCalledTimes(1)
    expect(document.getElementById('code-contextmenu')).toBeNull()
  })

  it('M14: processes each BGM control node once even after repeated scans', () => {
    let endedListener: (() => void) | null = null
    const play = vi.fn()
    const remove = vi.fn()
    const audioInstances: Array<{ src: string; volume: number }> = []
    const AudioMock = vi.fn(function (
      this: {
        src: string
        volume: number
        addEventListener: (name: string, listener: EventListener) => void
        play: () => void
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
})
