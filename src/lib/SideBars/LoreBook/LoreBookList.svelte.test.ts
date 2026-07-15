import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database, loreBook } from 'src/ts/storage/database.svelte'
import { selectedCharID } from 'src/ts/stores.svelte'
import { setDatabaseLite } from 'src/ts/storage/database.svelte'

const lorebookListMocks = vi.hoisted(() => {
  type Deferred<T> = {
    promise: Promise<T>
    resolve: (value: T) => void
    reject: (reason?: unknown) => void
  }

  type QueuedConfirm = boolean | Deferred<boolean>

  class SortableMock {
    static create = vi.fn((element: Element, options: unknown) => new SortableMock(element, options))

    element: Element
    options: unknown
    destroy = vi.fn()

    constructor(element: Element, options: unknown) {
      this.element = element
      this.options = options
    }
  }

  const confirmQueue: QueuedConfirm[] = []
  const replaceCharacterLorebookCollection = vi.fn()
  const replaceChatLorebookCollection = vi.fn()

  function createDeferred<T>(): Deferred<T> {
    let resolveDeferred!: (value: T) => void
    let rejectDeferred!: (reason?: unknown) => void
    return {
      promise: new Promise<T>((resolve, reject) => {
        resolveDeferred = resolve
        rejectDeferred = reject
      }),
      resolve: resolveDeferred,
      reject: rejectDeferred,
    }
  }

  function isDeferred(value: QueuedConfirm): value is Deferred<boolean> {
    return typeof value === 'object' && value !== null && 'promise' in value
  }

  function queueConfirm(value: QueuedConfirm): void {
    confirmQueue.push(value)
  }

  return {
    SortableMock,
    alertConfirm: vi.fn(() => {
      const next = confirmQueue.shift()
      if (next === undefined) return Promise.resolve(false)
      return isDeferred(next) ? next.promise : Promise.resolve(next)
    }),
    alertMd: vi.fn(),
    createDeferred,
    queueConfirm,
    reset: () => {
      confirmQueue.splice(0)
      SortableMock.create.mockClear()
    },
    replaceCharacterLorebookCollection,
    replaceChatLorebookCollection,
    setActiveChatLorebookLocalActivation: vi.fn(),
    languageMock: {
      language: {
        SecondaryKeys: 'Secondary keys',
        activationKeys: 'Activation keys',
        activationKeysInfo: 'Activation info',
        activationProbability: 'Activation probability',
        alwaysActive: 'Always active',
        alwaysActiveInChat: 'Always active in chat',
        childLoreDesc: 'Child lore',
        folderName: 'Folder name',
        folderRemoveConfirm: 'Remove folder children?',
        help: {
          experimental: 'Experimental',
          loreActivationKey: 'Lore activation key',
          loreName: 'Lore name',
          loreSelective: 'Lore selective',
          loreorder: 'Lore order',
          useRegexLorebook: 'Use regex lorebook',
        },
        hotkeyDesc: { popupEditor: 'Popup editor' },
        insertOrder: 'Insert order',
        name: 'Name',
        prompt: 'Prompt',
        removeConfirm: 'Remove ',
        selective: 'Selective',
        showHelp: 'Show help',
        tokens: 'tokens',
        useRegexLorebook: 'Use regex lorebook',
      },
    },
  }
})

vi.mock('sortablejs/modular/sortable.core.esm.js', () => ({
  default: lorebookListMocks.SortableMock,
}))

vi.mock('../../../lang', () => lorebookListMocks.languageMock)
vi.mock('src/lang', () => lorebookListMocks.languageMock)

vi.mock('../../../ts/alert', () => ({
  alertConfirm: lorebookListMocks.alertConfirm,
  alertMd: lorebookListMocks.alertMd,
}))

vi.mock('src/ts/alert', () => ({
  alertConfirm: lorebookListMocks.alertConfirm,
  alertMd: lorebookListMocks.alertMd,
}))

vi.mock('src/ts/server/lorebookBridge.svelte', () => ({
  applyLorebookEntryDraftEdit: vi.fn(),
  applyLorebookEntryDraftRollback: vi.fn((draft: loreBook) => ({ draft, restoredFields: [] })),
  applyServerCharacterLorebookResource: vi.fn(() => true),
  changedLorebookEntryDraftFields: vi.fn(() => []),
  clearDirtyLorebookEntryFieldsMatchingProjection: vi.fn(),
  flushPendingLorebookEntryDraftEdit: vi.fn(),
  markCharacterLorebookHydrated: vi.fn(),
  mergeLorebookEntryProjectionDraft: vi.fn((draft: loreBook) => draft),
  recordHydratedCharacterLorebooks: vi.fn(),
  replaceCharacterLorebookCollection: lorebookListMocks.replaceCharacterLorebookCollection,
  replaceChatLorebookCollection: lorebookListMocks.replaceChatLorebookCollection,
  replaceGlobalLorebookEntryCollection: vi.fn(),
  resetLorebookHydration: vi.fn(),
  setActiveChatLorebookLocalActivation: lorebookListMocks.setActiveChatLorebookLocalActivation,
  subscribeLorebookEntryDraftRollbacks: vi.fn(() => () => {}),
}))

vi.mock('src/ts/tokenizer', () => ({
  tokenizeAccurate: vi.fn(async () => 0),
}))

import LoreBookListHarness from './LoreBookList.testHarness.svelte'
import LoreBookList from './LoreBookList.svelte'

type MountedComponent = Parameters<typeof unmount>[0]
type LoreBookListHarnessComponent = MountedComponent & {
  getEntries: () => loreBook[]
  setEntries: (entries: loreBook[]) => void
}

let target: HTMLElement
let component: LoreBookListHarnessComponent | undefined
let resourceComponent: MountedComponent | undefined

function makeLoreBook(overrides: Partial<loreBook>): loreBook {
  return {
    key: '',
    secondkey: '',
    insertorder: 100,
    comment: '',
    content: '',
    mode: 'normal',
    alwaysActive: true,
    selective: false,
    ...overrides,
  }
}

function cloneEntries(entries: loreBook[]): loreBook[] {
  return JSON.parse(JSON.stringify(entries)) as loreBook[]
}

function mountHarness(entries: loreBook[]): LoreBookListHarnessComponent {
  return mount(LoreBookListHarness, {
    target,
    props: { initialEntries: entries },
  }) as unknown as LoreBookListHarnessComponent
}

function lorebookRows(): HTMLElement[] {
  return Array.from(target.querySelectorAll<HTMLElement>('[data-risu-lorebook-row="true"]'))
}

function rowByEntryId(entryId: string): HTMLElement {
  const row = lorebookRows().find((candidate) => candidate.dataset.risuLorebookId === entryId)
  expect(row, `lorebook row ${entryId}`).toBeTruthy()
  return row!
}

function rowByText(text: string): HTMLElement {
  const row = lorebookRows().find((candidate) => candidate.textContent?.includes(text))
  expect(row, `lorebook row text ${text}`).toBeTruthy()
  return row!
}

function deleteButtonForRow(row: HTMLElement): HTMLButtonElement {
  const button = row.querySelector<HTMLButtonElement>('[data-risu-lorebook-action="delete"]')
  expect(button, 'lorebook delete button').toBeTruthy()
  return button!
}

function toggleButtonForRow(row: HTMLElement): HTMLButtonElement {
  const button = row.querySelector<HTMLButtonElement>('button.endflex')
  expect(button, 'lorebook detail toggle').toBeTruthy()
  return button!
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await tick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await tick()
}

describe('LoreBookList', () => {
  beforeEach(() => {
    target = document.createElement('div')
    document.body.appendChild(target)
    lorebookListMocks.reset()
    vi.clearAllMocks()
    selectedCharID.set(-1)
    setDatabaseLite({
      characters: [],
      loreBook: [],
      loreBookPage: 0,
    } as Database)
  })

  afterEach(() => {
    if (component) {
      unmount(component)
      component = undefined
    }
    if (resourceComponent) {
      unmount(resourceComponent)
      resourceComponent = undefined
    }
    target.remove()
    document.body.innerHTML = ''
    selectedCharID.set(-1)
    setDatabaseLite({} as Database)
  })

  it('deletes an id-backed row by latest id after siblings are inserted and reordered during confirm', async () => {
    const initialEntries = [
      makeLoreBook({ id: 'entry-a', comment: 'Entry A' }),
      makeLoreBook({ id: 'entry-b', comment: 'Entry B' }),
      makeLoreBook({ id: 'entry-c', comment: 'Entry C' }),
    ]
    const confirm = lorebookListMocks.createDeferred<boolean>()
    lorebookListMocks.queueConfirm(confirm)

    component = mountHarness(initialEntries)
    await tick()

    deleteButtonForRow(rowByEntryId('entry-b')).click()
    await tick()

    component.setEntries([
      makeLoreBook({ id: 'entry-x', comment: 'Inserted Entry' }),
      ...cloneEntries([initialEntries[2], initialEntries[1], initialEntries[0]]),
    ])
    await tick()

    confirm.resolve(true)
    await flushAsyncWork()

    expect(component.getEntries().map((entry) => entry.id)).toEqual(['entry-x', 'entry-c', 'entry-a'])
  })

  it('deletes a cloned folder by folder key and removes latest children after reorder during confirm', async () => {
    const initialEntries = [
      makeLoreBook({ key: 'castle', comment: 'Castle Folder', mode: 'folder' }),
      makeLoreBook({ id: 'castle-child-a', comment: 'Castle Child A', folder: 'castle' }),
      makeLoreBook({ id: 'loose-sibling', comment: 'Loose Sibling' }),
      makeLoreBook({ key: 'forest', comment: 'Forest Folder', mode: 'folder' }),
      makeLoreBook({ id: 'forest-child-a', comment: 'Forest Child A', folder: 'forest' }),
    ]
    const firstConfirm = lorebookListMocks.createDeferred<boolean>()
    lorebookListMocks.queueConfirm(firstConfirm)
    lorebookListMocks.queueConfirm(true)

    component = mountHarness(initialEntries)
    await tick()

    deleteButtonForRow(rowByText('Castle Folder')).click()
    await tick()

    component.setEntries(
      cloneEntries([initialEntries[2], initialEntries[4], initialEntries[3], initialEntries[1], initialEntries[0]]),
    )
    await tick()

    firstConfirm.resolve(true)
    await flushAsyncWork()

    expect(lorebookListMocks.alertConfirm).toHaveBeenCalledTimes(2)
    expect(component.getEntries()).toMatchObject([
      { id: 'loose-sibling', comment: 'Loose Sibling' },
      { id: 'forest-child-a', folder: 'forest' },
      { key: 'forest', mode: 'folder' },
    ])
    expect(component.getEntries().some((entry) => entry.key === 'castle' || entry.folder === 'castle')).toBe(false)
  })

  it('aborts id-less row deletion when the captured index no longer matches the captured snapshot', async () => {
    const initialEntries = [
      makeLoreBook({ comment: 'Legacy A' }),
      makeLoreBook({ comment: 'Legacy Target' }),
      makeLoreBook({ comment: 'Legacy C' }),
    ]
    const confirm = lorebookListMocks.createDeferred<boolean>()
    lorebookListMocks.queueConfirm(confirm)

    component = mountHarness(initialEntries)
    await tick()

    deleteButtonForRow(rowByText('Legacy Target')).click()
    await tick()

    const reorderedEntries = [
      makeLoreBook({ comment: 'Inserted Legacy' }),
      ...cloneEntries([initialEntries[2], initialEntries[1], initialEntries[0]]),
    ]
    component.setEntries(reorderedEntries)
    await tick()

    confirm.resolve(true)
    await flushAsyncWork()

    expect(component.getEntries()).toEqual(reorderedEntries)
  })

  it('still deletes an id-less row when the same captured row remains at the captured index', async () => {
    const initialEntries = [
      makeLoreBook({ comment: 'Legacy A' }),
      makeLoreBook({ comment: 'Legacy Target' }),
      makeLoreBook({ comment: 'Legacy C' }),
    ]
    const confirm = lorebookListMocks.createDeferred<boolean>()
    lorebookListMocks.queueConfirm(confirm)

    component = mountHarness(initialEntries)
    await tick()

    deleteButtonForRow(rowByText('Legacy Target')).click()
    await tick()

    confirm.resolve(true)
    await flushAsyncWork()

    expect(component.getEntries().map((entry) => entry.comment)).toEqual(['Legacy A', 'Legacy C'])
  })

  it('does not poison detail tracking when a closed row is deleted', async () => {
    lorebookListMocks.queueConfirm(true)
    component = mountHarness([
      makeLoreBook({ id: 'entry-a', comment: 'Entry A' }),
      makeLoreBook({ id: 'entry-b', comment: 'Entry B' }),
    ])
    await tick()
    const initialSortableCount = lorebookListMocks.SortableMock.create.mock.calls.length

    deleteButtonForRow(rowByEntryId('entry-a')).click()
    await flushAsyncWork()

    toggleButtonForRow(rowByEntryId('entry-b')).click()
    await tick()
    toggleButtonForRow(rowByEntryId('entry-b')).click()
    await tick()

    expect(lorebookListMocks.SortableMock.create).toHaveBeenCalledTimes(initialSortableCount + 1)
  })

  it('keeps an id-backed detail open across a cloned collection projection', async () => {
    const entries = [
      makeLoreBook({ id: 'entry-a', comment: 'Entry A', content: 'Open content' }),
      makeLoreBook({ id: 'entry-b', comment: 'Entry B' }),
    ]
    component = mountHarness(entries)
    await tick()
    const initialSortableCount = lorebookListMocks.SortableMock.create.mock.calls.length

    toggleButtonForRow(rowByEntryId('entry-a')).click()
    await tick()
    expect(rowByEntryId('entry-a').textContent).toContain('Prompt')

    component.setEntries(cloneEntries(entries))
    await tick()

    expect(rowByEntryId('entry-a').textContent).toContain('Prompt')
    toggleButtonForRow(rowByEntryId('entry-a')).click()
    await tick()
    expect(lorebookListMocks.SortableMock.create).toHaveBeenCalledTimes(initialSortableCount + 1)
  })

  it('reacts to resource-backed character lorebook replacement and dispatches deletion for the current character', async () => {
    setDatabaseLite({
      characters: [
        {
          chaId: 'character-resource',
          chatPage: 0,
          chats: [],
          globalLore: [makeLoreBook({ id: 'resource-entry-a', comment: 'Resource Entry A' })],
        },
      ],
      loreBook: [],
      loreBookPage: 0,
    } as Database)
    selectedCharID.set(0)

    resourceComponent = mount(LoreBookList, { target, props: { submenu: 0 } })
    await tick()
    expect(rowByEntryId('resource-entry-a')).toBeTruthy()

    setDatabaseLite({
      characters: [
        {
          chaId: 'character-resource',
          chatPage: 0,
          chats: [],
          globalLore: [makeLoreBook({ id: 'resource-entry-b', comment: 'Resource Entry B' })],
        },
      ],
      loreBook: [],
      loreBookPage: 0,
    } as Database)
    await tick()
    expect(rowByEntryId('resource-entry-b')).toBeTruthy()
    expect(lorebookRows().some((row) => row.dataset.risuLorebookId === 'resource-entry-a')).toBe(false)

    lorebookListMocks.queueConfirm(true)
    deleteButtonForRow(rowByEntryId('resource-entry-b')).click()
    await flushAsyncWork()

    expect(lorebookListMocks.replaceCharacterLorebookCollection).toHaveBeenCalledWith('character-resource', [])
  })

  it('dispatches a resource-backed local lorebook deletion for the selected chat', async () => {
    setDatabaseLite({
      characters: [
        {
          chaId: 'character-resource',
          chatPage: 1,
          chats: [
            { id: 'chat-inactive', localLore: [] },
            {
              id: 'chat-resource',
              localLore: [makeLoreBook({ id: 'chat-entry', comment: 'Chat Entry' })],
            },
          ],
          globalLore: [],
        },
      ],
      loreBook: [],
      loreBookPage: 0,
    } as Database)
    selectedCharID.set(0)

    resourceComponent = mount(LoreBookList, { target, props: { submenu: 1 } })
    await tick()
    lorebookListMocks.queueConfirm(true)
    deleteButtonForRow(rowByEntryId('chat-entry')).click()
    await flushAsyncWork()

    expect(lorebookListMocks.replaceChatLorebookCollection).toHaveBeenCalledWith('chat-resource', [])
  })
})
