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
import { DBState, popUpEditorStore } from 'src/ts/stores.svelte'

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
  DBState.db = {
    hotkeys: [{ action: 'popupEditor', key: 'e', ctrl: true }],
    lineHeight: 1.25,
    zoomsize: 100,
  } as any
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
  DBState.db = {} as any
  popUpEditorStore.open = false
  popUpEditorStore.value = ''
  vi.useRealTimers()
})

describe('TextAreaResizable popup editor', () => {
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
})
