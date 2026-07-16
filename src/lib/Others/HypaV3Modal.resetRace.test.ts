import { flushSync, mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const resetMocks = vi.hoisted(() => ({
  alertConfirm: vi.fn<() => Promise<boolean>>(),
  summarize: vi.fn<(...args: unknown[]) => Promise<string>>(),
  translateHTML: vi.fn<(...args: unknown[]) => Promise<string>>(),
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

vi.mock('src/ts/process/memory/hypav3', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/process/memory/hypav3')>()
  return {
    ...actual,
    summarize: resetMocks.summarize,
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

vi.mock('src/ts/translator/translator', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/translator/translator')>()
  return {
    ...actual,
    translateHTML: resetMocks.translateHTML,
  }
})

import HypaV3Modal from './HypaV3Modal.svelte'
import { language } from 'src/lang'
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

function seedDatabase(withSummaries = false): void {
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
              summaries: withSummaries
                ? [
                    {
                      text: 'Chat A summary one',
                      chatMemos: ['message-a'],
                      isImportant: false,
                    },
                    {
                      text: 'Chat A summary two',
                      chatMemos: ['message-a'],
                      isImportant: false,
                    },
                  ]
                : [],
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
              summaries: withSummaries
                ? [
                    {
                      text: 'Chat B summary one',
                      chatMemos: ['message-b'],
                      isImportant: false,
                    },
                    {
                      text: 'Chat B summary two',
                      chatMemos: ['message-b'],
                      isImportant: false,
                    },
                  ]
                : [],
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

function buttonByText(target: HTMLElement, text: string): HTMLButtonElement | null {
  return (
    Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes(text),
    ) ?? null
  )
}

function buttonByTitle(target: HTMLElement, title: string): HTMLButtonElement | null {
  return (
    Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.title === title) ?? null
  )
}

function hasTextareaValue(target: HTMLElement, value: string): boolean {
  return Array.from(target.querySelectorAll<HTMLTextAreaElement>('textarea')).some(
    (textarea) => textarea.value === value,
  )
}

async function startBulkResummary(target: HTMLElement): Promise<void> {
  const bulkModeButton = buttonForIcon(target, 'lucide-square-pen')
  expect(bulkModeButton).not.toBeNull()
  bulkModeButton!.click()
  await settle()

  const summaryCheckboxes = Array.from(target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
  expect(summaryCheckboxes).toHaveLength(2)
  summaryCheckboxes.forEach((checkbox) => checkbox.click())
  await settle()

  const resummaryButton = buttonByText(target, language.hypaV3Modal.reSummarize)
  expect(resummaryButton).not.toBeNull()
  resummaryButton!.click()
  await settle()
}

describe('Hypa V3 async ownership', () => {
  let background: HTMLElement
  let target: HTMLElement
  let component: MountedComponent | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    resetMocks.alertConfirm.mockReset()
    resetMocks.summarize.mockReset().mockResolvedValue('Default merged summary')
    resetMocks.translateHTML.mockReset().mockResolvedValue('Default translation')
    seedDatabase()
    hypaV3ModalOpen.set(true)
    background = document.createElement('div')
    target = document.createElement('div')
    document.body.appendChild(background)
    document.body.appendChild(target)
  })

  afterEach(() => {
    if (component) unmount(component)
    hypaV3ModalOpen.set(false)
    background.remove()
    target.remove()
  })

  it('closes safely when route navigation removes its character owner', async () => {
    component = mount(HypaV3Modal, { target }) as MountedComponent
    await settle()

    selectedCharID.set(-1)
    await settle()

    expect(get(hypaV3ModalOpen)).toBe(false)
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

  it('keeps search result navigation in the keyboard tab order', async () => {
    seedDatabase(true)
    component = mount(HypaV3Modal, { target }) as MountedComponent
    await settle()

    const searchButton = buttonForIcon(target, 'lucide-search')
    expect(searchButton).not.toBeNull()
    searchButton!.click()
    await settle()

    const previousButton = buttonForIcon(target, 'lucide-chevron-up')
    const nextButton = buttonForIcon(target, 'lucide-chevron-down')
    const searchInput = target.querySelector<HTMLInputElement>(
      `input[placeholder="${language.hypaV3Modal.searchPlaceholder}"]`,
    )
    expect(previousButton?.tabIndex).toBe(0)
    expect(nextButton?.tabIndex).toBe(0)
    expect(searchInput?.getAttribute('aria-label')).toBe(language.hypaV3Modal.searchAction)
    expect(previousButton?.getAttribute('aria-label')).toBe(language.hypaV3Modal.previousSearchResultAction)
    expect(previousButton?.title).toBe(language.hypaV3Modal.previousSearchResultAction)
    expect(nextButton?.getAttribute('aria-label')).toBe(language.hypaV3Modal.nextSearchResultAction)
    expect(nextButton?.title).toBe(language.hypaV3Modal.nextSearchResultAction)
    expect(previousButton?.getAttribute('aria-label')).not.toBe(nextButton?.getAttribute('aria-label'))
  })

  it('provides names and tooltips for live bulk-edit and re-summarization controls', async () => {
    seedDatabase(true)
    component = mount(HypaV3Modal, { target }) as MountedComponent
    await settle()

    const bulkModeButton = buttonForIcon(target, 'lucide-square-pen')
    expect(bulkModeButton).not.toBeNull()
    bulkModeButton!.click()
    await settle()

    const bulkCategory = target.querySelector<HTMLSelectElement>(
      `select[aria-label="${language.hypaV3Modal.bulkCategoryLabel}"]`,
    )
    const bulkSelection = target.querySelector<HTMLInputElement>(
      `input[aria-label="${language.hypaV3Modal.bulkSelectionInputLabel}"]`,
    )
    const bulkImportant = target.querySelector<HTMLButtonElement>(
      `button[aria-label="${language.hypaV3Modal.toggleBulkImportantAction}"]`,
    )
    expect(bulkCategory).not.toBeNull()
    expect(bulkSelection).not.toBeNull()
    expect(bulkImportant?.title).toBe(language.hypaV3Modal.toggleBulkImportantAction)

    const summaryCheckboxes = Array.from(target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    summaryCheckboxes.forEach((checkbox) => checkbox.click())
    await settle()
    const resummaryButton = buttonByText(target, language.hypaV3Modal.reSummarize)
    expect(resummaryButton).not.toBeNull()
    resummaryButton!.click()
    await settle()

    const actionLabels = [
      language.hypaV3Modal.toggleResummaryTranslationAction,
      language.hypaV3Modal.retryResummaryAction,
      language.hypaV3Modal.applyResummaryAction,
      language.hypaV3Modal.cancelResummaryAction,
    ]
    for (const label of actionLabels) {
      const button = target.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
      expect(button?.title).toBe(label)
    }

    const result = target.querySelector<HTMLTextAreaElement>(
      'textarea[aria-labelledby="hypav3-resummary-result-label"]',
    )
    expect(result?.value).toBe('Default merged summary')

    target
      .querySelector<HTMLButtonElement>(`button[aria-label="${language.hypaV3Modal.toggleResummaryTranslationAction}"]`)
      ?.click()
    await settle()
    expect(
      target.querySelector<HTMLTextAreaElement>('textarea[aria-labelledby="hypav3-resummary-translation-label"]')
        ?.value,
    ).toBe('Default translation')
  })

  it('programmatically names the next-summarization preview', async () => {
    component = mount(HypaV3Modal, { target }) as MountedComponent
    await settle()

    const preview = target.querySelector<HTMLTextAreaElement>(
      'textarea[aria-labelledby="hypav3-next-summarization-label"]',
    )
    expect(preview).not.toBeNull()
    expect(target.querySelector('#hypav3-next-summarization-label')?.textContent?.trim()).toBeTruthy()
  })

  it('traps focus across the main, category, and tag dialogs while preserving edit Escape', async () => {
    seedDatabase(true)
    const memory = getDatabase().characters[0].chats[0].hypaV3Data!
    memory.summaries[0].tags = ['existing']
    const opener = document.createElement('button')
    background.appendChild(opener)
    opener.focus()

    component = mount(HypaV3Modal, { target }) as MountedComponent
    await settle()

    const mainDialog = target.querySelector<HTMLElement>(
      `[role="dialog"][aria-label="${language.hypaV3Modal.titleLabel}"]`,
    )
    const mainClose = target.querySelector<HTMLButtonElement>(
      `button[aria-label="${language.hypaV3Modal.closeAction}"]`,
    )
    expect(mainDialog?.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(mainClose)
    expect(background.inert).toBe(true)

    const categoryTrigger = target.querySelector<HTMLButtonElement>(
      `button[aria-label="${language.hypaV3Modal.categoryManagerAction}"]`,
    )
    expect(categoryTrigger).not.toBeNull()
    categoryTrigger!.focus()
    categoryTrigger!.click()
    await settle()

    const categoryDialog = target.querySelector<HTMLElement>(
      `[role="dialog"][aria-label="${language.hypaV3Modal.categoryManager}"]`,
    )
    const categoryClose = categoryDialog?.querySelector<HTMLButtonElement>(`button[aria-label="${language.close}"]`)
    const addCategory = categoryDialog?.querySelector<HTMLButtonElement>(
      `button[aria-label="${language.hypaV3Modal.addCategoryAction}"]`,
    )
    const editCategory = categoryDialog?.querySelector<HTMLButtonElement>(
      `button[aria-label="${language.hypaV3Modal.editCategoryAction}"]`,
    )
    const deleteCategory = categoryDialog?.querySelector<HTMLButtonElement>(
      `button[aria-label="${language.hypaV3Modal.deleteCategoryAction}"]`,
    )
    expect(categoryDialog?.getAttribute('aria-modal')).toBe('true')
    expect(mainDialog?.closest<HTMLElement>('[data-modal-root]')?.inert).toBe(true)
    expect(document.activeElement).toBe(categoryClose)
    expect(categoryClose?.title).toBe(language.close)
    expect(addCategory?.title).toBe(language.hypaV3Modal.addCategoryAction)
    expect(editCategory?.title).toBe(language.hypaV3Modal.editCategoryAction)
    expect(deleteCategory?.title).toBe(language.hypaV3Modal.deleteCategoryAction)

    mainClose!.focus()
    expect(document.activeElement).toBe(categoryClose)
    categoryClose!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await settle()

    expect(categoryDialog?.isConnected).toBe(false)
    expect(document.activeElement).toBe(categoryTrigger)

    const tagTrigger = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === '#existing',
    )
    expect(tagTrigger).toBeDefined()
    tagTrigger!.focus()
    tagTrigger!.click()
    await settle()

    const tagLabel = language.hypaV3Modal.tagManagerTitle.replace('{0}', '1')
    const tagDialog = target.querySelector<HTMLElement>(`[role="dialog"][aria-label="${tagLabel}"]`)
    const tagClose = tagDialog?.querySelector<HTMLButtonElement>(`button[aria-label="${language.close}"]`)
    expect(tagDialog?.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(tagClose)
    expect(tagClose?.title).toBe(language.close)

    const editButton = buttonForIcon(tagDialog!, 'lucide-square-pen')
    expect(editButton).not.toBeNull()
    expect(editButton?.getAttribute('aria-label')).toBe(language.hypaV3Modal.editTagAction)
    expect(editButton?.title).toBe(language.hypaV3Modal.editTagAction)
    editButton!.click()
    await settle()

    const saveTag = tagDialog?.querySelector<HTMLButtonElement>(
      `button[aria-label="${language.hypaV3Modal.saveTagAction}"]`,
    )
    const cancelTagEdit = tagDialog?.querySelector<HTMLButtonElement>(
      `button[aria-label="${language.hypaV3Modal.cancelTagEditAction}"]`,
    )
    expect(saveTag?.title).toBe(language.hypaV3Modal.saveTagAction)
    expect(cancelTagEdit?.title).toBe(language.hypaV3Modal.cancelTagEditAction)

    const editInputs = Array.from(tagDialog!.querySelectorAll<HTMLInputElement>('input[type="text"]'))
    expect(editInputs).toHaveLength(2)
    const editInput = editInputs[1]
    editInput.focus()
    const cancelEdit = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    editInput.dispatchEvent(cancelEdit)
    await settle()

    expect(cancelEdit.defaultPrevented).toBe(true)
    expect(tagDialog?.isConnected).toBe(true)
    expect(target.textContent).toContain('#existing')

    tagClose!.focus()
    tagClose!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await settle()

    expect(tagDialog?.isConnected).toBe(false)
    expect(document.activeElement).toBe(tagTrigger)

    tagTrigger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(get(hypaV3ModalOpen)).toBe(false)
    unmount(component)
    component = undefined
    await settle()

    expect(background.inert).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it('advances only once when Enter submits a search', async () => {
    seedDatabase(true)
    component = mount(HypaV3Modal, { target }) as MountedComponent
    await settle()

    const searchButton = buttonForIcon(target, 'lucide-search')
    expect(searchButton).not.toBeNull()
    searchButton!.click()
    await settle()

    const searchInput = target.querySelector<HTMLInputElement>(
      `input[placeholder="${language.hypaV3Modal.searchPlaceholder}"]`,
    )
    const searchForm = searchInput?.closest('form')
    expect(searchInput).not.toBeNull()
    expect(searchForm).not.toBeNull()

    searchInput!.value = 'summary'
    searchInput!.dispatchEvent(new Event('input', { bubbles: true }))
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    searchInput!.dispatchEvent(enter)
    if (!enter.defaultPrevented) {
      searchForm!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    }
    await settle()

    expect(target.textContent).toContain('1/2')
    expect(target.textContent).not.toContain('2/2')
  })

  it('cancels a delayed search focus restore when the modal unmounts', async () => {
    vi.useFakeTimers()
    try {
      seedDatabase(true)
      component = mount(HypaV3Modal, { target }) as MountedComponent
      await settle()

      const searchButton = buttonForIcon(target, 'lucide-search')
      expect(searchButton).not.toBeNull()
      searchButton!.click()
      await settle()

      const searchInput = target.querySelector<HTMLInputElement>(
        `input[placeholder="${language.hypaV3Modal.searchPlaceholder}"]`,
      )
      expect(searchInput).not.toBeNull()

      searchInput!.value = 'summary'
      searchInput!.dispatchEvent(new Event('input', { bubbles: true }))
      searchInput!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      await settle()

      const matchedSummary = Array.from(target.querySelectorAll<HTMLTextAreaElement>('textarea')).find((textarea) =>
        textarea.value.includes('summary'),
      )
      expect(matchedSummary?.readOnly).toBe(true)

      unmount(component)
      component = undefined

      expect(matchedSummary?.readOnly).toBe(false)
      expect(() => vi.advanceTimersByTime(300)).not.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not delete the summary that replaces a removed target during confirmation', async () => {
    seedDatabase(true)
    const pendingConfirmation = deferred<boolean>()
    resetMocks.alertConfirm.mockReturnValueOnce(pendingConfirmation.promise)
    component = mount(HypaV3Modal, { target }) as MountedComponent
    await settle()

    const memory = getDatabase().characters[0].chats[0].hypaV3Data!
    const removedSummary = memory.summaries[0]
    const survivingSummary = memory.summaries[1]
    const deleteButtons = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).filter((button) =>
      button.querySelector('svg.lucide-trash-2'),
    )
    expect(deleteButtons).toHaveLength(2)

    deleteButtons[0].click()
    await settle()
    expect(resetMocks.alertConfirm).toHaveBeenCalledOnce()

    memory.summaries.splice(0, 1)
    await settle()
    expect(memory.summaries).toEqual([survivingSummary])

    pendingConfirmation.resolve(true)
    await settle()

    expect(memory.summaries).toEqual([survivingSummary])
    expect(memory.summaries).not.toContain(removedSummary)
  })

  it('does not resurrect a canceled bulk resummary after deferred completion', async () => {
    seedDatabase(true)
    const pendingSummary = deferred<string>()
    resetMocks.summarize.mockReturnValueOnce(pendingSummary.promise)
    component = mount(HypaV3Modal, { target }) as MountedComponent
    await settle()

    await startBulkResummary(target)
    expect(resetMocks.summarize).toHaveBeenCalledOnce()

    const cancelButton = buttonByTitle(target, language.hypaV3Modal.cancelResummaryAction)
    expect(cancelButton).not.toBeNull()
    cancelButton!.click()
    await settle()

    pendingSummary.resolve('Canceled stale summary')
    await settle()

    expect(hasTextareaValue(target, 'Canceled stale summary')).toBe(false)
    expect(getDatabase().characters[0].chats[0].hypaV3Data?.summaries.map((summary) => summary.text)).toEqual([
      'Chat A summary one',
      'Chat A summary two',
    ])
  })

  it('drops a deferred bulk resummary when its chat owner changes', async () => {
    seedDatabase(true)
    const pendingSummary = deferred<string>()
    resetMocks.summarize.mockReturnValueOnce(pendingSummary.promise)
    component = mount(HypaV3Modal, { target }) as MountedComponent
    await settle()

    await startBulkResummary(target)
    const character = getDatabase().characters[0]
    character.chatPage = 1
    await settle()

    pendingSummary.resolve('Wrong chat summary')
    await settle()

    expect(hasTextareaValue(target, 'Wrong chat summary')).toBe(false)
    expect(character.chats[0].hypaV3Data?.summaries.map((summary) => summary.text)).toEqual([
      'Chat A summary one',
      'Chat A summary two',
    ])
    expect(character.chats[1].hypaV3Data?.summaries.map((summary) => summary.text)).toEqual([
      'Chat B summary one',
      'Chat B summary two',
    ])
  })

  it('ignores a deferred bulk translation after cancellation', async () => {
    seedDatabase(true)
    const pendingTranslation = deferred<string>()
    resetMocks.summarize.mockResolvedValueOnce('Merged summary')
    resetMocks.translateHTML.mockReturnValueOnce(pendingTranslation.promise)
    component = mount(HypaV3Modal, { target }) as MountedComponent
    await settle()

    await startBulkResummary(target)
    expect(hasTextareaValue(target, 'Merged summary')).toBe(true)

    const translateButton = buttonByTitle(target, language.hypaV3Modal.toggleResummaryTranslationAction)
    expect(translateButton).not.toBeNull()
    translateButton!.click()
    await settle()
    expect(resetMocks.translateHTML).toHaveBeenCalledOnce()

    const cancelButton = buttonByTitle(target, language.hypaV3Modal.cancelResummaryAction)
    expect(cancelButton).not.toBeNull()
    cancelButton!.click()
    await settle()

    pendingTranslation.resolve('Canceled stale translation')
    await settle()

    expect(hasTextareaValue(target, 'Merged summary')).toBe(false)
    expect(hasTextareaValue(target, 'Canceled stale translation')).toBe(false)
  })
})
