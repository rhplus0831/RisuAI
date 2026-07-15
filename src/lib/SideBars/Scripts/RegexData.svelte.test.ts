import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { customscript } from 'src/ts/storage/database.svelte'

const regexDataMocks = vi.hoisted(() => ({
  alertConfirm: vi.fn(async () => true),
  reloadGuiAfterDefinitionChange: vi.fn(),
}))

vi.mock('src/lang', () => ({
  language: { removeConfirm: 'Remove ' },
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
