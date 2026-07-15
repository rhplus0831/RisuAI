import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { language } from 'src/lang'
import SliderInput from './SliderInput.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) unmount(component)
  component = undefined
  target.remove()
})

describe('SliderInput accessible names', () => {
  it('gives the range and its optional enable control distinct parameter-specific names', async () => {
    component = mount(SliderInput, {
      target,
      props: {
        min: 0,
        max: 10,
        value: 5,
        disableable: true,
        ariaLabel: 'Temperature',
      },
    })
    await tick()

    const slider = target.querySelector<HTMLElement>('[role="slider"]')
    const enable = target.querySelector<HTMLInputElement>('input[type="checkbox"]')

    expect(slider?.getAttribute('aria-label')).toBe('Temperature')
    expect(slider?.getAttribute('aria-valuenow')).toBe('5')
    expect(enable?.getAttribute('aria-label')).toBe(`${language.enable}: Temperature`)
    expect(enable?.getAttribute('aria-label')).not.toBe(slider?.getAttribute('aria-label'))
    expect(enable?.checked).toBe(true)

    enable?.click()
    await tick()

    expect(enable?.checked).toBe(false)
    expect(slider?.getAttribute('aria-valuetext')).toBe(language.disabled)
  })

  it('accepts a caller-provided name for the optional enable control', async () => {
    component = mount(SliderInput, {
      target,
      props: {
        min: 0,
        max: 10,
        value: 5,
        disableable: true,
        ariaLabel: 'Temperature',
        enableAriaLabel: 'Use temperature override',
      },
    })
    await tick()

    expect(target.querySelector('[role="slider"]')?.getAttribute('aria-label')).toBe('Temperature')
    expect(target.querySelector('input[type="checkbox"]')?.getAttribute('aria-label')).toBe('Use temperature override')
  })
})
