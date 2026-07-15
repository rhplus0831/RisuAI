import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const resetMocks = vi.hoisted(() => ({
  alertConfirm: vi.fn<() => Promise<boolean>>(),
}))

vi.mock('src/ts/alert', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/alert')>()
  return {
    ...actual,
    alertConfirm: resetMocks.alertConfirm,
  }
})

vi.mock('src/ts/process/modules', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/process/modules')>()
  return {
    ...actual,
    getModuleTriggers: () => [],
    moduleUpdate: () => undefined,
  }
})

vi.mock('src/ts/process/request/serverMemory', () => ({
  canUseServerMemoryApi: () => false,
  cancelServerMemoryJob: vi.fn(),
  deleteServerMemorySummary: vi.fn(),
  listServerMemoryJobs: vi.fn(),
  listServerMemorySummaries: vi.fn(),
  patchServerMemorySummary: vi.fn(),
}))

vi.mock('src/ts/server/memoryJobEvents', () => ({
  subscribeServerMemoryJobEvents: () => () => undefined,
}))

import HypaV3Modal from './HypaV3Modal.svelte'
import { hypaV3ModalOpen, selectedCharID } from 'src/ts/stores.svelte'
import { getDatabase, setDatabaseLite } from 'src/ts/storage/database.svelte'

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
              categories: [{ id: 'category-a', name: 'Category A' }],
              lastSelectedSummaries: [],
            },
          },
          {
            id: 'chat-b',
            name: 'Chat B',
            message: [{ chatId: 'message-b', role: 'user', data: 'Message B' }],
            note: '',
            localLore: [],
            hypaV3Data: {
              summaries: [],
              categories: [{ id: 'category-b', name: 'Category B' }],
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

function buttonForIcon(target: HTMLElement, iconClass: string): HTMLButtonElement | null {
  return target.querySelector<SVGElement>(`svg.${iconClass}`)?.closest('button') ?? null
}

describe('Hypa V3 reset ownership', () => {
  let target: HTMLElement
  let component: MountedComponent | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    seedDatabase()
    hypaV3ModalOpen.set(true)
    target = document.createElement('div')
    document.body.appendChild(target)
  })

  afterEach(() => {
    if (component) unmount(component)
    hypaV3ModalOpen.set(false)
    target.remove()
  })

  it('aborts a reset when the active chat changes during the second confirmation', async () => {
    const secondConfirmation = deferred<boolean>()
    resetMocks.alertConfirm.mockResolvedValueOnce(true).mockReturnValueOnce(secondConfirmation.promise)
    component = mount(HypaV3Modal, { target }) as MountedComponent
    await settle()

    const character = getDatabase().characters[0]
    const sourceMemory = character.chats[0].hypaV3Data
    const destinationMemory = character.chats[1].hypaV3Data

    const dropdownButton = buttonForIcon(target, 'lucide-ellipsis-vertical')
    expect(dropdownButton).not.toBeNull()
    dropdownButton!.click()
    await settle()

    const resetButton = buttonForIcon(target, 'lucide-trash-2')
    expect(resetButton).not.toBeNull()
    resetButton!.click()
    await settle()
    expect(resetMocks.alertConfirm).toHaveBeenCalledTimes(2)

    character.chatPage = 1
    await settle()
    secondConfirmation.resolve(true)
    await settle()

    expect(character.chats[0].hypaV3Data).toBe(sourceMemory)
    expect(character.chats[1].hypaV3Data).toBe(destinationMemory)
  })
})
