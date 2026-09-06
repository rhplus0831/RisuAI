import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hydrationApi = vi.hoisted(() => ({
  rows: {} as Record<string, { status: string; error: string | null }>,
  retry: vi.fn(async () => true),
}))

vi.mock('src/ts/server/characterShellHydration.svelte', () => ({
  characterShellHydrationState: { rows: hydrationApi.rows },
  retryCharacterShellHydration: hydrationApi.retry,
}))

import { language } from 'src/lang'
import CharacterShellHydrationGate from './CharacterShellHydrationGate.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLDivElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  for (const key of Object.keys(hydrationApi.rows)) delete hydrationApi.rows[key]
  hydrationApi.retry.mockClear()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('CharacterShellHydrationGate', () => {
  it('renders localized loading state while selected detail is pending', async () => {
    hydrationApi.rows['char-a'] = { status: 'loading', error: null }
    component = mount(CharacterShellHydrationGate, { target, props: { characterId: 'char-a' } })
    await tick()

    const status = target.querySelector('[role="status"]')
    expect(status?.textContent).toContain(language.loadingCharacter)
    expect(status?.getAttribute('aria-busy')).toBe('true')
  })

  it('renders a localized failure and retries the exact character', async () => {
    hydrationApi.rows['char-a'] = { status: 'error', error: 'timeout' }
    component = mount(CharacterShellHydrationGate, { target, props: { characterId: 'char-a' } })
    await tick()

    expect(target.querySelector('[role="alert"]')?.textContent).toContain(language.characterDataLoadFailed)
    const retry = target.querySelector<HTMLButtonElement>('[data-testid="character-hydration-retry"]')
    expect(retry).toBeTruthy()
    retry!.click()
    expect(hydrationApi.retry).toHaveBeenCalledWith('char-a')
  })
})
