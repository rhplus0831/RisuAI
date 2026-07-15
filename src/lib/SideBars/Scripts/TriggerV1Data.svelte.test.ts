import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { triggerscript } from 'src/ts/storage/database.svelte'

const triggerDataMocks = vi.hoisted(() => ({
  alertConfirm: vi.fn(async () => true),
}))

vi.mock('src/lang', () => ({
  language: { removeConfirm: 'Remove ' },
}))

vi.mock('src/ts/alert', () => ({
  alertConfirm: triggerDataMocks.alertConfirm,
}))

vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', async () => {
  const mock = await import('../CharConfig.testRegexList.svelte')
  return { default: mock.default }
})

import TriggerV1Data from './TriggerV1Data.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  triggerDataMocks.alertConfirm.mockClear()
  triggerDataMocks.alertConfirm.mockResolvedValue(true)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('TriggerV1Data deletion', () => {
  it('does not close an already-closed row before removing it', async () => {
    const onClose = vi.fn()
    const onRemove = vi.fn()
    const value = {
      id: 'trigger-closed',
      comment: 'Closed trigger',
      type: 'start',
      conditions: [],
      effect: [],
    } as triggerscript

    component = mount(TriggerV1Data, {
      target,
      props: { value, idx: 0, onClose, onRemove },
    })

    target.querySelector<HTMLButtonElement>('[data-risu-trigger-v1-action="delete"]')?.click()
    await Promise.resolve()
    await tick()

    expect(triggerDataMocks.alertConfirm).toHaveBeenCalledWith('Remove Closed trigger')
    expect(onClose).not.toHaveBeenCalled()
    expect(onRemove).toHaveBeenCalledWith('trigger-closed')
  })
})
