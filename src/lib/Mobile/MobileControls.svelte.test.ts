import { get } from 'svelte/store'
import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/stores.svelte', async () => import('./MobileControls.testState'))
vi.mock('src/ts/lite', async () => {
  const { writable } = await import('svelte/store')
  return { isLite: writable(false) }
})
vi.mock('src/ts/characterDisplayName', () => ({
  getCharacterDisplayName: (character: { name: string }) => character.name,
}))
vi.mock('src/ts/server/resourceState.svelte', () => ({
  getResourceDatabase: () => ({ characters: [{ name: 'Test Character' }] }),
}))

vi.mock('../Setting/Settings.svelte', async () => ({
  default: (await import('./MobileControls.testStub.svelte')).default,
}))
vi.mock('../UI/Realm/RealmMain.svelte', async () => ({
  default: (await import('./MobileControls.testStub.svelte')).default,
}))
vi.mock('./MobileCharacters.svelte', async () => ({
  default: (await import('./MobileControls.testStub.svelte')).default,
}))
vi.mock('../ChatScreens/ChatScreen.svelte', async () => ({
  default: (await import('./MobileControls.testStub.svelte')).default,
}))
vi.mock('../SideBars/CharConfig.svelte', async () => ({
  default: (await import('./MobileControls.testStub.svelte')).default,
}))
vi.mock('../SideBars/SideChatList.svelte', async () => ({
  default: (await import('./MobileControls.testStub.svelte')).default,
}))
vi.mock('../SideBars/DevTool.svelte', async () => ({
  default: (await import('./MobileControls.testStub.svelte')).default,
}))

import MobileBody from './MobileBody.svelte'
import MobileHeader from './MobileHeader.svelte'
import { language } from 'src/lang'
import { MobileGUIStack, MobileSearch, MobileSideBar, SettingsMenuIndex, selectedCharID } from 'src/ts/stores.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

function buttonByName(name: string): HTMLButtonElement {
  const button = target.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)
  if (!button) throw new Error(`Button not found: ${name}`)
  return button
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  MobileGUIStack.set(0)
  MobileSearch.set('')
  MobileSideBar.set(0)
  SettingsMenuIndex.set(-1)
  selectedCharID.set(-1)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('mobile icon controls', () => {
  it('names back and menu buttons across the mobile header states', async () => {
    selectedCharID.set(0)
    MobileSideBar.set(1)
    component = mount(MobileHeader, { target })
    await tick()

    const sidebarBackButton = buttonByName(language.goback)
    expect(sidebarBackButton.type).toBe('button')

    sidebarBackButton.click()
    await tick()

    expect(get(MobileSideBar)).toBe(0)
    expect(buttonByName(language.goback)).toBeTruthy()
    expect(buttonByName(language.menu).type).toBe('button')

    selectedCharID.set(-1)
    MobileGUIStack.set(2)
    SettingsMenuIndex.set(0)
    await tick()

    expect(buttonByName(language.goback)).toBeTruthy()
  })

  it('names the mobile tools button and keeps its native activation', async () => {
    selectedCharID.set(0)
    MobileSideBar.set(1)
    component = mount(MobileBody, { target })
    await tick()

    const toolsButton = buttonByName(language.tools)
    expect(toolsButton.type).toBe('button')

    toolsButton.click()
    await tick()

    expect(get(MobileSideBar)).toBe(3)
  })
})
