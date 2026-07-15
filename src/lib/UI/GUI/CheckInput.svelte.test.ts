import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CheckInput from './CheckInput.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

function checkbox(): HTMLInputElement {
  const input = target.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!input) throw new Error('checkbox not found')
  return input
}

function pressSpace(input: HTMLInputElement): void {
  const keydown = new KeyboardEvent('keydown', {
    key: ' ',
    code: 'Space',
    bubbles: true,
    cancelable: true,
  })
  const shouldRunNativeAction = input.dispatchEvent(keydown)
  if (shouldRunNativeAction) input.click()
  input.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }))
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('CheckInput accessibility', () => {
  it('keeps the native checkbox in the Tab order and exposes visible focus feedback', () => {
    component = mount(CheckInput, {
      target,
      props: { check: false, name: 'Enable notifications' },
    })

    const input = checkbox()
    const indicator = target.querySelector<HTMLSpanElement>('span[aria-hidden="true"]')

    expect(input.tabIndex).toBe(0)
    expect(input.classList).toContain('sr-only')
    expect(input.classList).toContain('peer')
    expect(input.classList).not.toContain('hidden')
    expect(indicator?.classList).toContain('peer-focus-visible:ring-2')
    expect(indicator?.classList).toContain('peer-focus-visible:ring-borderc')

    input.focus()
    expect(document.activeElement).toBe(input)
  })

  it('uses native Space activation and reports the checked value', async () => {
    const onChange = vi.fn()
    component = mount(CheckInput, {
      target,
      props: { check: false, name: 'Enable notifications', onChange },
    })
    const input = checkbox()

    input.focus()
    pressSpace(input)
    await tick()

    expect(input.checked).toBe(true)
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('provides an accessible name without broken ARIA references when text is hidden', () => {
    component = mount(CheckInput, {
      target,
      props: { check: false, name: 'Enable notifications', hiddenName: true },
    })

    const input = checkbox()
    expect(input.getAttribute('aria-label')).toBe('Enable notifications')
    expect(input.hasAttribute('aria-labelledby')).toBe(false)
    expect(input.hasAttribute('aria-describedby')).toBe(false)
    expect(target.querySelector('label')?.hasAttribute('aria-labelledby')).toBe(false)
    expect(target.querySelector('label')?.hasAttribute('aria-describedby')).toBe(false)
  })
})
