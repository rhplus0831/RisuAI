import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { selectedCharID } from 'src/ts/stores.svelte'
import { setDatabaseLite } from 'src/ts/storage/database.svelte'

const hydration = vi.hoisted(() => ({
  failed: false,
  pending: false,
  retry: vi.fn(async () => undefined),
}))

const editorActions = vi.hoisted(() => ({
  addLorebook: vi.fn(),
  addLorebookFolder: vi.fn(),
  exportLoreBook: vi.fn(),
  importLoreBook: vi.fn(),
}))

vi.mock('src/lang', () => ({
  language: {
    Chat: 'Chat',
    add: 'Add',
    alwaysActive: 'Always Active',
    character: 'Character',
    disable: 'Disable',
    enable: 'Enable',
    export: 'Export',
    folderName: 'Folder',
    globalLoreInfo: 'Character lorebook',
    import: 'Import',
    loadingLorebookData: 'Loading Lorebook Data',
    localLoreInfo: 'Chat lorebook',
    loreBook: 'Lorebook',
    lorebookDataLoadFailed: 'Lorebook data could not be loaded.',
    retry: 'Retry',
    settings: 'Settings',
  },
}))

vi.mock('../../../lang', () => ({
  language: {
    Chat: 'Chat',
    add: 'Add',
    alwaysActive: 'Always Active',
    character: 'Character',
    disable: 'Disable',
    enable: 'Enable',
    export: 'Export',
    folderName: 'Folder',
    globalLoreInfo: 'Character lorebook',
    import: 'Import',
    loadingLorebookData: 'Loading Lorebook Data',
    localLoreInfo: 'Chat lorebook',
    loreBook: 'Lorebook',
    lorebookDataLoadFailed: 'Lorebook data could not be loaded.',
    retry: 'Retry',
    settings: 'Settings',
  },
}))

vi.mock('../../../ts/process/lorebook.svelte', () => editorActions)

vi.mock('src/ts/server/chatMessageHydration.svelte', async (importActual) => ({
  ...(await importActual<typeof import('src/ts/server/chatMessageHydration.svelte')>()),
  hasCharacterLorebookHydrationFailed: () => hydration.failed,
  hydrateActiveCharacterLorebook: hydration.retry,
  isCharacterLorebookHydrationPending: () => hydration.pending,
}))

vi.mock('src/ts/server/lorebookBridge.svelte', async (importActual) => ({
  ...(await importActual<typeof import('src/ts/server/lorebookBridge.svelte')>()),
  replaceCharacterLorebookCollection: vi.fn(),
  replaceChatLorebookCollection: vi.fn(),
  watchServerBackedLorebooks: () => () => {},
}))

vi.mock('src/ts/server/characterBridge.svelte', async (importActual) => ({
  ...(await importActual<typeof import('src/ts/server/characterBridge.svelte')>()),
  createServerBackedCharacterDraft: () => ({
    value: { lorePlus: false, loreSettings: undefined },
  }),
}))

vi.mock('./LoreBookList.svelte', async () => ({
  default: (await import('./LoreBookSetting.test.LoreBookListStub.svelte')).default,
}))

import LoreBookSetting from './LoreBookSetting.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

beforeEach(() => {
  hydration.failed = false
  hydration.pending = false
  hydration.retry.mockClear()
  for (const action of Object.values(editorActions)) action.mockClear()
  setDatabaseLite({
    bulkEnabling: false,
    characters: [
      {
        chaId: 'character-a',
        chatPage: 0,
        chats: [{ id: 'chat-a', localLore: [], message: [] }],
        globalLore: [],
        lorePlus: false,
      },
    ],
  } as any)
  selectedCharID.set(0)
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  selectedCharID.set(-1)
})

describe('character lorebook hydration UI', () => {
  it('shows loading and hides the list and mutation toolbar while hydration is pending', async () => {
    hydration.pending = true
    component = mount(LoreBookSetting, { target })
    await tick()

    expect(target.querySelector('[data-testid="character-lorebook-hydration-loading"]')).not.toBeNull()
    expect(target.textContent).toContain('Loading Lorebook Data')
    expect(target.querySelector('[data-testid="character-lorebook-list-ready"]')).toBeNull()
    // Only the Character / Chat / Settings tabs remain; add, export, folder,
    // import, and bulk mutation controls are withheld.
    expect(target.querySelectorAll('button')).toHaveLength(3)
  })

  it('shows a failed state with retry and keeps mutation controls unavailable', async () => {
    hydration.failed = true
    component = mount(LoreBookSetting, { target })
    await tick()

    expect(target.querySelector('[data-testid="character-lorebook-hydration-error"]')).not.toBeNull()
    expect(target.textContent).toContain('Lorebook data could not be loaded.')
    expect(target.querySelector('[data-testid="character-lorebook-list-ready"]')).toBeNull()

    const retry = [...target.querySelectorAll('button')].find((button) => button.textContent?.includes('Retry'))
    expect(retry).toBeDefined()
    retry?.click()
    await tick()
    expect(hydration.retry).toHaveBeenCalledWith({ force: true })
    expect(target.querySelectorAll('button')).toHaveLength(4)
  })
})

describe('lorebook editor action accessibility', () => {
  it('names the mutation toolbar and exposes the selected submenu', async () => {
    component = mount(LoreBookSetting, { target })
    await tick()

    const buttons = Array.from(target.querySelectorAll<HTMLButtonElement>('button'))
    const characterTab = buttons.find((button) => button.textContent?.trim() === 'Character')
    const chatTab = buttons.find((button) => button.textContent?.trim() === 'Chat')
    const settingsTab = buttons.find((button) => button.textContent?.trim() === 'Settings')
    expect(characterTab?.getAttribute('aria-pressed')).toBe('true')
    expect(chatTab?.getAttribute('aria-pressed')).toBe('false')
    expect(settingsTab?.getAttribute('aria-pressed')).toBe('false')

    expect(target.querySelector('[aria-label="Add: Lorebook"]')).toBeTruthy()
    expect(target.querySelector('[aria-label="Export: Lorebook"]')).toBeTruthy()
    expect(target.querySelector('[aria-label="Add: Folder"]')).toBeTruthy()
    expect(target.querySelector('[aria-label="Import: Lorebook"]')).toBeTruthy()

    chatTab?.click()
    await tick()
    expect(characterTab?.getAttribute('aria-pressed')).toBe('false')
    expect(chatTab?.getAttribute('aria-pressed')).toBe('true')
  })

  it('exposes bulk always-active state for character and chat lorebooks', async () => {
    setDatabaseLite({
      bulkEnabling: true,
      characters: [
        {
          chaId: 'character-a',
          chatPage: 0,
          chats: [{ id: 'chat-a', localLore: [{ alwaysActive: false }], message: [] }],
          globalLore: [{ alwaysActive: true }],
          lorePlus: false,
        },
      ],
    } as any)
    component = mount(LoreBookSetting, { target })
    await tick()

    const buttons = Array.from(target.querySelectorAll<HTMLButtonElement>('button'))
    const characterToggle = buttons.find((button) => button.textContent?.trim() === 'CHAR')
    const chatToggle = buttons.find((button) => button.textContent?.trim() === 'CHAT')
    expect(characterToggle?.getAttribute('aria-label')).toBe('Disable: Always Active (Character)')
    expect(characterToggle?.getAttribute('aria-pressed')).toBe('true')
    expect(chatToggle?.getAttribute('aria-label')).toBe('Enable: Always Active (Chat)')
    expect(chatToggle?.getAttribute('aria-pressed')).toBe('false')
  })
})
