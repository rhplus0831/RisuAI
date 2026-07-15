import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const titleMocks = vi.hoisted(() => ({
  openURL: vi.fn(),
}))

vi.mock('src/ts/server/resourceState.svelte', () => ({
  getResourceDatabase: () => ({ language: 'en' }),
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  openURL: titleMocks.openURL,
}))

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers()
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
})
