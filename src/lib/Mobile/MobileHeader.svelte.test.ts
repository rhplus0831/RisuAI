import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mobileHeaderMocks = vi.hoisted(() => ({
  charactersResourceState: {
    characters: [
      {
        chaId: 'character-a',
        displayName: 'Canonical Character',
        name: 'Legacy Character',
      },
    ],
  },
}))

vi.mock('src/ts/server/resourceState.svelte', () => ({
  charactersResourceState: mobileHeaderMocks.charactersResourceState,
}))

vi.mock('@lucide/svelte', async () => {
  const icon = (await import('./MobileControls.testStub.svelte')).default
  return { ArrowLeft: icon, MenuIcon: icon }
})

import MobileHeader from './MobileHeader.svelte'
import { MobileGUIStack, MobileSideBar, selectedCharID, SettingsMenuIndex } from 'src/ts/stores.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

beforeEach(() => {
  selectedCharID.set(0)
  MobileSideBar.set(0)
  MobileGUIStack.set(0)
  SettingsMenuIndex.set(-1)
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  selectedCharID.set(-1)
  MobileSideBar.set(0)
  target.remove()
})

describe('MobileHeader character ownership', () => {
  it('renders the selected name from the direct character resource owner', async () => {
    component = mount(MobileHeader, { target })
    await tick()

    expect(target.textContent).toContain('Canonical Character')
    expect(target.textContent).not.toContain('Legacy Character')
  })
})
