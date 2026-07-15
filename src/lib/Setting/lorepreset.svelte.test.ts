import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lorepresetMocks = vi.hoisted(() => ({
  alertConfirm: vi.fn(),
  createGlobalLorebook: vi.fn(),
  deleteGlobalLorebook: vi.fn(),
  deleteGlobalLorebookById: vi.fn(),
  renameGlobalLorebook: vi.fn(),
  renameGlobalLorebookById: vi.fn(),
  selectGlobalLorebook: vi.fn(),
}))

vi.mock('../../ts/alert', async (importActual) => ({
  ...(await importActual<typeof import('../../ts/alert')>()),
  alertConfirm: lorepresetMocks.alertConfirm,
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

vi.mock('src/ts/server/lorebookBridge.svelte', () => ({
  applyServerCharacterLorebookResource: vi.fn(() => true),
  createGlobalLorebook: lorepresetMocks.createGlobalLorebook,
  deleteGlobalLorebook: lorepresetMocks.deleteGlobalLorebook,
  deleteGlobalLorebookById: lorepresetMocks.deleteGlobalLorebookById,
  flushPendingServerBackedLorebookPatches: vi.fn(async () => {}),
  isCharacterLorebookHydrated: vi.fn(() => true),
  isCharacterLorebookMutationReady: vi.fn(() => true),
  markCharacterLorebookHydrated: vi.fn(),
  recordHydratedCharacterLorebooks: vi.fn(),
  renameGlobalLorebook: lorepresetMocks.renameGlobalLorebook,
  renameGlobalLorebookById: lorepresetMocks.renameGlobalLorebookById,
  resetLorebookHydration: vi.fn(),
  selectGlobalLorebook: lorepresetMocks.selectGlobalLorebook,
  watchServerBackedLorebooks: vi.fn(() => () => {}),
}))

import Lorepreset from './lorepreset.svelte'
import { language } from '../../lang'
import {
  getResourceDatabase as getDatabase,
  replaceResourceDatabase as setDatabaseLite,
} from 'src/ts/server/resourceState.svelte'

type MountedComponent = Parameters<typeof unmount>[0]
type LorebookFixture = { id: string; name: string; data: never[] }

let target: HTMLElement
let component: MountedComponent | undefined

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function lorebook(id: string, name: string): LorebookFixture {
  return { id, name, data: [] }
}

function projectLorebooks(loreBook: LorebookFixture[]): void {
  setDatabaseLite({ characters: [], loreBook, loreBookPage: 0, modules: [] } as never)
}

function lorebookIds(): string[] {
  return (getDatabase().loreBook as LorebookFixture[]).map((book) => book.id)
}

function deleteButton(name: string): HTMLButtonElement {
  const button = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.remove}: ${name}"]`)
  if (!button) throw new Error(`delete button not found for ${name}`)
  return button
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  lorepresetMocks.alertConfirm.mockReset()
  lorepresetMocks.deleteGlobalLorebookById.mockReset()
  lorepresetMocks.deleteGlobalLorebookById.mockImplementation((lorebookId: string) => {
    const loreBook = getDatabase().loreBook as LorebookFixture[]
    const matchingIndices = loreBook.flatMap((book, index) => (book.id === lorebookId ? [index] : []))
    if (loreBook.length <= 1 || matchingIndices.length !== 1) return false
    projectLorebooks(loreBook.filter((_, index) => index !== matchingIndices[0]))
    return true
  })
  lorepresetMocks.renameGlobalLorebookById.mockReset()
  lorepresetMocks.renameGlobalLorebookById.mockImplementation((lorebookId: string, name: string) => {
    const loreBook = getDatabase().loreBook as LorebookFixture[]
    const matchingIndices = loreBook.flatMap((book, index) => (book.id === lorebookId ? [index] : []))
    if (matchingIndices.length !== 1) return false
    projectLorebooks(loreBook.map((book, index) => (index === matchingIndices[0] ? { ...book, name } : { ...book })))
    return true
  })
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  setDatabaseLite({} as never)
})

describe('global lorebook modal targeting', () => {
  it('deletes the confirmed lorebook by id after an authoritative reorder', async () => {
    projectLorebooks([lorebook('g1', 'First'), lorebook('g2', 'Second'), lorebook('g3', 'Third')])
    const confirmation = deferred<boolean>()
    lorepresetMocks.alertConfirm.mockReturnValue(confirmation.promise)
    component = mount(Lorepreset, { target })
    await tick()

    deleteButton('Second').click()
    await tick()
    expect(lorepresetMocks.alertConfirm).toHaveBeenCalledWith(`${language.removeConfirm}Second`)

    projectLorebooks([lorebook('g3', 'Third'), lorebook('g1', 'First'), lorebook('g2', 'Second')])
    await tick()
    confirmation.resolve(true)
    await tick()
    await Promise.resolve()

    expect(lorebookIds()).toEqual(['g3', 'g1'])
    expect(lorepresetMocks.deleteGlobalLorebookById).toHaveBeenCalledWith('g2')
  })

  it('does not delete a sibling when the confirmed lorebook vanished', async () => {
    projectLorebooks([lorebook('g1', 'First'), lorebook('g2', 'Second'), lorebook('g3', 'Third')])
    const confirmation = deferred<boolean>()
    lorepresetMocks.alertConfirm.mockReturnValue(confirmation.promise)
    component = mount(Lorepreset, { target })
    await tick()

    deleteButton('Second').click()
    await tick()
    projectLorebooks([lorebook('g1', 'First'), lorebook('g3', 'Third')])
    await tick()
    confirmation.resolve(true)
    await tick()
    await Promise.resolve()

    expect(lorebookIds()).toEqual(['g1', 'g3'])
    expect(lorepresetMocks.deleteGlobalLorebookById).toHaveBeenCalledWith('g2')
  })

  it('keeps an active rename bound to its lorebook after an authoritative reorder', async () => {
    projectLorebooks([lorebook('g1', 'First'), lorebook('g2', 'Second')])
    component = mount(Lorepreset, { target })
    await tick()

    target.querySelector<HTMLButtonElement>(`button[aria-label="${language.edit}"]`)?.click()
    await tick()
    const firstInput = Array.from(target.querySelectorAll<HTMLInputElement>('input')).find(
      (input) => input.value === 'First',
    )
    expect(firstInput).toBeTruthy()

    projectLorebooks([lorebook('g2', 'Second'), lorebook('g1', 'First')])
    await tick()
    firstInput!.value = 'First renamed'
    firstInput!.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    expect((getDatabase().loreBook as LorebookFixture[]).find((book) => book.id === 'g1')?.name).toBe('First renamed')
    expect((getDatabase().loreBook as LorebookFixture[]).find((book) => book.id === 'g2')?.name).toBe('Second')
    expect(lorepresetMocks.renameGlobalLorebookById).toHaveBeenCalledWith('g1', 'First renamed')
  })

  it('renders malformed duplicate lorebook ids without duplicate each keys', async () => {
    projectLorebooks([lorebook('duplicate', 'First'), lorebook('duplicate', 'Second')])

    component = mount(Lorepreset, { target })
    await tick()

    expect(deleteButton('First')).toBeTruthy()
    expect(deleteButton('Second')).toBeTruthy()
  })
})
