import { mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BulkEditState, CategoryManagerState, FilterState, UIState } from './types'

vi.mock('src/lang', () => ({
  language: { hypaV3Modal: { titleLabel: 'HypaV3' } },
}))

vi.mock('src/ts/stores.svelte', async () => {
  const { writable } = await import('svelte/store')
  return {
    hypaV3ModalOpen: writable(true),
    settingsOpen: writable(false),
    SettingsMenuIndex: writable(0),
  }
})

import ModalHeader from './modal-header.svelte'

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

describe('HypaV3 modal header keyboard navigation', () => {
  it('keeps every available header action in the tab order', () => {
    const bulkEditState: BulkEditState = {
      isEnabled: false,
      selectedSummaries: new Set(),
      selectedCategory: '',
      bulkSelectInput: '',
    }
    const categoryManagerState: CategoryManagerState = {
      isOpen: false,
      editingCategory: null,
      selectedCategoryFilter: '',
    }
    const filterState: FilterState = {
      showImportantOnly: false,
      selectedCategoryFilter: '',
      isManualImportantToggle: false,
    }
    const uiState: UIState = { collapsedSummaries: new Set(), dropdownOpen: true }

    component = mount(ModalHeader, {
      target,
      props: {
        searchState: null as never,
        filterImportant: false,
        dropdownOpen: true,
        filterSelected: false,
        bulkEditState,
        categoryManagerState,
        filterState,
        uiState,
        hypaV3Data: { summaries: [] },
      },
    })

    const buttons = Array.from(target.querySelectorAll<HTMLButtonElement>('button'))
    expect(buttons).toHaveLength(9)
    expect(buttons.every((button) => button.tabIndex === 0)).toBe(true)
  })
})
