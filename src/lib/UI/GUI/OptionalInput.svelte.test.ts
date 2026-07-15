import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import OptionalInput from './OptionalInput.svelte'

describe('OptionalInput boolean controls', () => {
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
      props: { value: true, boolMode: true },
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
})
