import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { language } from 'src/lang'
import SliderInput from './SliderInput.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

const sliderRect = {
  x: 100,
  y: 0,
  left: 100,
  top: 0,
  right: 300,
  bottom: 32,
  width: 200,
  height: 32,
  toJSON: () => ({}),
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) unmount(component)
  component = undefined
  target.remove()
})

async function mountSlider(
  props: Partial<{
    min: number
    max: number
    value: number
    step: number
    fixed: number
    multiple: number
    disableable: boolean
    customText: string | undefined
    ariaLabel: string
  }> = {},
): Promise<HTMLElement> {
  component = mount(SliderInput, {
    target,
    props: {
      min: 0,
      max: 100,
      value: 50,
      ariaLabel: 'Temperature',
      ...props,
    },
  })
  await tick()

  const slider = target.querySelector<HTMLElement>('[role="slider"]')
  if (!slider) throw new Error('Slider not found')
  vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue(sliderRect)
  return slider
}

function dispatchPointer(
  slider: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: PointerEventInit,
) {
  slider.dispatchEvent(new PointerEvent(type, { bubbles: true, ...init }))
}

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
    expect(slider?.querySelector('button, input')).toBeNull()
    expect(enable?.getAttribute('aria-label')).toBe(`${language.enable}: Temperature`)
    expect(enable?.getAttribute('aria-label')).not.toBe(slider?.getAttribute('aria-label'))
    expect(enable?.checked).toBe(true)

    enable?.click()
    await tick()

    expect(enable?.checked).toBe(false)
    expect(slider?.getAttribute('aria-valuetext')).toBe(language.disabled)
    expect(slider?.getAttribute('aria-disabled')).toBe('true')
    expect(slider?.hasAttribute('tabindex')).toBe(false)

    slider?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 5 }))
    slider?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    await tick()

    expect(enable?.checked).toBe(false)
    expect(slider?.getAttribute('aria-valuetext')).toBe(language.disabled)

    enable?.click()
    await tick()

    expect(enable?.checked).toBe(true)
    expect(slider?.hasAttribute('aria-disabled')).toBe(false)
    expect(slider?.getAttribute('tabindex')).toBe('0')
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

describe('SliderInput pointer gestures', () => {
  it('does not change the value on touch pointerdown alone', async () => {
    const slider = await mountSlider()

    dispatchPointer(slider, 'pointerdown', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 120,
      clientY: 10,
    })
    await tick()

    expect(slider.getAttribute('aria-valuenow')).toBe('50')
  })

  it('changes touch drags beyond the slop relative to the starting value', async () => {
    const slider = await mountSlider()

    dispatchPointer(slider, 'pointerdown', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 120,
      clientY: 10,
    })
    dispatchPointer(slider, 'pointermove', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 140,
      clientY: 11,
    })
    await tick()

    expect(slider.getAttribute('aria-valuenow')).toBe('60')
  })

  it('leaves the value unchanged when touch movement stays below the slop', async () => {
    const slider = await mountSlider()

    dispatchPointer(slider, 'pointerdown', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 120,
      clientY: 10,
    })
    dispatchPointer(slider, 'pointermove', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 127,
      clientY: 11,
    })
    dispatchPointer(slider, 'pointerup', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 127,
      clientY: 11,
    })
    await tick()

    expect(slider.getAttribute('aria-valuenow')).toBe('50')
  })

  it('still changes the value immediately on mouse pointerdown', async () => {
    const slider = await mountSlider()

    dispatchPointer(slider, 'pointerdown', {
      pointerId: 2,
      pointerType: 'mouse',
      clientX: 160,
      clientY: 10,
    })
    await tick()

    expect(slider.getAttribute('aria-valuenow')).toBe('30')
  })

  it('resets a pending touch gesture on pointercancel without changing the value', async () => {
    const slider = await mountSlider()

    dispatchPointer(slider, 'pointerdown', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 120,
      clientY: 10,
    })
    dispatchPointer(slider, 'pointercancel', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 120,
      clientY: 30,
    })
    dispatchPointer(slider, 'pointermove', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 220,
      clientY: 30,
    })
    await tick()

    expect(slider.getAttribute('aria-valuenow')).toBe('50')
  })
})

describe('SliderInput numeric editing', () => {
  it('converts the display value to raw units, rounds it, and clamps Enter commits', async () => {
    const slider = await mountSlider({ min: 0, max: 1, value: 0.25, step: 0.05, fixed: 1, multiple: 100 })

    const editButton = target.querySelector<HTMLButtonElement>('button')
    expect(editButton?.textContent?.trim()).toBe('25.0')
    expect(editButton?.getAttribute('aria-label')).toBe(`Temperature: ${language.edit} ${language.value}`)
    editButton?.click()
    await tick()

    let input = target.querySelector<HTMLInputElement>('input[type="number"]')
    expect(input?.value).toBe('25.0')
    expect(input?.getAttribute('inputmode')).toBe('decimal')
    input!.value = '42.6'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await tick()

    expect(slider.getAttribute('aria-valuenow')).toBe('0.45')

    target.querySelector<HTMLButtonElement>('button')?.click()
    await tick()
    input = target.querySelector<HTMLInputElement>('input[type="number"]')
    input!.value = '150'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await tick()

    expect(slider.getAttribute('aria-valuenow')).toBe('1')
  })

  it('cancels numeric editing on Escape', async () => {
    const slider = await mountSlider({ min: 0, max: 1, value: 0.25, fixed: 1, multiple: 100 })

    target.querySelector<HTMLButtonElement>('button')?.click()
    await tick()
    const input = target.querySelector<HTMLInputElement>('input[type="number"]')
    input!.value = '75'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await tick()

    expect(target.querySelector('input[type="number"]')).toBeNull()
    expect(slider.getAttribute('aria-valuenow')).toBe('0.25')
    expect(target.querySelector<HTMLButtonElement>('button')?.textContent?.trim()).toBe('25.0')
  })

  it('silently reverts an invalid numeric entry', async () => {
    const slider = await mountSlider({ min: 0, max: 1, value: 0.25, fixed: 1, multiple: 100 })

    target.querySelector<HTMLButtonElement>('button')?.click()
    await tick()
    const input = target.querySelector<HTMLInputElement>('input[type="number"]')
    input!.value = ''
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await tick()

    expect(target.querySelector('input[type="number"]')).toBeNull()
    expect(slider.getAttribute('aria-valuenow')).toBe('0.25')
    expect(target.querySelector<HTMLButtonElement>('button')?.textContent?.trim()).toBe('25.0')
  })
})
