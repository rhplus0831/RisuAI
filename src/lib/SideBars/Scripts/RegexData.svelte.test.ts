import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { customscript } from 'src/ts/storage/database.svelte'

const regexDataMocks = vi.hoisted(() => ({
  alertConfirm: vi.fn(async () => true),
  reloadGuiAfterDefinitionChange: vi.fn(),
}))

vi.mock('src/lang', () => ({
  language: {
    hotkeyDesc: { popupEditor: 'Popup Editor' },
    remove: 'Remove',
    removeConfirm: 'Remove ',
  },
}))

vi.mock('src/ts/alert', () => ({
  alertConfirm: regexDataMocks.alertConfirm,
}))

vi.mock('src/ts/stores.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('src/ts/stores.svelte')>()),
  reloadGuiAfterDefinitionChange: regexDataMocks.reloadGuiAfterDefinitionChange,
}))

import RegexData from './RegexData.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  regexDataMocks.alertConfirm.mockClear()
  regexDataMocks.alertConfirm.mockResolvedValue(true)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('RegexData deletion', () => {
  it('does not close an already-closed row before removing it', async () => {
    const onClose = vi.fn()
    const onRemove = vi.fn()
    const value = {
      id: 'script-closed',
      comment: 'Closed script',
      in: '',
      out: '',
      type: 'editinput',
    } as customscript

    component = mount(RegexData, {
      target,
      props: { value, idx: 0, onClose, onRemove },
    })

    target.querySelector<HTMLButtonElement>('[data-risu-regex-action="delete"]')?.click()
    await Promise.resolve()
    await tick()

    expect(regexDataMocks.alertConfirm).toHaveBeenCalledWith('Remove Closed script')
    expect(onClose).not.toHaveBeenCalled()
    expect(onRemove).toHaveBeenCalledWith('script-closed')
  })
})

describe('RegexData action accessibility', () => {
  it('names row deletion and exposes expansion and flag selection state', async () => {
    const value = {
      id: 'script-a',
      comment: 'Normalize names',
      in: '',
      out: '',
      type: 'editinput',
      ableFlag: true,
      flag: 'g',
    } as customscript

    component = mount(RegexData, {
      target,
      props: { value, idx: 2 },
    })

    const expand = target.querySelector<HTMLButtonElement>('button.endflex')
    const remove = target.querySelector<HTMLButtonElement>('[data-risu-regex-action="delete"]')
    expect(expand?.getAttribute('aria-expanded')).toBe('false')
    expect(remove?.getAttribute('aria-label')).toBe('Remove: Normalize names')

    expand?.click()
    await tick()
    expect(expand?.getAttribute('aria-expanded')).toBe('true')

    const flagsAccordion = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'FLAGS',
    )
    flagsAccordion?.click()
    await tick()

    const globalFlag = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('Global (g)'),
    )
    const caseFlag = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('Case Insensitive (i)'),
    )
    expect(globalFlag?.getAttribute('aria-pressed')).toBe('true')
    expect(caseFlag?.getAttribute('aria-pressed')).toBe('false')
  })
})
