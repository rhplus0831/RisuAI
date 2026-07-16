import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sidebarKeyboardMocks = vi.hoisted(() => ({
  alertInput: vi.fn(),
  alertSelect: vi.fn(),
  createCharacterOrderFolder: vi.fn(),
  moveCharacterOrderItem: vi.fn(),
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
    createCharacterOrderFolder: sidebarKeyboardMocks.createCharacterOrderFolder,
    moveCharacterOrderItem: sidebarKeyboardMocks.moveCharacterOrderItem,
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
import { language } from 'src/lang'
import { setDatabaseLite } from 'src/ts/storage/database.svelte'
import { botMakerMode, DynamicGUI, PlaygroundStore, selectedCharID, settingsOpen } from 'src/ts/stores.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

function seedSidebarDatabase(options: { enableDevTools?: boolean } = {}) {
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
    enableDevTools: options.enableDevTools ?? false,
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

function seedOrganizerSidebarDatabase(characterOrder: unknown[]) {
  setDatabaseLite({
    characterOrder,
    characters: ['a', 'b', 'c', 'd', 'e'].map((suffix) => ({
      chaId: `char-${suffix}`,
      name: `Character ${suffix.toUpperCase()}`,
      image: '',
      chatPage: 0,
      chats: [],
    })),
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

function openFolderActionButton(folderId: string) {
  const button = target.querySelector<HTMLButtonElement>(`button[data-risu-sidebar-folder-actions="${folderId}"]`)
  expect(button).toBeTruthy()
  button!.click()
  return button!
}

async function enableCharacterOrganizer() {
  const toggle = target.querySelector<HTMLButtonElement>('button[data-risu-sidebar-organizer-toggle]')
  expect(toggle).toBeTruthy()
  expect(toggle!.tabIndex).toBe(0)
  expect(toggle!.getAttribute('aria-pressed')).toBe('false')

  toggle!.click()
  await tick()

  expect(toggle!.getAttribute('aria-pressed')).toBe('true')
  return toggle!
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
  it('names and exposes the state of the developer tools tab', async () => {
    seedSidebarDatabase({ enableDevTools: true })
    selectedCharID.set(0)
    component = mount(Sidebar, { target })
    await tick()

    const developerTools = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.enableDevTools}"]`)
    expect(developerTools).toBeTruthy()
    expect(developerTools!.getAttribute('aria-pressed')).toBe('false')

    developerTools!.click()
    await tick()

    expect(developerTools!.getAttribute('aria-pressed')).toBe('true')
  })

  it('does not expose an empty ghost button above the sidebar content', async () => {
    component = mount(Sidebar, { target })
    await tick()

    const sidebarPanel = target.querySelector<HTMLElement>('.setting-area')
    expect(sidebarPanel).toBeTruthy()
    expect(sidebarPanel!.querySelector(':scope > button')).toBeNull()
  })

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

  it('does not expose an empty action menu when a lone character cannot be moved', async () => {
    component = mount(Sidebar, { target })
    await tick()

    await enableCharacterOrganizer()

    expect(target.querySelector('[data-risu-sidebar-organizer-action]')).toBeNull()
    expect(sidebarKeyboardMocks.alertSelect).not.toHaveBeenCalled()
  })

  it('exposes native keyboard controls and reorders a nested character without dragging', async () => {
    seedOrganizerSidebarDatabase([
      {
        id: 'folder-a',
        name: 'Folder A',
        color: 'blue',
        data: ['char-a', 'char-b'],
      },
      'char-c',
    ])
    component = mount(Sidebar, { target })
    await tick()

    await enableCharacterOrganizer()
    target.querySelector<HTMLElement>('[role="button"][aria-label="Folder A"]')!.click()
    await tick()

    const actionButton = target.querySelector<HTMLButtonElement>('button[data-risu-sidebar-organizer-action="char-b"]')
    expect(actionButton).toBeTruthy()
    expect(actionButton!.tabIndex).toBe(0)
    expect(actionButton!.getAttribute('aria-label')).toBe(language.characterActionsFor('Character B'))

    const selection = deferred<string>()
    sidebarKeyboardMocks.alertSelect.mockReturnValueOnce(selection.promise)
    actionButton!.click()
    await vi.waitFor(() => expect(sidebarKeyboardMocks.alertSelect).toHaveBeenCalledTimes(1))

    const actions = sidebarKeyboardMocks.alertSelect.mock.calls[0][0] as string[]
    selection.resolve(String(actions.indexOf(language.moveUp)))

    await vi.waitFor(() => expect(sidebarKeyboardMocks.moveCharacterOrderItem).toHaveBeenCalledTimes(1))
    expect(sidebarKeyboardMocks.moveCharacterOrderItem).toHaveBeenCalledWith(
      { folder: 'folder-a', index: 1 },
      { folder: 'folder-a', index: 0 },
    )
  })

  it('keeps a tapped destination bound to its folder ID across a live refresh', async () => {
    seedOrganizerSidebarDatabase([
      'char-a',
      { id: 'folder-a', name: 'Folder A', color: 'blue', data: ['char-b'] },
      { id: 'folder-b', name: 'Folder B', color: 'green', data: ['char-c'] },
      'char-d',
    ])
    component = mount(Sidebar, { target })
    await tick()
    await enableCharacterOrganizer()

    const actionSelection = deferred<string>()
    const folderSelection = deferred<string>()
    sidebarKeyboardMocks.alertSelect
      .mockReturnValueOnce(actionSelection.promise)
      .mockReturnValueOnce(folderSelection.promise)

    target.querySelector<HTMLButtonElement>('button[data-risu-sidebar-organizer-action="char-a"]')!.click()
    await vi.waitFor(() => expect(sidebarKeyboardMocks.alertSelect).toHaveBeenCalledTimes(1))
    const actions = sidebarKeyboardMocks.alertSelect.mock.calls[0][0] as string[]
    actionSelection.resolve(String(actions.indexOf(language.moveToFolder)))

    await vi.waitFor(() => expect(sidebarKeyboardMocks.alertSelect).toHaveBeenCalledTimes(2))
    const folderOptions = sidebarKeyboardMocks.alertSelect.mock.calls[1][0] as string[]
    expect(folderOptions).toEqual(['Folder A', 'Folder B'])

    seedOrganizerSidebarDatabase([
      { id: 'folder-b', name: 'Folder B', color: 'green', data: ['char-c'] },
      'char-d',
      { id: 'folder-a', name: 'Folder A refreshed', color: 'blue', data: ['char-b', 'char-e'] },
      'char-a',
    ])
    await tick()
    folderSelection.resolve(String(folderOptions.indexOf('Folder A')))

    await vi.waitFor(() => expect(sidebarKeyboardMocks.moveCharacterOrderItem).toHaveBeenCalledTimes(1))
    expect(sidebarKeyboardMocks.moveCharacterOrderItem).toHaveBeenCalledWith(
      { index: 3 },
      { folder: 'folder-a', index: 2 },
    )
  })

  it('creates a localized folder from ordinary click actions', async () => {
    seedOrganizerSidebarDatabase(['char-a', 'char-b'])
    component = mount(Sidebar, { target })
    await tick()
    await enableCharacterOrganizer()

    const actionSelection = deferred<string>()
    sidebarKeyboardMocks.alertSelect.mockReturnValueOnce(actionSelection.promise).mockResolvedValueOnce('0')

    target.querySelector<HTMLButtonElement>('button[data-risu-sidebar-organizer-action="char-a"]')!.click()
    await vi.waitFor(() => expect(sidebarKeyboardMocks.alertSelect).toHaveBeenCalledTimes(1))
    const actions = sidebarKeyboardMocks.alertSelect.mock.calls[0][0] as string[]
    actionSelection.resolve(String(actions.indexOf(language.createFolderWith)))

    await vi.waitFor(() => expect(sidebarKeyboardMocks.createCharacterOrderFolder).toHaveBeenCalledTimes(1))
    expect(sidebarKeyboardMocks.createCharacterOrderFolder).toHaveBeenCalledWith(
      { index: 0 },
      { index: 1 },
      undefined,
      language.newCharacterFolderName,
    )
  })
})

describe('Sidebar character folder context menu', () => {
  beforeEach(async () => {
    seedFolderSidebarDatabase()
    component = mount(Sidebar, { target })
    await tick()
  })

  it('cancels color selection without submitting an undefined color', async () => {
    sidebarKeyboardMocks.alertSelect.mockResolvedValueOnce('1').mockResolvedValueOnce(null)

    openFolderContextMenu('Folder A')

    await vi.waitFor(() => expect(sidebarKeyboardMocks.alertSelect).toHaveBeenCalledTimes(2))
    await tick()

    expect(sidebarKeyboardMocks.alertSelect.mock.calls[1][0]).toHaveLength(8)
    expect(sidebarKeyboardMocks.updateCharacterOrderFolder).not.toHaveBeenCalled()
  })

  it('exposes folder settings through an ordinary native button', async () => {
    sidebarKeyboardMocks.alertSelect.mockResolvedValueOnce('0')
    sidebarKeyboardMocks.alertInput.mockResolvedValueOnce(null)

    const button = openFolderActionButton('folder-a')

    expect(button.tabIndex).toBe(0)
    expect(button.getAttribute('aria-label')).toBe(language.folderActionsFor('Folder A'))
    await vi.waitFor(() => expect(sidebarKeyboardMocks.alertInput).toHaveBeenCalledTimes(1))
    expect(sidebarKeyboardMocks.alertInput).toHaveBeenCalledWith(language.changeFolderName, [], 'Folder A')
  })

  it('ignores an invalid nested color selection', async () => {
    sidebarKeyboardMocks.alertSelect.mockResolvedValueOnce('1').mockResolvedValueOnce('not-an-index')

    openFolderContextMenu('Folder A')

    await vi.waitFor(() => expect(sidebarKeyboardMocks.alertSelect).toHaveBeenCalledTimes(2))
    await tick()

    expect(sidebarKeyboardMocks.updateCharacterOrderFolder).not.toHaveBeenCalled()
  })

  it('cancels image selection without resetting or opening the file picker', async () => {
    sidebarKeyboardMocks.alertSelect.mockResolvedValueOnce('2').mockResolvedValueOnce(null)

    openFolderContextMenu('Folder A')

    await vi.waitFor(() => expect(sidebarKeyboardMocks.alertSelect).toHaveBeenCalledTimes(2))
    await tick()

    expect(sidebarKeyboardMocks.alertSelect.mock.calls[1][0]).toHaveLength(2)
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
