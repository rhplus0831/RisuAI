import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/lib/Others/Help.svelte', async () => ({
  default: (await import('./GlobalRegex.testStub.svelte')).default,
}))
vi.mock('src/lib/SideBars/LoreBook/LoreBookSetting.svelte', async () => ({
  default: (await import('./GlobalRegex.testStub.svelte')).default,
}))

import GlobalLoreBookSettings from './GlobalLoreBookSettings.svelte'
import { language } from 'src/lang'
import { replaceResourceDatabase } from 'src/ts/server/resourceState.svelte'
import { lorebookPageOwner } from 'src/ts/server/lorebookPageOwner.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

beforeEach(() => {
  lorebookPageOwner.reset()
  replaceResourceDatabase({
    loreBook: [
      { id: 'global-a', name: 'Global A', data: [] },
      { id: 'global-b', name: 'Global B', data: [] },
    ],
  } as any)
  lorebookPageOwner.hydrate({
    revision: 1,
    setting: 'loreBookPage',
    state: { present: true, value: 1 },
  })
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) unmount(component)
  component = undefined
  lorebookPageOwner.reset()
  target.remove()
})

describe('GlobalLoreBookSettings collection owner', () => {
  it('renders the owner-selected global lorebook name', async () => {
    component = mount(GlobalLoreBookSettings, { target })
    await tick()

    expect(target.textContent).toContain('Global B')
  })

  it('fails closed when stable lorebook IDs are duplicated', async () => {
    replaceResourceDatabase({
      loreBook: [
        { id: 'duplicate', name: 'First', data: [] },
        { id: 'duplicate', name: 'Second', data: [] },
      ],
    } as any)
    component = mount(GlobalLoreBookSettings, { target })
    await tick()

    expect(target.textContent).toContain(language.loreBook)
    expect(target.textContent).not.toContain('First')
    expect(target.textContent).not.toContain('Second')
  })
})
