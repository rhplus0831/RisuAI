import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sidebarKeyboardMocks = vi.hoisted(() => ({
  alertConfirm: vi.fn(),
  alertInput: vi.fn(),
  alertSelect: vi.fn(),
  navigate: vi.fn(),
  selectSingleFile: vi.fn(),
  persistServerBackedSettingsPatchWithSettlement: vi.fn(async (): Promise<any> => ({ status: 'accepted' })),
  updateCharacterOrderFolderWithOutcome: vi.fn((): any => ({
    applied: true,
    settlement: Promise.resolve({ status: 'accepted', result: { status: 'ok' } }),
  })),
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
    alertConfirm: sidebarKeyboardMocks.alertConfirm,
    alertInput: sidebarKeyboardMocks.alertInput,
    alertSelect: sidebarKeyboardMocks.alertSelect,
  }
})

vi.mock('src/ts/characterCommands', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/characterCommands')>()
  return {
    ...actual,
    updateCharacterOrderFolderWithOutcome: sidebarKeyboardMocks.updateCharacterOrderFolderWithOutcome,
  }
})

vi.mock('src/ts/util', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/util')>()
  return {
    ...actual,
  }
})

vi.mock('src/ts/filePicker', () => ({
  selectSingleFile: sidebarKeyboardMocks.selectSingleFile,
}))

vi.mock('src/ts/server/settingsBridge.svelte', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/server/settingsBridge.svelte')>()
  return {
    ...actual,
    persistServerBackedSettingsPatchWithSettlement: sidebarKeyboardMocks.persistServerBackedSettingsPatchWithSettlement,
  }
})

import Sidebar from './Sidebar.svelte'
import { language } from 'src/lang'
import { setDatabaseLite } from 'src/ts/storage/database.svelte'
import { botMakerMode, DynamicGUI, PlaygroundStore, selectedCharID, settingsOpen } from 'src/ts/stores.svelte'
import { setMoodLightModeActive } from 'src/ts/moodLightMode'

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
  setMoodLightModeActive(false)
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
  setMoodLightModeActive(false)
  setDatabaseLite({} as never)
})

describe('Sidebar character keyboard activation', () => {
  it('confirms entry, exits immediately, and swaps the privacy partition', async () => {
    setDatabaseLite({
      characterOrder: ['char-private', 'char-normal'],
      characters: [
        { chaId: 'char-private', name: 'Private', image: '', chatPage: 0, chats: [] },
        { chaId: 'char-normal', name: 'Normal', image: '', chatPage: 0, chats: [] },
      ],
      moodLightMembership: { characterIds: ['char-private'], folders: [] },
      hamburgerButtonBottom: false,
      menuSideBar: false,
      roundIcons: false,
    } as never)
    component = mount(Sidebar, { target })
    await tick()

    const addButton = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.addCharacter}"]`)
    const moodLightButton = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.moodLightEnable}"]`)
    expect(addButton).toBeTruthy()
    expect(moodLightButton).toBeTruthy()
    expect(addButton!.compareDocumentPosition(moodLightButton!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(target.querySelector('[data-char-id="char-private"]')).toBeNull()
    expect(target.querySelector('[data-char-id="char-normal"]')).toBeTruthy()

    sidebarKeyboardMocks.alertConfirm.mockResolvedValueOnce(false)
    target.querySelector<HTMLButtonElement>(`button[aria-label="${language.moodLightEnable}"]`)!.click()
    await vi.waitFor(() => expect(sidebarKeyboardMocks.alertConfirm).toHaveBeenCalledTimes(1))
    await vi.waitFor(() =>
      expect(target.querySelector<HTMLButtonElement>(`button[aria-label="${language.moodLightEnable}"]`)).toBeTruthy(),
    )
    expect(target.querySelector('[data-char-id="char-private"]')).toBeNull()

    sidebarKeyboardMocks.alertConfirm.mockResolvedValueOnce(true)
    target.querySelector<HTMLButtonElement>(`button[aria-label="${language.moodLightEnable}"]`)!.click()
    await vi.waitFor(() =>
      expect(target.querySelector<HTMLButtonElement>(`button[aria-label="${language.moodLightDisable}"]`)).toBeTruthy(),
    )
    await vi.waitFor(() => expect(target.querySelector('[data-char-id="char-private"]')).toBeTruthy())
    expect(target.querySelector('[data-char-id="char-normal"]')).toBeNull()

    target.querySelector<HTMLButtonElement>(`button[aria-label="${language.moodLightDisable}"]`)!.click()
    await vi.waitFor(() => expect(target.querySelector('[data-char-id="char-normal"]')).toBeTruthy())
    expect(target.querySelector('[data-char-id="char-private"]')).toBeNull()
    expect(sidebarKeyboardMocks.alertConfirm).toHaveBeenCalledTimes(2)
  })

  it('opens the visual membership manager and persists a tile toggle without closing it', async () => {
    setMoodLightModeActive(true)
    component = mount(Sidebar, { target })
    await tick()

    target.querySelector<HTMLButtonElement>(`button[aria-label="${language.moodLightManage}"]`)!.click()
    await tick()

    const dialog = target.querySelector<HTMLElement>('[data-risu-mood-light-dialog-root] [role="dialog"]')
    const characterToggle = target.querySelector<HTMLButtonElement>(
      'button[data-risu-mood-light-target="character"][data-risu-target-id="char-a"]',
    )
    expect(dialog).toBeTruthy()
    expect(characterToggle).toBeTruthy()

    characterToggle!.click()
    await vi.waitFor(() =>
      expect(sidebarKeyboardMocks.persistServerBackedSettingsPatchWithSettlement).toHaveBeenCalledWith({
        moodLightMembership: { characterIds: ['char-a'], folders: [] },
      }),
    )

    expect(target.querySelector('[data-risu-mood-light-dialog-root] [role="dialog"]')).toBeTruthy()
    expect(sidebarKeyboardMocks.alertSelect).not.toHaveBeenCalled()
  })

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
    expect(sidebarKeyboardMocks.updateCharacterOrderFolderWithOutcome).not.toHaveBeenCalled()
  })

  it('ignores an invalid nested color selection', async () => {
    sidebarKeyboardMocks.alertSelect.mockResolvedValueOnce('1').mockResolvedValueOnce('not-an-index')

    openFolderContextMenu('Folder A')

    await vi.waitFor(() => expect(sidebarKeyboardMocks.alertSelect).toHaveBeenCalledTimes(2))
    await tick()

    expect(sidebarKeyboardMocks.updateCharacterOrderFolderWithOutcome).not.toHaveBeenCalled()
  })

  it('cancels image selection without resetting or opening the file picker', async () => {
    sidebarKeyboardMocks.alertSelect.mockResolvedValueOnce('2').mockResolvedValueOnce(null)

    openFolderContextMenu('Folder A')

    await vi.waitFor(() => expect(sidebarKeyboardMocks.alertSelect).toHaveBeenCalledTimes(2))
    await tick()

    expect(sidebarKeyboardMocks.alertSelect.mock.calls[1][0]).toHaveLength(2)
    expect(sidebarKeyboardMocks.updateCharacterOrderFolderWithOutcome).not.toHaveBeenCalled()
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

    await vi.waitFor(() => expect(sidebarKeyboardMocks.updateCharacterOrderFolderWithOutcome).toHaveBeenCalledTimes(1))
    expect(sidebarKeyboardMocks.updateCharacterOrderFolderWithOutcome).toHaveBeenCalledWith('folder-a', {
      color: 'red',
    })
  })

  it('keeps a folder change pending through classification, serializes that folder, and labels a queued result', async () => {
    const settlement = deferred<any>()
    sidebarKeyboardMocks.updateCharacterOrderFolderWithOutcome.mockReturnValueOnce({
      applied: true,
      settlement: settlement.promise,
    })
    sidebarKeyboardMocks.alertSelect.mockResolvedValueOnce('1').mockResolvedValueOnce('0')

    openFolderContextMenu('Folder A')
    await vi.waitFor(() => expect(sidebarKeyboardMocks.updateCharacterOrderFolderWithOutcome).toHaveBeenCalledTimes(1))
    await tick()

    const folderAvatar = target.querySelector<HTMLElement>('[role="button"][aria-label="Folder A"]')
    const folderRow = folderAvatar?.closest<HTMLElement>('[role="listitem"]')
    expect(folderRow?.getAttribute('aria-busy')).toBe('true')
    expect(folderRow?.getAttribute('draggable')).toBe('false')
    expect(
      target.querySelector('[data-risu-character-organization-key][data-risu-character-organization-status="pending"]'),
    ).toBeNull()

    openFolderContextMenu('Folder A')
    await tick()
    expect(sidebarKeyboardMocks.alertSelect).toHaveBeenCalledTimes(2)

    openFolderContextMenu('Folder B')
    await vi.waitFor(() => expect(sidebarKeyboardMocks.alertSelect).toHaveBeenCalledTimes(3))

    settlement.resolve({ status: 'queued', result: { status: 'unavailable' } })
    await tick()
    await tick()

    expect(
      target.querySelector('[data-risu-character-organization-key][data-risu-character-organization-status="queued"]'),
    ).toBeNull()
    expect(folderRow?.getAttribute('draggable')).toBe('true')
  })

  it('labels a terminal folder-organization failure after settlement', async () => {
    sidebarKeyboardMocks.updateCharacterOrderFolderWithOutcome.mockReturnValueOnce({
      applied: true,
      settlement: Promise.resolve({ status: 'failed', result: { status: 'error', error: 'rejected' } }),
    })
    sidebarKeyboardMocks.alertSelect.mockResolvedValueOnce('0')
    sidebarKeyboardMocks.alertInput.mockResolvedValueOnce('Renamed A')

    openFolderContextMenu('Folder A')

    await vi.waitFor(() => {
      expect(target.querySelector('[data-risu-character-organization-status="failed"]')?.textContent).toContain(
        language.mutationStatusFailed,
      )
    })
  })
})
