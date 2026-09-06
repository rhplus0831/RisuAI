import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const regexListMocks = vi.hoisted(() => ({
  exportRegex: vi.fn(),
  importRegexRows: vi.fn(),
  reloadRegexDisplay: vi.fn(),
  resetScriptCache: vi.fn(),
  sortableCreate: vi.fn(() => ({ destroy: vi.fn() })),
}))

vi.mock('src/ts/process/scripts', () => ({
  exportRegex: regexListMocks.exportRegex,
  importRegexRows: regexListMocks.importRegexRows,
  resetScriptCache: regexListMocks.resetScriptCache,
}))

vi.mock('src/ts/process/regexDisplayReload', () => ({
  normalizeRegexDisplayOwnerKey: (ownerKey?: string) => ownerKey?.trim() || '*',
  reloadRegexDisplay: regexListMocks.reloadRegexDisplay,
}))

vi.mock('src/ts/stores.svelte', async () => {
  const { writable } = await import('svelte/store')
  return {
    closePopupEditorSession: vi.fn(),
    disableHighlight: writable(false),
    isPopupEditorSessionCurrent: vi.fn(() => false),
    openPopupEditorSession: vi.fn(() => 1),
    popUpEditorStore: { open: false, sessionId: 0, value: '' },
    selIdState: { selId: -1 },
  }
})

vi.mock('sortablejs', () => ({
  default: { create: regexListMocks.sortableCreate },
}))

import type { customscript } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'
import {
  REGEX_DISPLAY_ACTIVATION_DELAY_MS,
  resetRegexDisplayActivationForTests,
} from 'src/ts/process/regexDisplayActivation'
import RegexListHarness from './RegexList.testHarness.svelte'

type MountedComponent = Parameters<typeof unmount>[0] & {
  getValue: () => customscript[]
  patchScript: (index: number, patch: Partial<customscript>) => void
  replaceOwner: (ownerKey: string, value: customscript[]) => void
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
  for (let index = 0; index < 3; index += 1) {
    await tick()
    await Promise.resolve()
  }
}

beforeEach(() => {
  resetRegexDisplayActivationForTests()
  target = document.createElement('div')
  document.body.appendChild(target)
  regexListMocks.importRegexRows.mockReset()
  regexListMocks.reloadRegexDisplay.mockReset()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  resetRegexDisplayActivationForTests()
  vi.useRealTimers()
  target.remove()
})

describe('RegexList imports', () => {
  it('does not append a deferred preset import after the owner changes', async () => {
    const importedRows = deferred<customscript[] | null>()
    regexListMocks.importRegexRows.mockReturnValueOnce(importedRows.promise)
    component = mount(RegexListHarness, {
      target,
      props: {
        initialValue: [{ id: 'preset-a-script', comment: 'A', in: '', out: '', type: 'editinput' }],
      },
    }) as MountedComponent
    await settle()

    target.querySelector<HTMLButtonElement>(`[aria-label="${language.import}: ${language.regexScript}"]`)?.click()
    await settle()
    expect(regexListMocks.importRegexRows).toHaveBeenCalledOnce()

    component.replaceOwner('preset-b', [{ id: 'preset-b-script', comment: 'B', in: '', out: '', type: 'editinput' }])
    await settle()

    importedRows.resolve([{ id: 'imported-a-script', comment: 'Imported A', in: '', out: '', type: 'editinput' }])
    await settle()

    expect(component.getValue().map((script) => script.id)).toEqual(['preset-b-script'])
  })
})

describe('RegexList display activation', () => {
  it('shows progress and activates one display refresh after editing pauses', async () => {
    vi.useFakeTimers()
    component = mount(RegexListHarness, {
      target,
      props: {
        initialValue: [{ id: 'display-script', comment: 'Display', in: 'before', out: 'after', type: 'editdisplay' }],
      },
    }) as MountedComponent
    await settle()

    component.patchScript(0, { out: 'first edit' })
    await settle()

    expect(target.querySelector('[data-risu-regex-display-pending]')?.textContent).toContain(
      language.regexDisplayUpdatePending,
    )
    expect(regexListMocks.reloadRegexDisplay).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(REGEX_DISPLAY_ACTIVATION_DELAY_MS - 1)
    expect(regexListMocks.reloadRegexDisplay).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await settle()

    expect(regexListMocks.reloadRegexDisplay).toHaveBeenCalledOnce()
    expect(target.querySelector('[data-risu-regex-display-pending]')).toBeNull()
    vi.useRealTimers()
  })

  it('keeps display activation pending until the owner save gate settles successfully', async () => {
    vi.useFakeTimers()
    const save = deferred<boolean>()
    const beforeDisplayActivation = vi.fn(() => save.promise)
    component = mount(RegexListHarness, {
      target,
      props: {
        initialOwnerKey: 'char-a',
        initialValue: [{ id: 'display-script', comment: 'Display', in: 'before', out: 'after', type: 'editdisplay' }],
        beforeDisplayActivation,
      },
    }) as MountedComponent
    await settle()

    component.patchScript(0, { out: 'saved before display' })
    await settle()
    await vi.advanceTimersByTimeAsync(REGEX_DISPLAY_ACTIVATION_DELAY_MS)

    expect(beforeDisplayActivation).toHaveBeenCalledOnce()
    expect(beforeDisplayActivation).toHaveBeenCalledWith('char-a')
    expect(regexListMocks.reloadRegexDisplay).not.toHaveBeenCalled()
    expect(target.querySelector('[data-risu-regex-display-pending]')).not.toBeNull()

    save.resolve(true)
    await settle()

    expect(regexListMocks.reloadRegexDisplay).toHaveBeenCalledOnce()
    expect(regexListMocks.reloadRegexDisplay).toHaveBeenCalledWith('char-a')
    expect(target.querySelector('[data-risu-regex-display-pending]')).toBeNull()
    vi.useRealTimers()
  })

  it('does not activate display output when the owner save gate fails', async () => {
    vi.useFakeTimers()
    component = mount(RegexListHarness, {
      target,
      props: {
        initialOwnerKey: 'char-a',
        initialValue: [{ id: 'display-script', comment: 'Display', in: 'before', out: 'after', type: 'editdisplay' }],
        beforeDisplayActivation: vi.fn(async () => false),
      },
    }) as MountedComponent
    await settle()

    component.patchScript(0, { out: 'rejected display edit' })
    await settle()
    await vi.advanceTimersByTimeAsync(REGEX_DISPLAY_ACTIVATION_DELAY_MS)
    await settle()

    expect(regexListMocks.reloadRegexDisplay).not.toHaveBeenCalled()
    expect(target.querySelector('[data-risu-regex-display-pending]')).not.toBeNull()
    vi.useRealTimers()
  })

  it('does not schedule display work for non-display scripts or metadata-only edits', async () => {
    vi.useFakeTimers()
    component = mount(RegexListHarness, {
      target,
      props: {
        initialValue: [
          { id: 'input-script', comment: 'Input', in: 'before', out: 'after', type: 'editinput' },
          { id: 'display-script', comment: 'Display', in: 'before', out: 'after', type: 'editdisplay' },
        ],
      },
    }) as MountedComponent
    await settle()

    component.patchScript(0, { out: 'input-only edit' })
    component.patchScript(1, { comment: 'Renamed display script' })
    await settle()
    await vi.advanceTimersByTimeAsync(REGEX_DISPLAY_ACTIVATION_DELAY_MS)

    expect(target.querySelector('[data-risu-regex-display-pending]')).toBeNull()
    expect(regexListMocks.reloadRegexDisplay).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('restarts pending display progress while any editor activity continues', async () => {
    vi.useFakeTimers()
    component = mount(RegexListHarness, {
      target,
      props: {
        initialValue: [{ id: 'display-script', comment: 'Display', in: 'before', out: 'after', type: 'editdisplay' }],
      },
    }) as MountedComponent
    await settle()

    component.patchScript(0, { out: 'changed output' })
    await settle()
    await vi.advanceTimersByTimeAsync(REGEX_DISPLAY_ACTIVATION_DELAY_MS - 100)

    component.patchScript(0, { comment: 'Still editing' })
    await settle()
    await vi.advanceTimersByTimeAsync(100)
    expect(regexListMocks.reloadRegexDisplay).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(REGEX_DISPLAY_ACTIVATION_DELAY_MS - 100)
    expect(regexListMocks.reloadRegexDisplay).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('cancels pending activation when the edited owner changes', async () => {
    vi.useFakeTimers()
    component = mount(RegexListHarness, {
      target,
      props: {
        initialValue: [{ id: 'preset-a-script', comment: 'A', in: 'a', out: 'A', type: 'editdisplay' }],
      },
    }) as MountedComponent
    await settle()

    component.patchScript(0, { out: 'A2' })
    await settle()
    component.replaceOwner('preset-b', [
      { id: 'preset-b-script', comment: 'B', in: 'b', out: 'B', type: 'editdisplay' },
    ])
    await settle()
    await vi.advanceTimersByTimeAsync(REGEX_DISPLAY_ACTIVATION_DELAY_MS)

    expect(target.querySelector('[data-risu-regex-display-pending]')).toBeNull()
    expect(regexListMocks.reloadRegexDisplay).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('keeps the owner-scoped delay when the editor unmounts', async () => {
    vi.useFakeTimers()
    component = mount(RegexListHarness, {
      target,
      props: {
        initialOwnerKey: 'character:char-a',
        initialValue: [{ id: 'display-script', comment: 'Display', in: 'before', out: 'after', type: 'editdisplay' }],
      },
    }) as MountedComponent
    await settle()

    component.patchScript(0, { out: 'updated after unmount' })
    await settle()
    await unmount(component)
    component = undefined

    expect(regexListMocks.reloadRegexDisplay).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(REGEX_DISPLAY_ACTIVATION_DELAY_MS)

    expect(regexListMocks.reloadRegexDisplay).toHaveBeenCalledOnce()
    expect(regexListMocks.reloadRegexDisplay).toHaveBeenCalledWith('character:char-a')
    vi.useRealTimers()
  })
})
