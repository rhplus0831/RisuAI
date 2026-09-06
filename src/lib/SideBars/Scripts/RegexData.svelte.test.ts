import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { customscript } from 'src/ts/storage/database.svelte'

const regexDataMocks = vi.hoisted(() => ({
  alertConfirm: vi.fn(async () => true),
}))

vi.mock('src/lang', () => ({
  language: {
    hotkeyDesc: { popupEditor: 'Popup Editor' },
    remove: 'Remove',
    removeConfirm: 'Remove ',
    regexEmotionEffectUnsupportedOnServer: '@@emo is unsupported on this server.',
  },
}))

vi.mock('src/ts/alert', () => ({
  alertConfirm: regexDataMocks.alertConfirm,
}))

vi.mock('src/ts/stores.svelte', async () => {
  const { writable } = await import('svelte/store')
  return {
    closePopupEditorSession: vi.fn(),
    disableHighlight: writable(false),
    isPopupEditorSessionCurrent: vi.fn(() => false),
    openPopupEditorSession: vi.fn(() => 1),
    popUpEditorStore: { open: false, sessionId: 0, value: '' },
    selIdState: { selId: -1 },
  }
})

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
  it('balances an expanded row registration when its definition is destroyed externally', async () => {
    const onOpen = vi.fn()
    const onClose = vi.fn()
    component = mount(RegexData, {
      target,
      props: {
        value: {
          id: 'script-replaced',
          comment: 'Replaced script',
          in: '',
          out: '',
          type: 'editinput',
        } as customscript,
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

  it('settles one expanded-row deletion when the action is clicked repeatedly', async () => {
    let resolveConfirmation: (confirmed: boolean) => void = () => {}
    regexDataMocks.alertConfirm.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirmation = resolve
        }),
    )
    const onOpen = vi.fn()
    const onClose = vi.fn()
    const onRemove = vi.fn()
    const value = {
      id: 'script-open',
      comment: 'Open script',
      in: '',
      out: '',
      type: 'editinput',
    } as customscript

    component = mount(RegexData, {
      target,
      props: { value, idx: 0, onOpen, onClose, onRemove },
    })

    const expand = target.querySelector<HTMLButtonElement>('button.endflex')!
    const remove = target.querySelector<HTMLButtonElement>('[data-risu-regex-action="delete"]')!
    expand.click()
    await tick()
    remove.click()
    remove.click()
    await tick()

    expect(regexDataMocks.alertConfirm).toHaveBeenCalledTimes(1)
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

describe('RegexData action accessibility', () => {
  it('annotates @@emo output as a preserved server-unsupported effect', async () => {
    component = mount(RegexData, {
      target,
      props: {
        value: {
          id: 'emotion-effect',
          comment: 'Emotion effect',
          in: 'happy',
          out: '@@emo joy',
          type: 'editoutput',
        } as customscript,
        idx: 0,
      },
    })

    target.querySelector<HTMLButtonElement>('button.endflex')?.click()
    await tick()

    const annotation = target.querySelector('[data-risu-server-unsupported-regex-effect="@@emo"]')
    expect(annotation?.textContent).toContain('@@emo is unsupported on this server.')
  })

  it('names row deletion and exposes expansion and flag selection state', async () => {
    const value = {
      id: 'script-a',
      comment: 'Normalize names',
      in: '',
      out: '',
      type: 'editinput',
      ableFlag: true,
      flag: 'g',
    } as customscript

    component = mount(RegexData, {
      target,
      props: { value, idx: 2 },
    })

    const expand = target.querySelector<HTMLButtonElement>('button.endflex')
    const remove = target.querySelector<HTMLButtonElement>('[data-risu-regex-action="delete"]')
    expect(expand?.getAttribute('aria-expanded')).toBe('false')
    expect(remove?.getAttribute('aria-label')).toBe('Remove: Normalize names')

    expand?.click()
    await tick()
    expect(expand?.getAttribute('aria-expanded')).toBe('true')

    const flagsAccordion = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'FLAGS',
    )
    flagsAccordion?.click()
    await tick()

    const globalFlag = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('Global (g)'),
    )
    const caseFlag = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('Case Insensitive (i)'),
    )
    expect(globalFlag?.getAttribute('aria-pressed')).toBe('true')
    expect(caseFlag?.getAttribute('aria-pressed')).toBe('false')
  })

  it('supports legacy custom-flag scripts whose flag value is absent', async () => {
    const value = {
      id: 'legacy-script',
      comment: 'Legacy script',
      in: '',
      out: '',
      type: 'editinput',
      ableFlag: true,
    } as customscript

    component = mount(RegexData, {
      target,
      props: { value, idx: 0 },
    })

    target.querySelector<HTMLButtonElement>('button.endflex')?.click()
    await tick()
    const flagsAccordion = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'FLAGS',
    )
    flagsAccordion?.click()
    await tick()

    const globalFlag = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('Global (g)'),
    )
    expect(globalFlag?.getAttribute('aria-pressed')).toBe('false')

    globalFlag?.click()
    await tick()
    expect(value.flag).toBe('g')
  })
})
