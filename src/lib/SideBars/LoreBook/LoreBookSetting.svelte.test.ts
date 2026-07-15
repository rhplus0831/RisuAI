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
    character: 'Character',
    globalLoreInfo: 'Character lorebook',
    loadingLorebookData: 'Loading Lorebook Data',
    localLoreInfo: 'Chat lorebook',
    lorebookDataLoadFailed: 'Lorebook data could not be loaded.',
    retry: 'Retry',
    settings: 'Settings',
  },
}))

vi.mock('../../../lang', () => ({
  language: {
    Chat: 'Chat',
    character: 'Character',
    globalLoreInfo: 'Character lorebook',
    loadingLorebookData: 'Loading Lorebook Data',
    localLoreInfo: 'Chat lorebook',
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
