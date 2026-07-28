import { describe, expect, it, vi } from 'vitest'
import { modalBackdropDismiss } from './modalBackdropDismiss'

function pointerEvent(type: string, options: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    button: 0,
    isPrimary: true,
    pointerId: 1,
    ...options,
  })
}

function clickEvent(detail = 1): MouseEvent {
  return new MouseEvent('click', { bubbles: true, button: 0, detail })
}

function createModal(): { backdrop: HTMLDivElement; dialog: HTMLDivElement; input: HTMLInputElement } {
  const backdrop = document.createElement('div')
  const dialog = document.createElement('div')
  const input = document.createElement('input')
  dialog.append(input)
  backdrop.append(dialog)
  document.body.append(backdrop)
  return { backdrop, dialog, input }
}

describe('modalBackdropDismiss', () => {
  it('dismisses a primary pointer click that starts and ends on the backdrop', () => {
    const { backdrop } = createModal()
    const dismiss = vi.fn()
    const action = modalBackdropDismiss(backdrop, dismiss)

    backdrop.dispatchEvent(pointerEvent('pointerdown'))
    backdrop.dispatchEvent(pointerEvent('pointerup'))
    backdrop.dispatchEvent(clickEvent())

    expect(dismiss).toHaveBeenCalledOnce()
    action.destroy()
    backdrop.remove()
  })

  it('does not dismiss when a drag starts in a dialog control and ends on the backdrop', () => {
    const { backdrop, input } = createModal()
    const dismiss = vi.fn()
    const action = modalBackdropDismiss(backdrop, dismiss)

    input.dispatchEvent(pointerEvent('pointerdown'))
    backdrop.dispatchEvent(pointerEvent('pointerup'))
    backdrop.dispatchEvent(clickEvent())

    expect(dismiss).not.toHaveBeenCalled()
    action.destroy()
    backdrop.remove()
  })

  it('does not dismiss when a drag starts on the backdrop and ends in the dialog', () => {
    const { backdrop, dialog } = createModal()
    const dismiss = vi.fn()
    const action = modalBackdropDismiss(backdrop, dismiss)

    backdrop.dispatchEvent(pointerEvent('pointerdown'))
    dialog.dispatchEvent(pointerEvent('pointerup'))
    backdrop.dispatchEvent(clickEvent())

    expect(dismiss).not.toHaveBeenCalled()
    action.destroy()
    backdrop.remove()
  })

  it('preserves synthetic backdrop clicks and action callback updates', () => {
    const { backdrop } = createModal()
    const initialDismiss = vi.fn()
    const nextDismiss = vi.fn()
    const action = modalBackdropDismiss(backdrop, initialDismiss)
    action.update(nextDismiss)

    backdrop.click()

    expect(initialDismiss).not.toHaveBeenCalled()
    expect(nextDismiss).toHaveBeenCalledOnce()
    action.destroy()
    backdrop.remove()
  })

  it('ignores non-primary pointer gestures', () => {
    const { backdrop } = createModal()
    const dismiss = vi.fn()
    const action = modalBackdropDismiss(backdrop, dismiss)

    backdrop.dispatchEvent(pointerEvent('pointerdown', { button: 2 }))
    backdrop.dispatchEvent(pointerEvent('pointerup', { button: 2 }))
    backdrop.dispatchEvent(clickEvent())

    expect(dismiss).not.toHaveBeenCalled()
    action.destroy()
    backdrop.remove()
  })
})
