import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sidebarKeyboardMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  getModuleTriggers: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

vi.mock('src/ts/gui/tooltip', () => ({
  tooltipRight: () => ({
    destroy: vi.fn(),
    update: vi.fn(),
  }),
}))

vi.mock('src/ts/router', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/router')>()
  return {
    ...actual,
    navigate: sidebarKeyboardMocks.navigate,
  }
})

import Sidebar from './Sidebar.svelte'
import { setDatabaseLite } from 'src/ts/storage/database.svelte'
import { botMakerMode, DynamicGUI, PlaygroundStore, selectedCharID, settingsOpen } from 'src/ts/stores.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

function seedSidebarDatabase() {
  setDatabaseLite({
    characterOrder: ['char-a'],
    characters: [
      {
        chaId: 'char-a',
        name: 'Alpha',
        image: '',
        chatPage: 0,
        chats: [],
      },
    ],
    hamburgerButtonBottom: false,
    menuSideBar: false,
    roundIcons: false,
  } as never)
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  vi.clearAllMocks()
  selectedCharID.set(-1)
  settingsOpen.set(false)
  PlaygroundStore.set(0)
  DynamicGUI.set(false)
  botMakerMode.set(false)
  seedSidebarDatabase()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  document.body.innerHTML = ''
  selectedCharID.set(-1)
  setDatabaseLite({} as never)
})

describe('Sidebar character keyboard activation', () => {
  it('exposes one avatar tab stop and activates it with Space', async () => {
    component = mount(Sidebar, { target })
    await tick()

    const avatar = target.querySelector<HTMLElement>('[data-char-id="char-a"]')
    expect(avatar).toBeTruthy()
    const row = avatar!.closest<HTMLElement>('[draggable="true"]')
    expect(row).toBeTruthy()
    expect(row!.querySelectorAll('[role="button"][tabindex="0"]')).toHaveLength(1)

    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    avatar!.dispatchEvent(space)
    await tick()

    expect(space.defaultPrevented).toBe(true)
    expect(sidebarKeyboardMocks.navigate).toHaveBeenCalledWith('/character/char-a')
  })
})
