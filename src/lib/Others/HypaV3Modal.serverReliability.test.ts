import { flushSync, mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const serverMocks = vi.hoisted(() => ({
  listServerMemorySummaries: vi.fn(),
  patchServerMemorySummary: vi.fn(),
  deleteServerMemorySummary: vi.fn(),
  listServerMemoryJobs: vi.fn(),
  cancelServerMemoryJob: vi.fn(),
  hydrateChatMessages: vi.fn<(...args: unknown[]) => Promise<void>>(),
}))

vi.mock('src/ts/process/modules', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/process/modules')>()
  return {
    ...actual,
    getModuleTriggers: () => [],
    moduleUpdate: () => undefined,
  }
})

vi.mock('src/ts/process/request/serverMemory', () => ({
  canUseServerMemoryApi: () => true,
  cancelServerMemoryJob: serverMocks.cancelServerMemoryJob,
  deleteServerMemorySummary: serverMocks.deleteServerMemorySummary,
  listServerMemoryJobs: serverMocks.listServerMemoryJobs,
  listServerMemorySummaries: serverMocks.listServerMemorySummaries,
  patchServerMemorySummary: serverMocks.patchServerMemorySummary,
}))

vi.mock('src/ts/server/chatMessageHydration.svelte', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/server/chatMessageHydration.svelte')>()
  return {
    ...actual,
    hydrateChatMessages: serverMocks.hydrateChatMessages,
  }
})

vi.mock('src/ts/server/memoryJobEvents', () => ({
  subscribeServerMemoryJobEvents: () => () => undefined,
}))

import HypaV3Modal from './HypaV3Modal.svelte'
import { language } from 'src/lang'
import { hypaV3ModalOpen, selectedCharID } from 'src/ts/stores.svelte'
import { setDatabaseLite } from 'src/ts/storage/database.svelte'

type MountedComponent = ReturnType<typeof mount>

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function seedDatabase(categories = [{ id: '', name: 'Unclassified' }]): void {
  selectedCharID.set(0)
  setDatabaseLite({
    hypaV3PresetId: 0,
    hypaV3Presets: [{ name: 'Default', settings: { processRegexScript: false } }],
    characters: [
      {
        chaId: 'character-a',
        name: 'Character',
        image: '',
        chatPage: 0,
        chats: [
          {
            id: 'chat-a',
            name: 'Chat A',
            message: [{ chatId: 'message-a', role: 'user', data: 'Message A' }],
            note: '',
            localLore: [],
            hypaV3Data: {
              summaries: [],
              categories,
              lastSelectedSummaries: [],
            },
          },
        ],
        type: 'character',
      },
    ],
  } as never)
}

async function settle(): Promise<void> {
  flushSync()
  for (let index = 0; index < 6; index += 1) {
    await tick()
    await Promise.resolve()
  }
}

function serverSummary() {
  return {
    id: 'summary-a',
    chatId: 'chat-a',
    chunkId: 'chunk-a',
    model: 'test-model',
    text: 'Persisted summary',
    metadata: { chatMemos: ['message-a'], isImportant: false },
    tokens: 4,
    createdAt: '2026-07-17T00:00:00.000Z',
  }
}

function editSummary(target: HTMLElement, value: string): HTMLTextAreaElement {
  const textarea = Array.from(target.querySelectorAll<HTMLTextAreaElement>('textarea')).find(
    (candidate) => candidate.value === 'Persisted summary',
  )
  if (!textarea) throw new Error('Missing server summary textarea')
  textarea.focus()
  textarea.value = value
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  return textarea
}

function closeModal(target: HTMLElement): void {
  const closeButton = target.querySelector<HTMLButtonElement>(
    `button[aria-label="${language.hypaV3Modal.closeAction}"]`,
  )
  if (!closeButton) throw new Error('Missing Hypa V3 close button')
  closeButton.click()
}

describe('Hypa V3 server summary close reliability', () => {
  let target: HTMLElement
  let component: MountedComponent | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    seedDatabase()
    hypaV3ModalOpen.set(true)
    serverMocks.listServerMemorySummaries.mockResolvedValue({ status: 'ok', summaries: [serverSummary()] })
    serverMocks.patchServerMemorySummary.mockResolvedValue({ status: 'ok', summaryId: 'summary-a' })
    serverMocks.deleteServerMemorySummary.mockResolvedValue({ status: 'ok', summaryId: 'summary-a' })
    serverMocks.listServerMemoryJobs.mockResolvedValue({ status: 'ok', jobs: [], etag: 'jobs-a' })
    serverMocks.hydrateChatMessages.mockResolvedValue(undefined)
    target = document.createElement('div')
    document.body.appendChild(target)
  })

  afterEach(() => {
    if (component) {
      unmount(component)
      component = undefined
    }
    hypaV3ModalOpen.set(false)
    target.remove()
  })

  it('waits for the focused dirty summary PATCH before Escape closes the modal', async () => {
    const patch = deferred<{ status: 'ok'; summaryId: string }>()
    serverMocks.patchServerMemorySummary.mockReturnValueOnce(patch.promise)
    component = mount(HypaV3Modal, { target }) as MountedComponent
    await settle()

    const textarea = editSummary(target, 'Edited before Escape')
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

    await vi.waitFor(() =>
      expect(serverMocks.patchServerMemorySummary).toHaveBeenCalledWith('summary-a', {
        text: 'Edited before Escape',
      }),
    )
    expect(get(hypaV3ModalOpen)).toBe(true)

    patch.resolve({ status: 'ok', summaryId: 'summary-a' })
    await vi.waitFor(() => expect(get(hypaV3ModalOpen)).toBe(false))
    expect(serverMocks.patchServerMemorySummary).toHaveBeenCalledTimes(1)
  })

  it('keeps the modal open when a close-button flush fails', async () => {
    const patch = deferred<{ status: 'error'; error: string }>()
    serverMocks.patchServerMemorySummary.mockReturnValueOnce(patch.promise)
    component = mount(HypaV3Modal, { target }) as MountedComponent
    await settle()

    editSummary(target, 'Edit that cannot persist')
    closeModal(target)

    await vi.waitFor(() => expect(serverMocks.patchServerMemorySummary).toHaveBeenCalledTimes(1))
    expect(get(hypaV3ModalOpen)).toBe(true)

    patch.resolve({ status: 'error', error: 'PATCH rejected' })
    await settle()
    expect(get(hypaV3ModalOpen)).toBe(true)
  })

  it('waits for an Important metadata PATCH before closing', async () => {
    const patch = deferred<{ status: 'ok'; summaryId: string }>()
    serverMocks.patchServerMemorySummary.mockReturnValueOnce(patch.promise)
    component = mount(HypaV3Modal, { target }) as MountedComponent
    await settle()

    target.querySelector<HTMLButtonElement>('button[data-summary-action="important"]')?.click()
    await vi.waitFor(() =>
      expect(serverMocks.patchServerMemorySummary).toHaveBeenCalledWith('summary-a', { isImportant: true }),
    )
    closeModal(target)
    expect(get(hypaV3ModalOpen)).toBe(true)

    patch.resolve({ status: 'ok', summaryId: 'summary-a' })
    await vi.waitFor(() => expect(get(hypaV3ModalOpen)).toBe(false))
  })

  it('waits for a category metadata PATCH before closing', async () => {
    seedDatabase([
      { id: '', name: 'Unclassified' },
      { id: 'story', name: 'Story' },
    ])
    const patch = deferred<{ status: 'ok'; summaryId: string }>()
    serverMocks.patchServerMemorySummary.mockReturnValueOnce(patch.promise)
    component = mount(HypaV3Modal, { target }) as MountedComponent
    await settle()

    const category = target.querySelector<HTMLSelectElement>(
      `select[aria-label="${language.hypaV3Modal.summaryCategoryLabel.replace('{0}', '1')}"]`,
    )
    if (!category) throw new Error('Missing summary category control')
    category.value = 'story'
    category.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() =>
      expect(serverMocks.patchServerMemorySummary).toHaveBeenCalledWith('summary-a', { categoryId: 'story' }),
    )
    closeModal(target)
    expect(get(hypaV3ModalOpen)).toBe(true)

    patch.resolve({ status: 'ok', summaryId: 'summary-a' })
    await vi.waitFor(() => expect(get(hypaV3ModalOpen)).toBe(false))
  })

  it('waits for a tag metadata PATCH before closing', async () => {
    const patch = deferred<{ status: 'ok'; summaryId: string }>()
    serverMocks.patchServerMemorySummary.mockReturnValueOnce(patch.promise)
    component = mount(HypaV3Modal, { target }) as MountedComponent
    await settle()

    const openTags = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes(`+ ${language.hypaV3Modal.tag}`),
    )
    if (!openTags) throw new Error('Missing summary tag manager control')
    openTags.click()
    await settle()
    const tagInput = target.querySelector<HTMLInputElement>(`input[aria-label="${language.hypaV3Modal.newTagName}"]`)
    if (!tagInput) throw new Error('Missing new tag input')
    tagInput.value = 'new-tag'
    tagInput.dispatchEvent(new Event('input', { bubbles: true }))
    tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await vi.waitFor(() =>
      expect(serverMocks.patchServerMemorySummary).toHaveBeenCalledWith('summary-a', { tags: ['new-tag'] }),
    )
    target.querySelector<HTMLButtonElement>(`button[aria-label="${language.close}"]`)?.click()
    await settle()
    closeModal(target)
    expect(get(hypaV3ModalOpen)).toBe(true)

    patch.resolve({ status: 'ok', summaryId: 'summary-a' })
    await vi.waitFor(() => expect(get(hypaV3ModalOpen)).toBe(false))
  })

  it('keeps the modal open when a metadata save fails during close', async () => {
    const patch = deferred<{ status: 'error'; error: string }>()
    serverMocks.patchServerMemorySummary.mockReturnValueOnce(patch.promise)
    component = mount(HypaV3Modal, { target }) as MountedComponent
    await settle()

    target.querySelector<HTMLButtonElement>('button[data-summary-action="important"]')?.click()
    await vi.waitFor(() => expect(serverMocks.patchServerMemorySummary).toHaveBeenCalledTimes(1))
    closeModal(target)
    patch.resolve({ status: 'error', error: 'metadata PATCH rejected' })
    await settle()

    expect(get(hypaV3ModalOpen)).toBe(true)
    await vi.waitFor(() => expect(target.textContent).toContain('metadata PATCH rejected'))
  })

  it('reconciles categories that hydrate after summaries without refetching or patching', async () => {
    serverMocks.listServerMemorySummaries.mockResolvedValue({
      status: 'ok',
      summaries: [
        {
          ...serverSummary(),
          metadata: { chatMemos: ['message-a'], isImportant: true, categoryId: 'story' },
        },
      ],
    })
    component = mount(HypaV3Modal, { target }) as MountedComponent
    await settle()

    const initialSelect = target.querySelector<HTMLSelectElement>(
      `select[aria-label="${language.hypaV3Modal.summaryCategoryLabel.replace('{0}', '1')}"]`,
    )
    expect(initialSelect?.value).toBe('story')
    expect(Array.from(initialSelect?.options ?? []).find((option) => option.value === 'story')?.text).toBe('story')

    seedDatabase([
      { id: '', name: 'Unclassified' },
      { id: 'story', name: 'Story' },
    ])
    await settle()

    const hydratedSelect = target.querySelector<HTMLSelectElement>(
      `select[aria-label="${language.hypaV3Modal.summaryCategoryLabel.replace('{0}', '1')}"]`,
    )
    expect(hydratedSelect?.value).toBe('story')
    expect(Array.from(hydratedSelect?.options ?? []).find((option) => option.value === 'story')?.text).toBe('Story')
    expect(serverMocks.listServerMemorySummaries).toHaveBeenCalledTimes(1)
    expect(serverMocks.patchServerMemorySummary).not.toHaveBeenCalled()
  })
})
