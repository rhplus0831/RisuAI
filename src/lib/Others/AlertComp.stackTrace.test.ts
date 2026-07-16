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
import { alertConfirm, alertSelect } from 'src/ts/alert'
import { language } from 'src/lang'
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

describe('AlertComp select dialog', () => {
  beforeEach(() => {
    translateStackTrace.mockReset()
    alertStore.set({ type: 'none', msg: '' })
  })

  it('renders an accessible localized cancellation control and cancels with Escape', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(AlertComp, { target })

    try {
      const result = alertSelect(['WebVTT', 'SRT'], 'Choose a subtitle format')
      await tick()
      await Promise.resolve()

      const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
      const cancel = Array.from(target.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === language.cancel,
      )
      expect(dialog).toBeTruthy()
      expect(dialog?.getAttribute('aria-modal')).toBe('true')
      expect(dialog?.textContent).toContain('Choose a subtitle format')
      expect(cancel).toBeTruthy()
      expect(dialog?.contains(document.activeElement)).toBe(true)

      cancel?.click()
      await expect(result).resolves.toBeNull()
      expect(get(alertStore)).toMatchObject({ type: 'none', msg: '' })

      const escapedResult = alertSelect(['Keep open'])
      await tick()
      target
        .querySelector<HTMLElement>('[role="dialog"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      await expect(escapedResult).resolves.toBeNull()
    } finally {
      unmount(component)
      target.remove()
      alertStore.set({ type: 'none', msg: '' })
    }
  })

  it('cancels only when the modal backdrop itself is clicked', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(AlertComp, { target })

    try {
      const result = alertSelect(['Keep open'])
      await tick()

      const modalRoot = target.querySelector<HTMLElement>('[data-modal-root]')
      const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
      expect(modalRoot).toBeTruthy()
      expect(dialog).toBeTruthy()

      dialog?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(get(alertStore)).toMatchObject({ type: 'select' })

      modalRoot?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await expect(result).resolves.toBeNull()
    } finally {
      unmount(component)
      target.remove()
      alertStore.set({ type: 'none', msg: '' })
    }
  })
})

describe('AlertComp confirmation queue', () => {
  beforeEach(() => {
    translateStackTrace.mockReset()
    alertStore.set({ type: 'none', msg: '' })
  })

  it('renders concurrent confirmations one at a time and binds each button response to its caller', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(AlertComp, { target })

    try {
      const firstResult = alertConfirm('First queued confirmation')
      const secondResult = alertConfirm('Second queued confirmation')
      await tick()

      expect(target.textContent).toContain('First queued confirmation')
      expect(target.textContent).not.toContain('Second queued confirmation')

      const yesButton = Array.from(target.querySelectorAll('button')).find((button) => button.textContent === 'YES')
      expect(yesButton).toBeTruthy()
      yesButton?.click()
      await expect(firstResult).resolves.toBe(true)
      await tick()

      expect(target.textContent).not.toContain('First queued confirmation')
      expect(target.textContent).toContain('Second queued confirmation')

      const noButton = Array.from(target.querySelectorAll('button')).find((button) => button.textContent === 'NO')
      expect(noButton).toBeTruthy()
      noButton?.click()
      await expect(secondResult).resolves.toBe(false)
      await tick()

      expect(target.querySelector('[role="alertdialog"]')).toBeNull()
    } finally {
      unmount(component)
      target.remove()
      alertStore.set({ type: 'none', msg: '' })
    }
  })
})
