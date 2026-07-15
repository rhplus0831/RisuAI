import { mount, tick, unmount } from 'svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const translateStackTrace = vi.hoisted(() => vi.fn())

vi.mock('src/ts/sourcemap', () => ({ translateStackTrace }))
vi.mock('src/ts/process/modules', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/process/modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

import AlertComp from './AlertComp.svelte'
import { alertStore } from 'src/ts/stores.svelte'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('AlertComp stack trace translation', () => {
  beforeEach(() => {
    translateStackTrace.mockReset()
    alertStore.set({ type: 'none', msg: '' })
  })

  it('does not display a translation that belongs to an older error', async () => {
    const first = deferred<{ didTranslate: true; stackTrace: string }>()
    const second = deferred<{ didTranslate: true; stackTrace: string }>()
    translateStackTrace.mockImplementation((stackTrace: string) =>
      stackTrace === 'first source trace' ? first.promise : second.promise,
    )
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(AlertComp, { target })

    try {
      alertStore.set({ type: 'error', msg: 'First error', stackTrace: 'first source trace' })
      await tick()
      alertStore.set({ type: 'error', msg: 'Second error', stackTrace: 'second source trace' })
      await tick()

      second.resolve({ didTranslate: true, stackTrace: 'translated second trace' })
      await tick()
      first.resolve({ didTranslate: true, stackTrace: 'translated first trace' })
      await tick()

      const detailsButton = Array.from(target.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Show Error Details'),
      )
      expect(detailsButton).toBeDefined()
      detailsButton?.click()
      await tick()

      expect(target.textContent).toContain('translated second trace')
      expect(target.textContent).not.toContain('translated first trace')
    } finally {
      unmount(component)
      target.remove()
      alertStore.set({ type: 'none', msg: '' })
    }
  })
})

describe('AlertComp input dialog', () => {
  beforeEach(() => {
    translateStackTrace.mockReset()
    alertStore.set({ type: 'none', msg: '' })
  })

  it('focuses the input and submits its value with Enter', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(AlertComp, { target })

    try {
      alertStore.set({ type: 'input', msg: 'Character name', defaultValue: 'Risu' })
      await tick()

      const input = target.querySelector<HTMLInputElement>('#alert-input')
      expect(input).toBeTruthy()
      expect(document.activeElement).toBe(input)
      expect(input?.getAttribute('aria-label')).toBe('Character name')

      input!.value = 'Risu AI'
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

      expect(get(alertStore)).toMatchObject({ type: 'none', msg: 'Risu AI' })
    } finally {
      unmount(component)
      target.remove()
    }
  })

  it('cancels with Escape or the visible cancel button', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(AlertComp, { target })

    try {
      alertStore.set({ type: 'input', msg: 'First prompt', defaultValue: 'keep me' })
      await tick()
      target
        .querySelector<HTMLInputElement>('#alert-input')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(get(alertStore)).toMatchObject({ type: 'none', msg: '' })

      alertStore.set({ type: 'input', msg: 'Second prompt', defaultValue: 'keep me' })
      await tick()
      const cancel = Array.from(target.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Cancel'),
      )
      expect(cancel).toBeTruthy()
      cancel?.click()
      expect(get(alertStore)).toMatchObject({ type: 'none', msg: '' })
    } finally {
      unmount(component)
      target.remove()
      alertStore.set({ type: 'none', msg: '' })
    }
  })
})
