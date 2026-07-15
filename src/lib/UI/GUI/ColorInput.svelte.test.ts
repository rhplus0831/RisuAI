import { mount, unmount } from 'svelte'
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
})
