import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const databaseState = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))

vi.mock('../storage/database.svelte', () => ({
  getDatabase: () => databaseState.value,
}))

import { sideBarSize, textAreaSize, textAreaTextSize, updateGuisize } from './guisize'

beforeEach(() => {
  databaseState.value = {}
  textAreaSize.set(0)
  textAreaTextSize.set(0)
  sideBarSize.set(0)
  document.documentElement.style.removeProperty('--sidebar-size')
})

describe('GUI size projection effects', () => {
  it('applies a shell-only sidebar size without clobbering deferred textarea sizes', () => {
    textAreaSize.set(2)
    textAreaTextSize.set(3)
    databaseState.value = { sideBarSize: 1 }

    updateGuisize()

    expect(get(sideBarSize)).toBe(1)
    expect(get(textAreaSize)).toBe(2)
    expect(get(textAreaTextSize)).toBe(3)
    expect(document.documentElement.style.getPropertyValue('--sidebar-size')).toBe('28rem')
  })

  it('updates every size when a complete display projection is present', () => {
    databaseState.value = { sideBarSize: 2, textAreaSize: 4, textAreaTextSize: -1 }

    updateGuisize()

    expect(get(sideBarSize)).toBe(2)
    expect(get(textAreaSize)).toBe(4)
    expect(get(textAreaTextSize)).toBe(-1)
    expect(document.documentElement.style.getPropertyValue('--sidebar-size')).toBe('32rem')
  })
})
