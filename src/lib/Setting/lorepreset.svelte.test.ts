import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lorepresetMocks = vi.hoisted(() => ({
  alertConfirm: vi.fn(),
  alertError: vi.fn(),
  alertNormal: vi.fn(),
  createGlobalLorebook: vi.fn(),
  deleteGlobalLorebook: vi.fn(),
  deleteGlobalLorebookById: vi.fn(),
  deleteGlobalLorebookWithOutcome: vi.fn(),
  deleteGlobalLorebookByIdWithOutcome: vi.fn(),
  deleteStateListener: null as null | ((states: MockGlobalLorebookDeleteState[]) => void),
  renameGlobalLorebook: vi.fn(),
  renameGlobalLorebookById: vi.fn(),
}))

const pageOwnerMocks = vi.hoisted(() => ({
  listeners: new Set<(snapshot: any) => void>(),
  retry: vi.fn(),
  select: vi.fn(),
  snapshot: {
    resource: 'loreBookPage',
    status: 'unloaded',
    revision: null,
    state: { present: false },
    error: null,
    mutation: { status: 'idle' },
  } as any,
}))

vi.mock('../../ts/alert', async (importActual) => ({
  ...(await importActual<typeof import('../../ts/alert')>()),
  alertConfirm: lorepresetMocks.alertConfirm,
  alertError: lorepresetMocks.alertError,
  alertNormal: lorepresetMocks.alertNormal,
}))

vi.mock('src/ts/server/lorebookPageOwner.svelte', () => ({
  lorebookPageIndexFromSnapshot: (snapshot: any) =>
    snapshot.state.present && Number.isInteger(snapshot.state.value) && snapshot.state.value >= 0
      ? snapshot.state.value
      : null,
  lorebookPageOwner: {
    retry: pageOwnerMocks.retry,
    select: pageOwnerMocks.select,
  },
  lorebookPageOwnerState: {
    subscribe(listener: (snapshot: any) => void) {
      pageOwnerMocks.listeners.add(listener)
      listener(structuredClone(pageOwnerMocks.snapshot))
      return () => pageOwnerMocks.listeners.delete(listener)
    },
  },
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
  deleteGlobalLorebookWithOutcome: lorepresetMocks.deleteGlobalLorebookWithOutcome,
  deleteGlobalLorebookByIdWithOutcome: lorepresetMocks.deleteGlobalLorebookByIdWithOutcome,
  flushPendingServerBackedLorebookPatches: vi.fn(async () => {}),
  isCharacterLorebookHydrated: vi.fn(() => true),
  isCharacterLorebookMutationReady: vi.fn(() => true),
  markCharacterLorebookHydrated: vi.fn(),
  recordHydratedCharacterLorebooks: vi.fn(),
  renameGlobalLorebook: lorepresetMocks.renameGlobalLorebook,
  renameGlobalLorebookById: lorepresetMocks.renameGlobalLorebookById,
  resetLorebookHydration: vi.fn(),
  subscribeGlobalLorebookDeleteStates: (listener: (states: MockGlobalLorebookDeleteState[]) => void) => {
    lorepresetMocks.deleteStateListener = listener
    listener([])
    return () => {
      if (lorepresetMocks.deleteStateListener === listener) lorepresetMocks.deleteStateListener = null
    }
  },
  watchServerBackedLorebooks: vi.fn(() => () => {}),
}))

import Lorepreset from './lorepreset.svelte'
import { language } from '../../lang'
import {
  collectionsResourceState,
  getResourceDatabase as getDatabase,
  replaceResourceDatabase as setDatabaseLite,
} from 'src/ts/server/resourceState.svelte'

type MountedComponent = Parameters<typeof unmount>[0]
type LorebookFixture = { id: string; name: string; data: never[] }
type MockGlobalLorebookDeleteState = {
  lorebookId: string
  mutationId: string
  status: 'deleting' | 'queued' | 'failed'
}

let target: HTMLElement
let component: MountedComponent | undefined

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

async function settle(): Promise<void> {
  await tick()
  await Promise.resolve()
  await Promise.resolve()
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

async function publishDeleteStates(states: MockGlobalLorebookDeleteState[]): Promise<void> {
  lorepresetMocks.deleteStateListener?.(states)
  await tick()
}

async function publishPageOwnerSnapshot(snapshot: any): Promise<void> {
  pageOwnerMocks.snapshot = structuredClone(snapshot)
  for (const listener of pageOwnerMocks.listeners) listener(structuredClone(pageOwnerMocks.snapshot))
  await tick()
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  lorepresetMocks.alertConfirm.mockReset()
  lorepresetMocks.alertError.mockReset()
  lorepresetMocks.alertNormal.mockReset()
  lorepresetMocks.deleteStateListener = null
  lorepresetMocks.deleteGlobalLorebook.mockReset()
  lorepresetMocks.deleteGlobalLorebookById.mockReset()
  lorepresetMocks.deleteGlobalLorebookById.mockImplementation((lorebookId: string) => {
    const loreBook = getDatabase().loreBook as LorebookFixture[]
    const matchingIndices = loreBook.flatMap((book, index) => (book.id === lorebookId ? [index] : []))
    if (loreBook.length <= 1 || matchingIndices.length !== 1) return false
    projectLorebooks(loreBook.filter((_, index) => index !== matchingIndices[0]))
    return true
  })
  lorepresetMocks.deleteGlobalLorebookWithOutcome.mockReset()
  lorepresetMocks.deleteGlobalLorebookWithOutcome.mockImplementation((index: number) =>
    lorepresetMocks.deleteGlobalLorebook(index) ? Promise.resolve('accepted') : null,
  )
  lorepresetMocks.deleteGlobalLorebookByIdWithOutcome.mockReset()
  lorepresetMocks.deleteGlobalLorebookByIdWithOutcome.mockImplementation((lorebookId: string) =>
    lorepresetMocks.deleteGlobalLorebookById(lorebookId) ? Promise.resolve('accepted') : null,
  )
  lorepresetMocks.renameGlobalLorebookById.mockReset()
  lorepresetMocks.renameGlobalLorebookById.mockImplementation((lorebookId: string, name: string) => {
    const loreBook = getDatabase().loreBook as LorebookFixture[]
    const matchingIndices = loreBook.flatMap((book, index) => (book.id === lorebookId ? [index] : []))
    if (matchingIndices.length !== 1) return false
    projectLorebooks(loreBook.map((book, index) => (index === matchingIndices[0] ? { ...book, name } : { ...book })))
    return true
  })
  pageOwnerMocks.listeners.clear()
  pageOwnerMocks.snapshot = {
    resource: 'loreBookPage',
    status: 'unloaded',
    revision: null,
    state: { present: false },
    error: null,
    mutation: { status: 'idle' },
  }
  pageOwnerMocks.select.mockReset().mockImplementation(async ({ lorebookId, index }) => {
    await publishPageOwnerSnapshot({
      ...pageOwnerMocks.snapshot,
      status: 'ready',
      state: { present: true, value: index },
      mutation: { status: 'idle' },
    })
    return { status: 'accepted', revision: 2, lorebookId }
  })
  pageOwnerMocks.retry.mockReset().mockResolvedValue({ status: 'ok', revision: 3 })
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
    expect(deleteButton('First').disabled).toBe(true)
    expect(deleteButton('Second').disabled).toBe(true)
  })

  it('fails closed while the global lorebook collection owner is in error', async () => {
    projectLorebooks([lorebook('g1', 'First'), lorebook('g2', 'Second')])
    collectionsResourceState.statuses.loreBook = 'error'

    component = mount(Lorepreset, { target })
    await tick()

    expect(target.textContent).not.toContain('First')
    expect(target.textContent).not.toContain('Second')
    const addButton = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.add}"]`)
    expect(addButton?.disabled).toBe(true)
    addButton?.click()
    expect(lorepresetMocks.createGlobalLorebook).not.toHaveBeenCalled()
  })
})

describe('global lorebook delete status', () => {
  it('marks a restored retained delete as queued and removes it when replay is accepted', async () => {
    projectLorebooks([lorebook('g1', 'First'), lorebook('g2', 'Second')])
    lorepresetMocks.alertConfirm.mockResolvedValue(true)
    const outcome = deferred<'queued'>()
    lorepresetMocks.deleteGlobalLorebookByIdWithOutcome.mockImplementationOnce((lorebookId: string) => {
      lorepresetMocks.deleteGlobalLorebookById(lorebookId)
      return outcome.promise
    })
    component = mount(Lorepreset, { target })
    await settle()

    deleteButton('Second').click()
    await settle()
    expect(lorebookIds()).toEqual(['g1'])

    projectLorebooks([lorebook('g1', 'First'), lorebook('g2', 'Second')])
    await publishDeleteStates([{ lorebookId: 'g2', mutationId: 'delete-g2', status: 'queued' }])

    const queuedRow = target.querySelector<HTMLElement>('[data-risu-global-lorebook-delete-status="queued"]')
    expect(queuedRow?.querySelector('[role="status"]')).toBeNull()
    expect(queuedRow?.getAttribute('aria-busy')).toBe('true')
    expect(deleteButton('Second').disabled).toBe(true)
    const selectButton = Array.from(queuedRow?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
      (button) => button.textContent === 'Second',
    )
    expect(selectButton?.disabled).toBe(true)

    target.querySelector<HTMLButtonElement>(`button[aria-label="${language.edit}"]`)?.click()
    await tick()
    expect(
      Array.from(target.querySelectorAll<HTMLInputElement>('input')).some((input) => input.value === 'Second'),
    ).toBe(false)

    outcome.resolve('queued')
    await settle()
    projectLorebooks([lorebook('g1', 'First')])
    await publishDeleteStates([])

    expect(lorebookIds()).toEqual(['g1'])
    expect(target.textContent).not.toContain(language.globalLorebookDelete.queued)
    expect(target.querySelector('[data-risu-global-lorebook-delete-status]')).toBeNull()
  })

  it('clears queued ownership and shows a terminal discard without hiding the restored row', async () => {
    projectLorebooks([lorebook('g1', 'First'), lorebook('g2', 'Second')])
    component = mount(Lorepreset, { target })
    await settle()
    await publishDeleteStates([{ lorebookId: 'g2', mutationId: 'delete-g2', status: 'queued' }])

    expect(deleteButton('Second').disabled).toBe(true)

    await publishDeleteStates([{ lorebookId: 'g2', mutationId: 'delete-g2', status: 'failed' }])

    const failedRow = target.querySelector<HTMLElement>('[data-risu-global-lorebook-delete-status="failed"]')
    expect(failedRow?.querySelector('[role="alert"]')?.textContent).toContain(language.globalLorebookDelete.failed)
    expect(failedRow?.getAttribute('aria-busy')).toBe('false')
    expect(deleteButton('Second').disabled).toBe(false)
    const selectButton = Array.from(failedRow?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
      (button) => button.textContent === 'Second',
    )
    expect(selectButton?.disabled).toBe(false)
    selectButton?.click()
    expect(pageOwnerMocks.select).toHaveBeenCalledWith({ lorebookId: 'g2', index: 1 })
    expect(lorebookIds()).toEqual(['g1', 'g2'])
  })
})

describe('global lorebook page owner selection', () => {
  it('selects by stable id and owner index', async () => {
    projectLorebooks([lorebook('g1', 'First'), lorebook('g2', 'Second')])
    component = mount(Lorepreset, { target })
    await settle()

    const second = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Second',
    )
    second?.click()
    await settle()

    expect(pageOwnerMocks.select).toHaveBeenCalledWith({ lorebookId: 'g2', index: 1 })
    expect(target.querySelector('.bg-selected button')?.textContent).toBe('Second')
  })

  it('keeps a retained selection visibly queued and reloads after accepted replay', async () => {
    projectLorebooks([lorebook('g1', 'First'), lorebook('g2', 'Second')])
    const settlement = deferred<'accepted' | 'failed'>()
    pageOwnerMocks.select.mockImplementationOnce(async ({ lorebookId, index }) => {
      await publishPageOwnerSnapshot({
        ...pageOwnerMocks.snapshot,
        status: 'ready',
        state: { present: true, value: index },
        mutation: { status: 'queued', attempt: 1, index, lorebookId, mutationId: 'selection-g2' },
      })
      return { status: 'queued', mutationId: 'selection-g2', settlement: settlement.promise }
    })
    component = mount(Lorepreset, { target })
    await settle()

    const second = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Second',
    )
    second?.click()
    await settle()

    const queuedRow = target.querySelector<HTMLElement>('[data-risu-global-lorebook-selection-status="queued"]')
    expect(queuedRow?.textContent).toContain(language.globalLorebookSelection.queued)
    expect(second?.disabled).toBe(true)
    expect(lorepresetMocks.alertNormal).toHaveBeenCalledWith(language.globalLorebookSelection.queued)

    settlement.resolve('accepted')
    await settle()
    expect(pageOwnerMocks.retry).toHaveBeenCalledOnce()
  })

  it('reports a failed owner selection and leaves the prior page selected', async () => {
    projectLorebooks([lorebook('g1', 'First'), lorebook('g2', 'Second')])
    pageOwnerMocks.select.mockImplementationOnce(async ({ lorebookId, index }) => {
      await publishPageOwnerSnapshot({
        ...pageOwnerMocks.snapshot,
        status: 'ready',
        state: { present: true, value: 0 },
        mutation: { status: 'failed', attempt: 1, index, lorebookId, error: 'selection failed' },
      })
      return { status: 'failed', error: 'selection failed' }
    })
    component = mount(Lorepreset, { target })
    await settle()

    const second = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Second',
    )
    second?.click()
    await settle()

    expect(lorepresetMocks.alertError).toHaveBeenCalledWith(language.globalLorebookSelection.failed('selection failed'))
    expect(target.querySelector('[data-risu-global-lorebook-selection-status="failed"]')).not.toBeNull()
  })
})

describe('global lorebook modal containment', () => {
  it('traps initial focus, contains Escape, and restores the opener', async () => {
    projectLorebooks([lorebook('g1', 'First')])
    const opener = document.createElement('button')
    opener.textContent = 'Open lorebooks'
    target.appendChild(opener)
    opener.focus()
    const close = vi.fn()
    const documentKeydown = vi.fn()
    document.addEventListener('keydown', documentKeydown)

    component = mount(Lorepreset, { target, props: { close } })
    await settle()

    const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
    const closeButton = target.querySelector<HTMLButtonElement>('[data-modal-initial-focus]')
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-labelledby')).toBe('risu-global-lorebook-dialog-title')
    expect(opener.inert).toBe(true)
    expect(opener.getAttribute('aria-hidden')).toBe('true')
    expect(document.activeElement).toBe(closeButton)

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    closeButton?.dispatchEvent(escape)
    document.removeEventListener('keydown', documentKeydown)

    expect(escape.defaultPrevented).toBe(true)
    expect(close).toHaveBeenCalledOnce()
    expect(documentKeydown).not.toHaveBeenCalled()

    unmount(component)
    component = undefined
    await settle()

    expect(opener.inert).toBe(false)
    expect(opener.hasAttribute('aria-hidden')).toBe(false)
    expect(document.activeElement).toBe(opener)
  })
})
