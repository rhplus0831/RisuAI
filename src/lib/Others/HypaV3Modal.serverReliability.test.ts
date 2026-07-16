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

function seedDatabase(): void {
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
              categories: [{ id: '', name: 'Unclassified' }],
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
    const closeButton = target.querySelector<HTMLButtonElement>(
      `button[aria-label="${language.hypaV3Modal.closeAction}"]`,
    )
    expect(closeButton).not.toBeNull()
    closeButton!.click()

    await vi.waitFor(() => expect(serverMocks.patchServerMemorySummary).toHaveBeenCalledTimes(1))
    expect(get(hypaV3ModalOpen)).toBe(true)

    patch.resolve({ status: 'error', error: 'PATCH rejected' })
    await settle()
    expect(get(hypaV3ModalOpen)).toBe(true)
  })
})
