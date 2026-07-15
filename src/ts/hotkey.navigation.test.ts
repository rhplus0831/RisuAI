import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const hotkeyNavigationMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}))

vi.mock('./router', () => ({
  navigate: hotkeyNavigationMocks.navigate,
}))

vi.mock('./process/modules', async (importActual) => {
  const actual = await importActual<typeof import('./process/modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

import { initHotkey } from './hotkey'
import { PlaygroundStore, selectedCharID, settingsOpen } from './stores.svelte'
import { testDatabaseState } from './__tests__/resourceDatabaseState'

async function press(key: string, options: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key,
    ...options,
  })
  document.dispatchEvent(event)
  await Promise.resolve()
  return event
}

beforeAll(() => {
  initHotkey()
})

beforeEach(() => {
  hotkeyNavigationMocks.navigate.mockReset()
  settingsOpen.set(false)
  selectedCharID.set(-1)
  PlaygroundStore.set(0)
  testDatabaseState.db = {
    hotkeys: [
      { action: 'settings', ctrl: true, key: 's' },
      { action: 'home', ctrl: true, key: 'h' },
    ],
  }
})

describe('global hotkey route ownership', () => {
  it('routes the Settings shortcut through the router in both directions', async () => {
    await press('s', { ctrlKey: true })
    expect(hotkeyNavigationMocks.navigate).toHaveBeenLastCalledWith('/settings')

    settingsOpen.set(true)
    await press('s', { ctrlKey: true })
    expect(hotkeyNavigationMocks.navigate).toHaveBeenLastCalledWith('/')
  })

  it('routes Home out of settings and playground state', async () => {
    settingsOpen.set(true)
    await press('h', { ctrlKey: true })
    expect(hotkeyNavigationMocks.navigate).toHaveBeenLastCalledWith('/')

    hotkeyNavigationMocks.navigate.mockClear()
    settingsOpen.set(false)
    PlaygroundStore.set(4)
    await press('h', { ctrlKey: true })
    expect(hotkeyNavigationMocks.navigate).toHaveBeenLastCalledWith('/')
  })

  it('routes the global Settings Escape fallback home', async () => {
    settingsOpen.set(true)

    const event = await press('Escape')

    expect(event.defaultPrevented).toBe(true)
    expect(hotkeyNavigationMocks.navigate).toHaveBeenCalledWith('/')
  })

  it('leaves Escape from an editable select to its owning control', async () => {
    settingsOpen.set(true)
    const select = document.createElement('select')
    document.body.appendChild(select)
    select.focus()

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
    })
    select.dispatchEvent(event)

    expect(hotkeyNavigationMocks.navigate).not.toHaveBeenCalled()
    select.remove()
  })

  it('ignores keyboard events already owned by a component', async () => {
    settingsOpen.set(true)
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
    })
    event.preventDefault()

    document.dispatchEvent(event)
    await Promise.resolve()

    expect(hotkeyNavigationMocks.navigate).not.toHaveBeenCalled()
  })
})
