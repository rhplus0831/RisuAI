import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const popupMocks = vi.hoisted(() => ({
  tokenize: vi.fn(),
}))

vi.mock('src/ts/tokenizer', () => ({ tokenize: popupMocks.tokenize }))
vi.mock('src/ts/parser/parser.svelte', () => ({
  ParseMarkdown: vi.fn(async (text: string) => text),
  risuChatParser: (text: string) => text,
}))
vi.mock('src/ts/process/modules', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/process/modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})
vi.mock('../SideBars/Toggles.svelte', async () => {
  const mock = await import('../ChatScreens/DefaultChatScreen.testChat.svelte')
  return { default: mock.default }
})
vi.mock('./MonacoEditor.svelte', async () => {
  const mock = await import('../ChatScreens/DefaultChatScreen.testChat.svelte')
  return { default: mock.default }
})
vi.mock('src/lang', () => ({
  language: {
    customPromptTemplateToggle: 'Toggles',
    close: 'Close',
    edit: 'Edit',
    loading: 'Loading',
    preview: 'Preview',
    tokens: 'tokens',
  },
}))

import PopupEditor from './PopupEditor.svelte'
import { popUpEditorStore } from 'src/ts/stores.svelte'
import { replaceResourceDatabase } from 'src/ts/server/resourceState.svelte'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

let component: Parameters<typeof unmount>[0] | undefined
let target: HTMLElement
let opener: HTMLButtonElement

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await tick()
}

beforeEach(() => {
  popupMocks.tokenize.mockReset()
  replaceResourceDatabase({ globalChatVariables: {}, useMonacoEditorOnDesktop: true } as never)
  popUpEditorStore.open = true
  popUpEditorStore.language = 'markdown'
  popUpEditorStore.value = 'first text'
  opener = document.createElement('button')
  opener.textContent = 'Open editor'
  target = document.createElement('div')
  document.body.append(opener, target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  opener.remove()
  target.remove()
})

describe('PopupEditor token count', () => {
  it('renders a plain textarea and keeps the popup value in sync when Monaco is disabled', async () => {
    replaceResourceDatabase({ globalChatVariables: {}, useMonacoEditorOnDesktop: false } as never)
    component = mount(PopupEditor, { target })
    await settle()

    const textarea = target.querySelector<HTMLTextAreaElement>('textarea')
    expect(textarea).not.toBeNull()
    expect(textarea?.value).toBe('first text')

    textarea!.value = 'edited text'
    textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    expect(popUpEditorStore.value).toBe('edited text')
  })

  it('uses the Monaco path when the desktop setting is enabled', async () => {
    component = mount(PopupEditor, { target })
    await settle()

    expect(target.querySelector('textarea')).toBeNull()
    await vi.waitFor(() => expect(target.textContent).not.toContain('Loading'))
  })

  it('ignores a slower count for older preview text', async () => {
    const first = deferred<number>()
    const second = deferred<number>()
    popupMocks.tokenize.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    component = mount(PopupEditor, { target })
    await tick()

    const preview = Array.from(target.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Preview',
    )
    expect(preview).toBeDefined()
    preview!.click()
    await tick()
    expect(popupMocks.tokenize).toHaveBeenCalledWith('first text')

    popUpEditorStore.value = 'second text'
    await tick()
    expect(popupMocks.tokenize).toHaveBeenLastCalledWith('second text')

    second.resolve(2)
    await tick()
    first.resolve(1)
    await tick()

    expect(target.textContent).toContain('tokens: 2')
    expect(target.textContent).not.toContain('tokens: 1')
  })

  it('contains focus and restores the opener after Escape closes the editor', async () => {
    opener.focus()
    component = mount(PopupEditor, { target })
    await settle()

    const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
    const backdrop = dialog?.parentElement
    const close = dialog?.querySelector<HTMLElement>('[data-modal-initial-focus]')
    if (!dialog || !backdrop || !close) throw new Error('Popup editor modal not found')
    expect(backdrop.hasAttribute('data-modal-root')).toBe(true)
    expect(dialog.getAttribute('aria-labelledby')).toBe('risu-popup-editor-title')
    expect(opener.inert).toBe(true)
    expect(document.activeElement).toBe(close)

    opener.focus()
    expect(document.activeElement).toBe(close)

    const escape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
    close.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(popUpEditorStore.open).toBe(false)

    unmount(component)
    component = undefined
    await settle()
    expect(opener.inert).toBe(false)
    expect(document.activeElement).toBe(opener)
  })
})
