import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loadoutStore = vi.hoisted(() => ({ open: true }))
const loadoutDatabase = vi.hoisted(() => ({ loadouts: [] as Array<Record<string, unknown>> }))
const loadoutMocks = vi.hoisted(() => ({
  applyLoadout: vi.fn(),
  deleteLoadout: vi.fn(),
  saveCurrentLoadout: vi.fn(),
  toggleLoadoutFavorite: vi.fn(),
}))

vi.mock('src/ts/stores.svelte', () => ({
  loadoutModalStore: loadoutStore,
}))
vi.mock('src/ts/server/resourceState.svelte', () => ({
  getResourceDatabase: vi.fn(() => loadoutDatabase),
}))
vi.mock('src/ts/loadout', () => loadoutMocks)
vi.mock('src/ts/storage/database.svelte', () => ({
  getCurrentCharacter: vi.fn(() => null),
}))

import LoadoutModal from './LoadoutModal.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let opener: HTMLButtonElement
let target: HTMLElement

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await tick()
}

beforeEach(() => {
  loadoutStore.open = true
  loadoutDatabase.loadouts = []
  loadoutMocks.applyLoadout.mockReset().mockResolvedValue('applied')
  loadoutMocks.deleteLoadout.mockReset()
  loadoutMocks.saveCurrentLoadout.mockReset()
  loadoutMocks.toggleLoadoutFavorite.mockReset()
  opener = document.createElement('button')
  opener.textContent = 'Open loadouts'
  target = document.createElement('div')
  document.body.append(opener, target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  opener.remove()
  target.remove()
  document.body.innerHTML = ''
})

describe('LoadoutModal focus', () => {
  it('contains focus, closes on owned Escape, and restores the opener', async () => {
    opener.focus()
    component = mount(LoadoutModal, { target })
    await settle()

    const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
    const backdrop = dialog?.parentElement
    const close = dialog?.querySelector<HTMLButtonElement>('[data-modal-initial-focus]')
    if (!dialog || !backdrop || !close) throw new Error('Loadout modal not found')
    expect(backdrop.hasAttribute('data-modal-root')).toBe(true)
    expect(dialog.getAttribute('aria-labelledby')).toBe('risu-loadout-modal-title')
    expect(opener.inert).toBe(true)
    expect(document.activeElement).toBe(close)

    opener.focus()
    expect(document.activeElement).toBe(close)

    const escape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
    close.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(loadoutStore.open).toBe(false)

    unmount(component)
    component = undefined
    await settle()
    expect(opener.inert).toBe(false)
    expect(document.activeElement).toBe(opener)
  })
})

describe('LoadoutModal operations', () => {
  const savedLoadout = {
    id: 'loadout-a',
    name: 'Loadout A',
    lastUsed: 100,
    favorite: false,
    characterIds: [],
    modules: [],
    globalVariables: {},
    presetName: 'Preset A',
    personaId: '',
  }

  it('stays open while applying and reports preset hydration failure', async () => {
    loadoutDatabase.loadouts = [savedLoadout]
    const application = deferred<'preset-hydration-failed'>()
    loadoutMocks.applyLoadout.mockReturnValue(application.promise)
    component = mount(LoadoutModal, { target })
    await settle()

    const apply = target.querySelector<HTMLButtonElement>(
      '[data-risu-loadout-action="apply"][data-risu-loadout-id="loadout-a"]',
    )
    const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
    if (!apply || !dialog) throw new Error('Loadout apply control not found')

    apply.click()
    await tick()

    expect(loadoutStore.open).toBe(true)
    expect(dialog.getAttribute('aria-busy')).toBe('true')
    expect(target.querySelector('[role="status"]')?.textContent).toContain('Loading')

    application.resolve('preset-hydration-failed')
    await settle()

    expect(loadoutStore.open).toBe(true)
    expect(dialog.getAttribute('aria-busy')).toBe('false')
    expect(target.querySelector('[role="alert"]')?.textContent).toContain('Could not load the preset')
  })

  it('clears the save name synchronously so duplicate activation creates one loadout', async () => {
    component = mount(LoadoutModal, { target })
    await settle()

    const input = target.querySelector<HTMLInputElement>('input[type="text"]')
    const save = target.querySelector<HTMLButtonElement>('[data-risu-loadout-action="save"]')
    if (!input || !save) throw new Error('Loadout save controls not found')
    input.value = '  Snapshot  '
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    save.click()
    save.click()

    expect(loadoutMocks.saveCurrentLoadout).toHaveBeenCalledOnce()
    expect(loadoutMocks.saveCurrentLoadout).toHaveBeenCalledWith('Snapshot')
    await tick()
    expect(input.value).toBe('')
  })
})
