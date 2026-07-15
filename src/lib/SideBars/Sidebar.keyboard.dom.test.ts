import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sidebarKeyboardMocks = vi.hoisted(() => ({
  alertInput: vi.fn(),
  alertSelect: vi.fn(),
  navigate: vi.fn(),
  selectSingleFile: vi.fn(),
  updateCharacterOrderFolder: vi.fn(),
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

vi.mock('src/ts/alert', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/alert')>()
  return {
    ...actual,
    alertInput: sidebarKeyboardMocks.alertInput,
    alertSelect: sidebarKeyboardMocks.alertSelect,
  }
})

vi.mock('src/ts/characterCommands', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/characterCommands')>()
  return {
    ...actual,
    updateCharacterOrderFolder: sidebarKeyboardMocks.updateCharacterOrderFolder,
  }
})

vi.mock('src/ts/util', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/util')>()
  return {
    ...actual,
    selectSingleFile: sidebarKeyboardMocks.selectSingleFile,
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

function seedFolderSidebarDatabase(order: readonly ('folder-a' | 'folder-b')[] = ['folder-a', 'folder-b']) {
  const folders = {
    'folder-a': {
      id: 'folder-a',
      name: 'Folder A',
      color: 'blue',
      data: ['char-a'],
    },
    'folder-b': {
      id: 'folder-b',
      name: 'Folder B',
      color: 'green',
      data: ['char-b'],
    },
  }

  setDatabaseLite({
    characterOrder: order.map((folderId) => folders[folderId]),
    characters: [
      {
        chaId: 'char-a',
        name: 'Alpha',
        image: '',
        chatPage: 0,
        chats: [],
      },
      {
        chaId: 'char-b',
        name: 'Beta',
        image: '',
        chatPage: 0,
        chats: [],
      },
    ],
    hamburgerButtonBottom: false,
    menuSideBar: false,
    roundIcons: false,
    showFolderName: true,
  } as never)
}

function openFolderContextMenu(folderName: string) {
  const folder = target.querySelector<HTMLElement>(`[role="button"][aria-label="${folderName}"]`)
  expect(folder).toBeTruthy()
  folder!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
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

  it('makes obscured character controls inert while preserving hamburger menu focus targets', async () => {
    component = mount(Sidebar, { target })
    await tick()

    const menuButton = target.querySelector<HTMLButtonElement>('button[aria-label="Menu"]')
    const characterControls = target.querySelector<HTMLElement>('[data-risu-sidebar-character-controls]')
    const avatar = target.querySelector<HTMLElement>('[data-char-id="char-a"]')
    expect(menuButton).toBeTruthy()
    expect(characterControls).toBeTruthy()
    expect(avatar).toBeTruthy()
    expect(characterControls!.hasAttribute('inert')).toBe(false)

    menuButton!.click()
    await tick()

    const settingsButton = target.querySelector<HTMLButtonElement>('button[aria-label="Settings"]')
    expect(menuButton!.getAttribute('aria-expanded')).toBe('true')
    expect(characterControls!.hasAttribute('inert')).toBe(true)
    expect(avatar!.closest('[inert]')).toBe(characterControls)
    expect(settingsButton).toBeTruthy()
    expect(settingsButton!.closest('[inert]')).toBeNull()
    expect(settingsButton!.tabIndex).toBe(0)

    menuButton!.click()
    await tick()

    expect(menuButton!.getAttribute('aria-expanded')).toBe('false')
    expect(characterControls!.hasAttribute('inert')).toBe(false)
  })
})

describe('Sidebar character folder context menu', () => {
  beforeEach(async () => {
    seedFolderSidebarDatabase()
    component = mount(Sidebar, { target })
    await tick()
  })

  it('offers a color cancel choice without submitting an undefined color', async () => {
    sidebarKeyboardMocks.alertSelect.mockResolvedValueOnce('1').mockResolvedValueOnce('8')

    openFolderContextMenu('Folder A')

    await vi.waitFor(() => expect(sidebarKeyboardMocks.alertSelect).toHaveBeenCalledTimes(2))
    await tick()

    expect(sidebarKeyboardMocks.alertSelect.mock.calls[1][0]).toHaveLength(9)
    expect(sidebarKeyboardMocks.updateCharacterOrderFolder).not.toHaveBeenCalled()
  })

  it('ignores an invalid nested color selection', async () => {
    sidebarKeyboardMocks.alertSelect.mockResolvedValueOnce('1').mockResolvedValueOnce('not-an-index')

    openFolderContextMenu('Folder A')

    await vi.waitFor(() => expect(sidebarKeyboardMocks.alertSelect).toHaveBeenCalledTimes(2))
    await tick()

    expect(sidebarKeyboardMocks.updateCharacterOrderFolder).not.toHaveBeenCalled()
  })

  it('offers an image cancel choice without resetting or opening the file picker', async () => {
    sidebarKeyboardMocks.alertSelect.mockResolvedValueOnce('2').mockResolvedValueOnce('2')

    openFolderContextMenu('Folder A')

    await vi.waitFor(() => expect(sidebarKeyboardMocks.alertSelect).toHaveBeenCalledTimes(2))
    await tick()

    expect(sidebarKeyboardMocks.alertSelect.mock.calls[1][0]).toHaveLength(3)
    expect(sidebarKeyboardMocks.updateCharacterOrderFolder).not.toHaveBeenCalled()
    expect(sidebarKeyboardMocks.selectSingleFile).not.toHaveBeenCalled()
  })

  it('keeps a delayed color change bound to the originally opened folder after reorder', async () => {
    const outerSelection = deferred<string>()
    sidebarKeyboardMocks.alertSelect.mockReturnValueOnce(outerSelection.promise).mockResolvedValueOnce('0')

    openFolderContextMenu('Folder A')
    await vi.waitFor(() => expect(sidebarKeyboardMocks.alertSelect).toHaveBeenCalledTimes(1))

    seedFolderSidebarDatabase(['folder-b', 'folder-a'])
    await tick()
    expect(target.querySelector('[role="button"][aria-label="Folder B"]')).toBeTruthy()

    outerSelection.resolve('1')

    await vi.waitFor(() => expect(sidebarKeyboardMocks.updateCharacterOrderFolder).toHaveBeenCalledTimes(1))
    expect(sidebarKeyboardMocks.updateCharacterOrderFolder).toHaveBeenCalledWith('folder-a', { color: 'red' })
  })
})
