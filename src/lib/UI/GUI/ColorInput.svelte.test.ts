import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ColorInput from './ColorInput.svelte'
import { language } from 'src/lang'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

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

describe('ColorInput accessible name', () => {
  it('passes its label and value to the real native color input', async () => {
    component = mount(ColorInput, {
      target,
      props: {
        ariaLabel: 'Quote text color',
        nullable: true,
        value: '#123456',
      },
    })

    await vi.waitFor(() => {
      expect(target.querySelector('input[type="color"]')).toBeTruthy()
    })

    const input = target.querySelector<HTMLInputElement>('input[type="color"]')!
    const label = input.closest('label')
    const nullableCheckbox = target.querySelector<HTMLInputElement>('input[type="checkbox"]')

    expect(label?.textContent?.trim()).toBe('Quote text color')
    expect(input.value).toBe('#123456')
    expect(nullableCheckbox?.closest('label')?.textContent?.trim()).toBe(`${language.disable}: Quote text color`)
  })

  it('coalesces rapid color input into one committed change', async () => {
    const onchange = vi.fn()
    component = mount(ColorInput, {
      target,
      props: {
        ariaLabel: 'Background color',
        value: '#123456',
        onchange,
      },
    })
    await vi.waitFor(() => expect(target.querySelector('input[type="color"]')).toBeTruthy())
    vi.useFakeTimers()

    try {
      const input = target.querySelector<HTMLInputElement>('.text-input input:not([type])')!
      expect(input).toBeTruthy()
      for (const value of ['#234567', '#345678', '#456789']) {
        input.value = value
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
      }

      await vi.advanceTimersByTimeAsync(249)
      expect(onchange).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(onchange).toHaveBeenCalledOnce()
      expect(onchange).toHaveBeenCalledWith('#456789')
    } finally {
      vi.useRealTimers()
    }
  })
})
