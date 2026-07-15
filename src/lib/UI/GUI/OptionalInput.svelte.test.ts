import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import OptionalInput from './OptionalInput.svelte'
import { language } from 'src/lang'

describe('OptionalInput controls', () => {
  let target: HTMLElement
  let component: ReturnType<typeof mount> | undefined

  beforeEach(() => {
    target = document.createElement('div')
    document.body.appendChild(target)
  })

  afterEach(() => {
    if (component) unmount(component)
    target.remove()
  })

  it('assigns the selected boolean instead of toggling both buttons', async () => {
    component = mount(OptionalInput, {
      target,
      props: { label: 'temperature_last', value: true, boolMode: true },
    })
    const [trueButton, falseButton] = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).slice(-2)

    trueButton.click()
    await tick()
    expect(trueButton.getAttribute('aria-pressed')).toBe('true')
    expect(falseButton.getAttribute('aria-pressed')).toBe('false')

    falseButton.click()
    await tick()
    expect(trueButton.getAttribute('aria-pressed')).toBe('false')
    expect(falseButton.getAttribute('aria-pressed')).toBe('true')

    falseButton.click()
    await tick()
    expect(falseButton.getAttribute('aria-pressed')).toBe('true')
  })

  it('gives the enable checkbox and default value distinct parameter-specific names', async () => {
    component = mount(OptionalInput, {
      target,
      props: { label: 'tokenizer', value: null },
    })

    const checkbox = target.querySelector<HTMLInputElement>(
      `input[type="checkbox"][aria-label="${language.enable}: tokenizer"]`,
    )
    const defaultValue = target.querySelector<HTMLInputElement>(`input[aria-label="${language.value}: tokenizer"]`)
    expect(checkbox?.checked).toBe(false)
    expect(defaultValue?.disabled).toBe(true)
    expect(checkbox?.getAttribute('aria-label')).not.toBe(defaultValue?.getAttribute('aria-label'))

    checkbox?.click()
    await tick()

    const valueInput = target.querySelector<HTMLInputElement>(`input[aria-label="${language.value}: tokenizer"]`)
    expect(checkbox?.checked).toBe(true)
    expect(valueInput?.disabled).toBe(false)
  })

  it('includes the parameter purpose in number and boolean value choices', () => {
    component = mount(OptionalInput, {
      target,
      props: { label: 'top_k', value: 40, numberMode: true },
    })
    expect(target.querySelector(`input[type="number"][aria-label="${language.value}: top_k"]`)).toBeTruthy()
    unmount(component)

    component = mount(OptionalInput, {
      target,
      props: { label: 'do_sample', value: true, boolMode: true },
    })
    expect(target.querySelector(`button[aria-label="${language.value}: do_sample: True"]`)).toBeTruthy()
    expect(target.querySelector(`button[aria-label="${language.value}: do_sample: False"]`)).toBeTruthy()
  })
})
