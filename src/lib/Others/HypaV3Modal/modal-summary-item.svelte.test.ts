import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { summarize, type SerializableHypaV3Data, type SerializableSummary } from 'src/ts/process/memory/hypav3'
import { translateHTML } from 'src/ts/translator/translator'
import type { ExpandedMessageState, SearchState, SummaryItemState } from './types'

vi.mock('src/lang', () => ({
  language: {
    loading: 'Loading',
    hypaV3Modal: {
      summaryNumberLabel: 'Summary {0}',
      deleteThisConfirmMessage: 'Delete this summary?',
      deleteAfterConfirmMessage: 'Delete summaries after this one?',
      deleteAfterConfirmSecondMessage: 'Are you sure?',
      translationLabel: 'Translation',
      rerolledSummaryLabel: 'Rerolled summary',
      rerolledTranslationLabel: 'Rerolled translation',
      tagManager: 'Manage tags',
      tag: 'Tag',
      connectedMessageCountLabel: 'Connected messages ({0})',
      connectedFirstMessageLabel: 'First message',
      connectedMessageRoleLabel: 'Role: {0}',
      connectedMessageNotFoundLabel: 'Message not found',
      connectedMessageLoadingError: 'Unable to load message: {0}',
      connectedMessageTranslationLabel: 'Translation',
    },
  },
}))

vi.mock('src/ts/process/memory/hypav3', () => ({
  getCurrentHypaV3Preset: vi.fn(() => ({ settings: { processRegexScript: false } })),
  summarize: vi.fn(async () => 'Rerolled summary'),
}))

vi.mock('src/ts/storage/database.svelte', () => ({
  getCurrentChat: vi.fn(() => ({
    message: [{ chatId: 'message-1', role: 'char', data: 'Connected message' }],
  })),
}))

vi.mock('src/ts/translator/translator', () => ({
  translateHTML: vi.fn(async () => 'Translated summary'),
}))

vi.mock('src/ts/alert', () => ({
  alertConfirm: vi.fn(async () => false),
}))

vi.mock('./utils', () => ({
  alertConfirmTwice: vi.fn(async () => false),
  getCategoryName: vi.fn(() => 'Unclassified'),
  getFirstMessage: vi.fn(() => 'First message'),
  handleDualAction: vi.fn(
    (element: HTMLElement, initialParams: { onMainAction?: () => void; onAlternativeAction?: () => void }) => {
      let params = initialParams
      const handleClick = (event: MouseEvent) => {
        if (event.shiftKey) params.onAlternativeAction?.()
        else params.onMainAction?.()
      }
      element.addEventListener('click', handleClick)
      return {
        destroy: () => element.removeEventListener('click', handleClick),
        update: (nextParams: typeof initialParams) => {
          params = nextParams
        },
      }
    },
  ),
  processRegexScript: vi.fn(async (message) => message),
}))

import ModalSummaryItem from './modal-summary-item.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined
const summarizeMock = vi.mocked(summarize)
const translateHTMLMock = vi.mocked(translateHTML)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function mountSummary(summary: SerializableSummary): void {
  const hypaV3Data: SerializableHypaV3Data = { summaries: [summary] }
  component = mount(ModalSummaryItem, {
    target,
    props: {
      summaryIndex: 0,
      hypaV3Data,
      summaryItemStateMap: new WeakMap<SerializableSummary, SummaryItemState>(),
      expandedMessageState: null as unknown as ExpandedMessageState,
      searchState: null as unknown as SearchState,
      filterSelected: false,
      categories: [{ id: '', name: 'Unclassified' }],
    },
  })
}

function actionButton(action: string): HTMLButtonElement {
  const button = target.querySelector<HTMLButtonElement>(`[data-summary-action="${action}"]`)
  if (!button) throw new Error(`Missing ${action} button`)
  return button
}

beforeEach(() => {
  summarizeMock.mockReset().mockResolvedValue('Rerolled summary')
  translateHTMLMock.mockReset().mockResolvedValue('Translated summary')
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('HypaV3 summary item keyboard navigation', () => {
  it('keeps available summary controls in the appropriate tab order', async () => {
    const summary: SerializableSummary = {
      text: 'Summary text',
      chatMemos: ['message-1'],
      isImportant: false,
      categoryId: '',
      tags: ['story'],
    }
    mountSummary(summary)

    const availableActionButtons = () =>
      Array.from(target.querySelectorAll<HTMLButtonElement>('button')).filter((button) => !button.disabled)

    expect(availableActionButtons()).toHaveLength(9)
    expect(availableActionButtons().every((button) => button.tabIndex === 0)).toBe(true)

    const importantButton = target.querySelector<HTMLButtonElement>('[data-summary-action="important"]')
    const rerollButton = importantButton?.nextElementSibling as HTMLButtonElement | undefined
    expect(rerollButton).toBeTruthy()
    rerollButton?.click()

    await vi.waitFor(() => expect(availableActionButtons()).toHaveLength(12))
    expect(availableActionButtons().every((button) => button.tabIndex === 0)).toBe(true)

    const chatMemoButton = availableActionButtons().find((button) => button.textContent?.trim() === 'message-1')
    expect(chatMemoButton).toBeTruthy()
    chatMemoButton?.click()

    await vi.waitFor(() => expect(target.querySelectorAll('textarea[readonly]')).toHaveLength(1))
    const readonlyTextareas = Array.from(target.querySelectorAll<HTMLTextAreaElement>('textarea[readonly]'))
    expect(readonlyTextareas.every((textarea) => textarea.tabIndex === -1)).toBe(true)

    const editableTextareas = Array.from(target.querySelectorAll<HTMLTextAreaElement>('textarea:not([readonly])'))
    expect(editableTextareas).toHaveLength(2)
    expect(editableTextareas.every((textarea) => textarea.tabIndex === 0)).toBe(true)
  })
})

describe('HypaV3 summary item async ownership', () => {
  function createSummary(): SerializableSummary {
    return {
      text: 'Summary text',
      chatMemos: ['message-1'],
      isImportant: false,
      categoryId: '',
      tags: [],
    }
  }

  it('does not apply or restore a reroll after the user cancels it', async () => {
    const pendingReroll = deferred<string>()
    summarizeMock.mockReturnValueOnce(pendingReroll.promise)
    mountSummary(createSummary())

    actionButton('reroll').click()

    await vi.waitFor(() => expect(actionButton('apply-rerolled').disabled).toBe(true))
    expect(target.querySelector<HTMLTextAreaElement>('textarea[readonly]')?.value).toBe('Loading...')

    actionButton('cancel-rerolled').click()
    await tick()
    expect(target.querySelector('[data-summary-action="apply-rerolled"]')).toBeNull()

    pendingReroll.resolve('Late reroll')
    await tick()
    await tick()

    expect(target.querySelector('[data-summary-action="apply-rerolled"]')).toBeNull()
    expect(target.querySelectorAll('textarea')).toHaveLength(1)
  })

  it('discards a rerolled translation when its source is edited', async () => {
    const pendingTranslation = deferred<string>()
    translateHTMLMock.mockReturnValueOnce(pendingTranslation.promise)
    mountSummary(createSummary())

    actionButton('reroll').click()
    await vi.waitFor(() => expect(actionButton('apply-rerolled').disabled).toBe(false))

    actionButton('translate-rerolled').click()
    await vi.waitFor(() => expect(translateHTMLMock).toHaveBeenCalledWith('Rerolled summary', false, '', -1, false))

    const rerolledTextarea = Array.from(target.querySelectorAll<HTMLTextAreaElement>('textarea')).find(
      (textarea) => textarea.value === 'Rerolled summary',
    )
    expect(rerolledTextarea).toBeTruthy()
    if (!rerolledTextarea) return
    rerolledTextarea.value = 'Edited reroll'
    rerolledTextarea.dispatchEvent(new Event('input', { bubbles: true }))

    pendingTranslation.resolve('Translation of the old reroll')
    await tick()
    await tick()

    expect(target.querySelectorAll('textarea')).toHaveLength(2)
    expect(Array.from(target.querySelectorAll('textarea')).some((textarea) => textarea.value.includes('old'))).toBe(
      false,
    )
  })

  it('does not attach an old message translation after the expanded message is replaced', async () => {
    const pendingTranslation = deferred<string>()
    translateHTMLMock.mockReturnValueOnce(pendingTranslation.promise)
    mountSummary(createSummary())

    const messageButton = target.querySelector<HTMLButtonElement>('[data-chat-memo="message-1"]')
    expect(messageButton).toBeTruthy()
    expect(actionButton('translate-message').disabled).toBe(true)
    messageButton?.click()

    await vi.waitFor(() => expect(actionButton('translate-message').disabled).toBe(false))
    actionButton('translate-message').click()
    await vi.waitFor(() => expect(translateHTMLMock).toHaveBeenCalled())

    messageButton?.click()
    messageButton?.click()
    pendingTranslation.resolve('Translation for the abandoned selection')
    await tick()
    await tick()

    await vi.waitFor(() => expect(target.querySelectorAll('textarea[readonly]')).toHaveLength(1))
    expect(target.textContent).not.toContain('Translation for the abandoned selection')
  })
})
