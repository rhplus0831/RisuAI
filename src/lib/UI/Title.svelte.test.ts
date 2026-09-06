import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const titleMocks = vi.hoisted(() => ({
  openURL: vi.fn(),
  settingsResourceState: {
    value: { language: 'en' },
    status: 'ready' as 'idle' | 'loading' | 'ready' | 'error',
    shellRevision: 1 as number | null,
    groupStatuses: {} as Record<string, 'idle' | 'loading' | 'ready' | 'error'>,
  },
}))

vi.mock('src/ts/server/resourceState.svelte', () => ({
  settingsResourceState: titleMocks.settingsResourceState,
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  openURL: titleMocks.openURL,
}))

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers()
  titleMocks.settingsResourceState.value.language = 'en'
  titleMocks.settingsResourceState.status = 'ready'
  titleMocks.settingsResourceState.shellRevision = 1
  titleMocks.settingsResourceState.groupStatuses = {}
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  titleMocks.openURL.mockReset()
  vi.useRealTimers()
})

describe('Title seasonal controls', () => {
  it('uses the resident shell language owner during a group refresh', async () => {
    vi.setSystemTime(new Date(2026, 8, 16, 12))
    titleMocks.settingsResourceState.value.language = 'zh-Hant'
    titleMocks.settingsResourceState.groupStatuses.language = 'loading'
    const { default: Title } = await import('./Title.svelte')
    component = mount(Title, { target })
    await tick()

    expect(target.querySelector('h2')?.textContent).toContain('🐉Risuai🐉')
  })

  it('fails closed for an errored language owner', async () => {
    vi.setSystemTime(new Date(2026, 8, 16, 12))
    titleMocks.settingsResourceState.value.language = 'ko'
    titleMocks.settingsResourceState.groupStatuses.language = 'error'
    const { default: Title } = await import('./Title.svelte')
    component = mount(Title, { target })
    await tick()

    expect(target.querySelector('h2')?.textContent?.trim()).toBe('Risuai')
  })

  it('fails closed when the language owner is missing', async () => {
    vi.setSystemTime(new Date(2026, 8, 16, 12))
    titleMocks.settingsResourceState.value.language = 'ko'
    titleMocks.settingsResourceState.status = 'idle'
    titleMocks.settingsResourceState.shellRevision = null
    titleMocks.settingsResourceState.groupStatuses.language = 'idle'
    const { default: Title } = await import('./Title.svelte')
    component = mount(Title, { target })
    await tick()

    expect(target.querySelector('h2')?.textContent?.trim()).toBe('Risuai')
  })

  it('makes the anniversary link a native keyboard action', async () => {
    vi.setSystemTime(new Date(2026, 3, 13, 12))
    const { default: Title } = await import('./Title.svelte')
    component = mount(Title, { target })
    await tick()

    const anniversary = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('Anniversary'),
    )
    expect(anniversary).toBeTruthy()
    expect(anniversary!.tabIndex).toBe(0)

    anniversary!.click()
    expect(titleMocks.openURL).toHaveBeenCalledWith('https://risuai.net')
  })

  it('uses a native button for the Christmas game target', async () => {
    vi.setSystemTime(new Date(2026, 11, 20, 12))
    const { default: Title } = await import('./Title.svelte')
    component = mount(Title, { target })
    await tick()

    const santa = target.querySelector<HTMLImageElement>('button img[alt="santa"]')
    expect(santa?.closest('button')).toBeTruthy()
  })

  it('cleans up an active Christmas game timer when unmounted', async () => {
    vi.setSystemTime(new Date(2026, 11, 20, 12))
    const { default: Title } = await import('./Title.svelte')
    component = mount(Title, { target })
    await tick()

    const santa = target.querySelector<HTMLButtonElement>('button:has(img[alt="santa"])')
    expect(santa).toBeTruthy()
    for (let click = 0; click < 5; click++) {
      santa!.click()
    }
    await tick()

    const game = target.querySelector<HTMLButtonElement>('#minigame-div button')
    expect(game).toBeTruthy()
    game!.click()
    await tick()
    expect(vi.getTimerCount()).toBe(1)

    vi.advanceTimersByTime(700)
    await tick()
    expect(target.querySelector('#minigame-div')?.textContent).toContain('Time: 19')

    unmount(component)
    component = undefined

    expect(vi.getTimerCount()).toBe(0)
  })
})
