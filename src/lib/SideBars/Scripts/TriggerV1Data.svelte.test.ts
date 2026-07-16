import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { triggerscript } from 'src/ts/storage/database.svelte'

const triggerDataMocks = vi.hoisted(() => ({
  alertConfirm: vi.fn(async () => true),
}))

vi.mock('src/lang', () => ({
  language: {
    add: 'Add',
    condition: 'Condition',
    effect: 'Effect',
    remove: 'Remove',
    removeConfirm: 'Remove ',
  },
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
  it('balances an expanded row registration when its definition is destroyed externally', async () => {
    const onOpen = vi.fn()
    const onClose = vi.fn()
    component = mount(TriggerV1Data, {
      target,
      props: {
        value: {
          id: 'trigger-replaced',
          comment: 'Replaced trigger',
          type: 'start',
          conditions: [],
          effect: [],
        } as triggerscript,
        idx: 0,
        onOpen,
        onClose,
      },
    })

    target.querySelector<HTMLButtonElement>('button.endflex')?.click()
    await tick()
    unmount(component)
    component = undefined

    expect(onOpen).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

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

  it('settles one expanded-row deletion when the action is clicked repeatedly', async () => {
    let resolveConfirmation: (confirmed: boolean) => void = () => {}
    triggerDataMocks.alertConfirm.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirmation = resolve
        }),
    )
    const onOpen = vi.fn()
    const onClose = vi.fn()
    const onRemove = vi.fn()
    const value = {
      id: 'trigger-open',
      comment: 'Open trigger',
      type: 'start',
      conditions: [],
      effect: [],
    } as triggerscript

    component = mount(TriggerV1Data, {
      target,
      props: { value, idx: 0, onOpen, onClose, onRemove },
    })

    const expand = target.querySelector<HTMLButtonElement>('button.endflex')!
    const remove = target.querySelector<HTMLButtonElement>('[data-risu-trigger-v1-action="delete"]')!
    expand.click()
    await tick()
    remove.click()
    remove.click()
    await tick()

    expect(triggerDataMocks.alertConfirm).toHaveBeenCalledTimes(1)
    expect(remove.disabled).toBe(true)

    resolveConfirmation(true)
    await Promise.resolve()
    await tick()

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(expand.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('TriggerV1Data action accessibility', () => {
  it('names repeated actions and exposes row expansion state', async () => {
    const value = {
      id: 'trigger-a',
      comment: 'Greeting trigger',
      type: 'start',
      conditions: [{ type: 'value', value: '', operator: 'true', var: '' }],
      effect: [{ type: 'stop' }],
    } as triggerscript

    component = mount(TriggerV1Data, {
      target,
      props: { value, idx: 3 },
    })

    const expand = target.querySelector<HTMLButtonElement>('button.endflex')
    const remove = target.querySelector<HTMLButtonElement>('[data-risu-trigger-v1-action="delete"]')
    expect(expand?.getAttribute('aria-expanded')).toBe('false')
    expect(remove?.getAttribute('aria-label')).toBe('Remove: Greeting trigger')

    expand?.click()
    await tick()
    expect(expand?.getAttribute('aria-expanded')).toBe('true')
    expect(target.querySelector('[aria-label="Add: Condition"]')).toBeTruthy()
    expect(target.querySelector('[aria-label="Remove: Condition 1"]')).toBeTruthy()
    expect(target.querySelector('[aria-label="Add: Effect"]')).toBeTruthy()
    expect(target.querySelector('[aria-label="Remove: Effect 1"]')).toBeTruthy()
  })
})
