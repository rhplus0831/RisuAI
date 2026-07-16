import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const regexListMocks = vi.hoisted(() => ({
  exportRegex: vi.fn(),
  importRegexRows: vi.fn(),
  sortableCreate: vi.fn(() => ({ destroy: vi.fn() })),
}))

vi.mock('src/ts/process/scripts', () => ({
  exportRegex: regexListMocks.exportRegex,
  importRegexRows: regexListMocks.importRegexRows,
}))

vi.mock('sortablejs', () => ({
  default: { create: regexListMocks.sortableCreate },
}))

import type { customscript } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'
import RegexListHarness from './RegexList.testHarness.svelte'

type MountedComponent = Parameters<typeof unmount>[0] & {
  getValue: () => customscript[]
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
  target = document.createElement('div')
  document.body.appendChild(target)
  regexListMocks.importRegexRows.mockReset()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
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
