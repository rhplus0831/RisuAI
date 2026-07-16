import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

import TextAreaResizable from './TextAreaResizable.svelte'
import { language } from 'src/lang'
import { popUpEditorStore } from 'src/ts/stores.svelte'
import { replaceResourceDatabase } from 'src/ts/server/resourceState.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function textarea(): HTMLTextAreaElement {
  const element = target.querySelector('textarea')
  if (!element) throw new Error('textarea not found')
  return element
}

beforeEach(() => {
  vi.useFakeTimers()
  target = document.createElement('div')
  document.body.appendChild(target)
  replaceResourceDatabase({
    hotkeys: [{ action: 'popupEditor', key: 'e', ctrl: true }],
    lineHeight: 1.25,
    zoomsize: 100,
  } as any)
  popUpEditorStore.open = false
  popUpEditorStore.value = ''
  popUpEditorStore.language = 'markdown'
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  replaceResourceDatabase({} as any)
  popUpEditorStore.open = false
  popUpEditorStore.value = ''
  vi.useRealTimers()
})

describe('TextAreaResizable popup editor', () => {
  it('provides a localized input name by default', () => {
    component = mount(TextAreaResizable, { target, props: { value: '' } })
    expect(textarea().getAttribute('aria-label')).toBe(language.messageInput)
  })

  it('opens and commits through the popup editor when enabled', async () => {
    const onchange = vi.fn()
    component = mount(TextAreaResizable, {
      target,
      props: {
        value: 'before',
        onchange,
        popupEditor: true,
        stableHeight: true,
      },
    })

    target.querySelector<HTMLButtonElement>('button[aria-label]')?.click()
    await tick()

    expect(popUpEditorStore.open).toBe(true)
    popUpEditorStore.value = 'after'
    popUpEditorStore.open = false
    await vi.advanceTimersByTimeAsync(100)
    await tick()

    expect(textarea().value).toBe('after')
    expect(onchange).toHaveBeenCalledOnce()
  })

  it('discards a delayed popup edit after the textarea is unmounted', async () => {
    const onchange = vi.fn()
    component = mount(TextAreaResizable, {
      target,
      props: {
        value: 'departed message',
        onchange,
        popupEditor: true,
      },
    })

    target.querySelector<HTMLButtonElement>('button[aria-label]')?.click()
    await tick()
    expect(popUpEditorStore.open).toBe(true)

    popUpEditorStore.value = 'stale edit after navigation'
    unmount(component)
    component = undefined
    popUpEditorStore.open = false
    await vi.advanceTimersByTimeAsync(100)
    await tick()

    expect(onchange).not.toHaveBeenCalled()
  })

  it('discards a delayed popup edit after the bound value changes', async () => {
    const onchange = vi.fn()
    component = mount(TextAreaResizable, {
      target,
      props: {
        value: 'original message',
        onchange,
        popupEditor: true,
      },
    })

    target.querySelector<HTMLButtonElement>('button[aria-label]')?.click()
    await tick()
    expect(popUpEditorStore.open).toBe(true)

    const input = textarea()
    input.value = 'new live value'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    popUpEditorStore.value = 'stale popup value'
    popUpEditorStore.open = false
    await vi.advanceTimersByTimeAsync(100)
    await tick()

    expect(textarea().value).toBe('new live value')
    expect(onchange).not.toHaveBeenCalled()
  })

  it('keeps a stable editing height instead of writing measured content height', async () => {
    component = mount(TextAreaResizable, {
      target,
      props: {
        value: 'line one',
        popupEditor: true,
        stableHeight: true,
      },
    })
    await tick()

    const input = textarea()
    expect(input.style.height).toBe('16rem')
    expect(input.style.minHeight).toBe('12rem')
    expect(input.style.maxHeight).toBe('60vh')
  })

  it('uses a more specific caller label when provided', () => {
    component = mount(TextAreaResizable, {
      target,
      props: { value: '', ariaLabel: 'Translated message' },
    })
    expect(textarea().getAttribute('aria-label')).toBe('Translated message')
  })
})
