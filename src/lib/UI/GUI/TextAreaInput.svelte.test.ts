import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

import TextAreaInput from './TextAreaInput.svelte'
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
    longPressToPopupEditor: false,
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

describe('TextAreaInput popup editor finalization', () => {
  it('calls onchange after committing a hotkey popup edit', async () => {
    const onInput = vi.fn()
    const onchange = vi.fn()
    component = mount(TextAreaInput, {
      target,
      props: {
        value: 'before',
        onInput,
        onchange,
      },
    })

    textarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true }))
    await tick()

    expect(popUpEditorStore.open).toBe(true)
    popUpEditorStore.value = 'after'
    popUpEditorStore.open = false
    await vi.advanceTimersByTimeAsync(100)
    await tick()

    expect(onInput).toHaveBeenCalledOnce()
    expect(onchange).toHaveBeenCalledOnce()
  })

  it('calls onchange after committing a context-menu popup edit', async () => {
    const onInput = vi.fn()
    const onchange = vi.fn()
    DBState.db.longPressToPopupEditor = true
    component = mount(TextAreaInput, {
      target,
      props: {
        value: 'before',
        onInput,
        onchange,
      },
    })

    textarea().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await tick()

    expect(popUpEditorStore.open).toBe(true)
    popUpEditorStore.value = 'after'
    popUpEditorStore.open = false
    await vi.advanceTimersByTimeAsync(100)
    await tick()

    expect(onInput).toHaveBeenCalledOnce()
    expect(onchange).toHaveBeenCalledOnce()
  })
})
