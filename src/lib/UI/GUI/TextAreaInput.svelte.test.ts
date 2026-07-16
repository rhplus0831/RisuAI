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
import TextAreaInputTestHost from './TextAreaInput.testHost.svelte'
import { disableHighlight, popUpEditorStore } from 'src/ts/stores.svelte'
import { textAreaSize } from 'src/ts/gui/guisize'
import { replaceResourceDatabase } from 'src/ts/server/resourceState.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function textarea(): HTMLTextAreaElement {
  const element = target.querySelector('textarea')
  if (!element) throw new Error('textarea not found')
  return element
}

function highlightedEditor(): HTMLDivElement {
  const element = target.querySelector<HTMLDivElement>('[contenteditable="true"]')
  if (!element) throw new Error('highlighted editor not found')
  return element
}

function autocompleteSuggestion(label: string): HTMLButtonElement | null {
  return Array.from(target.querySelectorAll('button')).find((button) => button.textContent?.trim() === label) ?? null
}

async function openAutocomplete(): Promise<HTMLDivElement> {
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 10, y: 10 }))
  component = mount(TextAreaInput, {
    target,
    props: {
      value: '{{cha',
      highlight: true,
      popupEditor: false,
    },
  })
  await tick()

  const editor = highlightedEditor()
  editor.focus()
  const textNode = editor.firstChild
  if (!textNode) throw new Error('highlighted editor text node not found')
  const selection = window.getSelection()
  if (!selection) throw new Error('document selection unavailable')
  const range = document.createRange()
  range.setStart(textNode, textNode.textContent?.length ?? 0)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  editor.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
  return editor
}

function seedDatabase(overrides: Record<string, unknown> = {}) {
  replaceResourceDatabase({
    hotkeys: [{ action: 'popupEditor', key: 'e', ctrl: true }],
    longPressToPopupEditor: false,
    ...overrides,
  } as any)
}

beforeEach(() => {
  vi.useFakeTimers()
  target = document.createElement('div')
  document.body.appendChild(target)
  seedDatabase()
  popUpEditorStore.open = false
  popUpEditorStore.value = ''
  popUpEditorStore.language = 'markdown'
  textAreaSize.set(0)
  disableHighlight.set(false)
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
  textAreaSize.set(0)
  disableHighlight.set(true)
  vi.useRealTimers()
  vi.restoreAllMocks()
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
    seedDatabase({ longPressToPopupEditor: true })
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

  it('keeps compact fixed-height textareas out of the popup editor by default', async () => {
    const onInput = vi.fn()
    const onchange = vi.fn()
    seedDatabase({ longPressToPopupEditor: true })
    component = mount(TextAreaInput, {
      target,
      props: {
        value: 'before',
        height: '20',
        onInput,
        onchange,
      },
    })

    expect(target.querySelector('button[aria-label]')).toBeNull()

    textarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true }))
    await tick()
    expect(popUpEditorStore.open).toBe(false)

    textarea().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await tick()
    expect(popUpEditorStore.open).toBe(false)
    expect(onInput).not.toHaveBeenCalled()
    expect(onchange).not.toHaveBeenCalled()
  })

  it('keeps default-height textareas out of the popup editor when the global size is compact', async () => {
    const onInput = vi.fn()
    const onchange = vi.fn()
    seedDatabase({ longPressToPopupEditor: true })
    textAreaSize.set(-3)
    component = mount(TextAreaInput, {
      target,
      props: {
        value: 'before',
        onInput,
        onchange,
      },
    })

    expect(target.querySelector('button[aria-label]')).toBeNull()

    textarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true }))
    await tick()
    expect(popUpEditorStore.open).toBe(false)

    textarea().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await tick()
    expect(popUpEditorStore.open).toBe(false)
    expect(onInput).not.toHaveBeenCalled()
    expect(onchange).not.toHaveBeenCalled()
  })

  it('allows explicit large fixed-height textareas to use the popup editor', async () => {
    const onInput = vi.fn()
    const onchange = vi.fn()
    component = mount(TextAreaInput, {
      target,
      props: {
        value: 'before',
        height: '32',
        onInput,
        onchange,
      },
    })

    target.querySelector<HTMLButtonElement>('button[aria-label]')?.click()
    await tick()

    expect(popUpEditorStore.open).toBe(true)
    popUpEditorStore.value = 'after'
    popUpEditorStore.open = false
    await vi.advanceTimersByTimeAsync(100)
    await tick()

    expect(onInput).toHaveBeenCalledOnce()
    expect(onchange).toHaveBeenCalledOnce()
  })

  it('discards a delayed popup edit after the bound target changes, even when its value is unchanged', async () => {
    const onInput = vi.fn()
    const onchange = vi.fn()
    component = mount(TextAreaInputTestHost, {
      target,
      props: {
        initialContext: 'chat-a',
        initialValue: 'same note',
        onInput,
        onchange,
      },
    })

    target.querySelector<HTMLButtonElement>('button[aria-label]')?.click()
    await tick()
    expect(popUpEditorStore.open).toBe(true)

    popUpEditorStore.value = 'stale chat-a edit'
    ;(component as unknown as { replaceTarget: (context: string, value: string) => void }).replaceTarget(
      'chat-b',
      'same note',
    )
    await tick()
    popUpEditorStore.open = false
    await vi.advanceTimersByTimeAsync(100)
    await tick()

    expect((component as unknown as { getValue: () => string }).getValue()).toBe('same note')
    expect(onInput).not.toHaveBeenCalled()
    expect(onchange).not.toHaveBeenCalled()
  })

  it('discards a delayed popup edit after the input is unmounted', async () => {
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

    target.querySelector<HTMLButtonElement>('button[aria-label]')?.click()
    await tick()
    expect(popUpEditorStore.open).toBe(true)

    popUpEditorStore.value = 'stale edit after close'
    unmount(component)
    component = undefined
    popUpEditorStore.open = false
    await vi.advanceTimersByTimeAsync(100)
    await tick()

    expect(onInput).not.toHaveBeenCalled()
    expect(onchange).not.toHaveBeenCalled()
  })
})

describe('TextAreaInput autocomplete selection', () => {
  it('applies a clicked suggestion after focus moves out of the editor', async () => {
    const editor = await openAutocomplete()
    const suggestion = autocompleteSuggestion('char')
    expect(suggestion).toBeTruthy()

    suggestion!.focus()
    await tick()

    expect(document.activeElement).toBe(suggestion)
    expect(autocompleteSuggestion('char')).toBe(suggestion)
    autocompleteSuggestion('char')!.click()
    await tick()

    expect(editor.textContent).toBe('{{char}}')
  })

  it('continues to apply the selected suggestion with Enter', async () => {
    const editor = await openAutocomplete()

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    editor.dispatchEvent(event)
    await tick()

    expect(event.defaultPrevented).toBe(true)
    expect(editor.textContent).toBe('{{char}}')
  })
})
