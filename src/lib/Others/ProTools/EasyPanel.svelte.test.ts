import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { language } from 'src/lang'
import { easyPanelStore } from 'src/ts/stores.svelte'
import EasyPanel from './EasyPanel.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let background: HTMLButtonElement
let component: MountedComponent | undefined
let opener: HTMLButtonElement
let target: HTMLElement

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await tick()
}

function mountPanel(): void {
  opener.focus()
  component = mount(EasyPanel, { target })
}

function getModalElements(): {
  backdrop: HTMLElement
  close: HTMLButtonElement
  dialog: HTMLElement
} {
  const backdrop = target.querySelector<HTMLElement>('[data-testid="easy-panel-backdrop"]')
  const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
  const close = dialog?.querySelector<HTMLButtonElement>('[data-modal-initial-focus]')
  if (!backdrop || !dialog || !close) throw new Error('Easy Panel modal not found')
  return { backdrop, close, dialog }
}

beforeEach(() => {
  easyPanelStore.open = true
  opener = document.createElement('button')
  opener.textContent = 'Open Easy Panel'
  background = document.createElement('button')
  background.textContent = 'Background action'
  target = document.createElement('div')
  document.body.append(opener, background, target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  easyPanelStore.open = false
  document.body.innerHTML = ''
})

describe('EasyPanel modal accessibility', () => {
  it('exposes a blocking named dialog and contains focus', async () => {
    mountPanel()
    await settle()

    const { backdrop, close, dialog } = getModalElements()
    expect(backdrop.hasAttribute('data-modal-root')).toBe(true)
    expect(backdrop.classList.contains('pointer-events-none')).toBe(false)
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('risu-easy-panel-title')
    expect(target.querySelector('#risu-easy-panel-title')?.textContent).toContain(language.easyPanel)
    expect(close.getAttribute('aria-label')).toBe(language.close)
    expect(opener.inert).toBe(true)
    expect(background.inert).toBe(true)
    expect(document.activeElement).toBe(close)

    background.focus()
    expect(document.activeElement).toBe(close)
  })

  it('closes on Escape and restores focus to the opener when removed', async () => {
    mountPanel()
    await settle()

    const { close } = getModalElements()
    const escape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
    close.dispatchEvent(escape)

    expect(escape.defaultPrevented).toBe(true)
    expect(easyPanelStore.open).toBe(false)

    unmount(component!)
    component = undefined
    await settle()

    expect(opener.inert).toBe(false)
    expect(background.inert).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it('owns viewport-edge backdrop clicks instead of activating the background', async () => {
    const backgroundClick = vi.fn()
    background.addEventListener('click', backgroundClick)
    mountPanel()
    await settle()

    const { backdrop } = getModalElements()
    backdrop.click()

    expect(backgroundClick).not.toHaveBeenCalled()
    expect(easyPanelStore.open).toBe(false)
  })
})
