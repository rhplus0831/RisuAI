import { mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializableHypaV3Data, SerializableSummary } from 'src/ts/process/memory/hypav3'
import type { ExpandedMessageState, SearchState, SummaryItemState } from './types'

vi.mock('src/lang', () => ({
  language: {
    hypaV3Modal: {
      summaryNumberLabel: 'Summary {0}',
      tagManager: 'Manage tags',
      tag: 'Tag',
      connectedMessageCountLabel: 'Connected messages ({0})',
      connectedFirstMessageLabel: 'First message',
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
  handleDualAction: vi.fn(() => ({
    destroy: vi.fn(),
    update: vi.fn(),
  })),
  processRegexScript: vi.fn(async (message) => message),
}))

import ModalSummaryItem from './modal-summary-item.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

beforeEach(() => {
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
  it('keeps every available summary action button in the tab order', async () => {
    const summary: SerializableSummary = {
      text: 'Summary text',
      chatMemos: ['message-1'],
      isImportant: false,
      categoryId: '',
      tags: ['story'],
    }
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

    const availableActionButtons = () =>
      Array.from(target.querySelectorAll<HTMLButtonElement>('button')).filter((button) => !button.disabled)

    expect(availableActionButtons()).toHaveLength(10)
    expect(availableActionButtons().every((button) => button.tabIndex === 0)).toBe(true)

    const importantButton = target.querySelector<HTMLButtonElement>('[data-summary-action="important"]')
    const rerollButton = importantButton?.nextElementSibling as HTMLButtonElement | undefined
    expect(rerollButton).toBeTruthy()
    rerollButton?.click()

    await vi.waitFor(() => expect(availableActionButtons()).toHaveLength(13))
    expect(availableActionButtons().every((button) => button.tabIndex === 0)).toBe(true)
  })
})
