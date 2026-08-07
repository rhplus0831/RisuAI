import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const separateParameterMocks = vi.hoisted(() => ({
  parameters: ['temperature'] as string[],
}))

vi.mock('src/ts/server/resourceState.svelte', () => ({
  getResourceDatabase: () => ({}),
}))

vi.mock('src/ts/model/modellist', () => ({
  getModelInfo: () => ({ flags: [], parameters: separateParameterMocks.parameters }),
}))

vi.mock('src/ts/model/modelRoles', () => ({
  MODEL_ROLES: [],
  normalizeModelRole: () => null,
  resolveModelForRole: () => 'test-model',
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  downloadFile: vi.fn(),
}))

vi.mock('src/ts/filePicker', () => ({
  selectSingleFile: vi.fn(),
}))

vi.mock('src/ts/server/seperateParametersImport', () => ({
  parseSeperateParametersImport: vi.fn(),
}))

vi.mock('./Help.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import AllSeperateParameters from './AllSeperateParameters.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  separateParameterMocks.parameters = ['temperature']
})

afterEach(() => {
  if (component) unmount(component)
  component = undefined
  target.remove()
})

describe('separate parameter accessible names', () => {
  it('names every rendered range and its enable checkbox for the visible parameter', async () => {
    component = mount(AllSeperateParameters, {
      target,
      props: {
        paramKey: 'test-model',
        value: {
          temperature: 100,
          top_k: 40,
          repetition_penalty: 1,
          min_p: 0.1,
          top_a: 0.1,
          top_p: 0.9,
          frequency_penalty: 0,
          presence_penalty: 0,
          thinking_type: 'budget',
          thinking_tokens: 4000,
          verbosity: 1,
        } as any,
      },
    })
    await tick()

    const parameterNames = [
      language.temperature,
      language.modelProfiles.runtimeFields.topK,
      language.modelProfiles.runtimeFields.repetitionPenalty,
      language.modelProfiles.runtimeFields.minP,
      language.modelProfiles.runtimeFields.topA,
      language.modelProfiles.runtimeFields.topP,
      language.frequencyPenalty,
      language.modelProfiles.runtimeFields.presencePenalty,
      language.thinkingTokens,
    ]
    const sliderNames = Array.from(target.querySelectorAll<HTMLElement>('[role="slider"]'), (slider) =>
      slider.getAttribute('aria-label'),
    )
    const checkboxNames = Array.from(target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'), (checkbox) =>
      checkbox.getAttribute('aria-label'),
    )

    expect(sliderNames).toEqual(parameterNames)
    expect(checkboxNames).toEqual(parameterNames.map((name) => `${language.enable}: ${name}`))
    expect(new Set(sliderNames)).toHaveProperty('size', sliderNames.length)
    expect(new Set(checkboxNames)).toHaveProperty('size', checkboxNames.length)
    expect(sliderNames.some((name) => checkboxNames.includes(name))).toBe(false)
  })

  it('displays x100-scaled penalties as decimals and changes them in whole stored units', async () => {
    const value = {
      temperature: 100,
      top_k: 40,
      repetition_penalty: 1,
      min_p: 0.1,
      top_a: 0.1,
      top_p: 0.9,
      frequency_penalty: 70,
      presence_penalty: 80,
      thinking_type: 'budget',
      thinking_tokens: 4000,
      verbosity: 1,
    } as any
    component = mount(AllSeperateParameters, {
      target,
      props: {
        paramKey: 'test-model',
        value,
      },
    })
    await tick()

    const frequencyPenalty = target.querySelector<HTMLElement>(
      `[role="slider"][aria-label="${language.frequencyPenalty}"]`,
    )
    const presencePenalty = target.querySelector<HTMLElement>(
      `[role="slider"][aria-label="${language.modelProfiles.runtimeFields.presencePenalty}"]`,
    )
    expect(frequencyPenalty?.getAttribute('aria-valuetext')).toBe('0.70')
    expect(presencePenalty?.getAttribute('aria-valuetext')).toBe('0.80')

    frequencyPenalty?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await tick()

    expect(value.frequency_penalty).toBe(71)
  })

  it('renders capability-tiered reasoning and verbosity controls without sampler scaling', async () => {
    separateParameterMocks.parameters = [
      'reasoning_effort',
      'reasoning_effort_min_medium',
      'reasoning_effort_xhigh',
      'verbosity',
    ]
    const value = {
      thinking_type: 'off',
      reasoning_effort: 0,
      verbosity: 1,
    } as any
    component = mount(AllSeperateParameters, {
      target,
      props: { paramKey: 'test-model', value },
    })
    await tick()

    expect(value.reasoning_effort).toBe(1)
    const segments = Array.from(target.querySelectorAll<HTMLButtonElement>('[data-segment-btn]'))
    expect(segments.map((button) => button.textContent?.trim())).toEqual([
      'Medium',
      'High',
      'XHigh',
      'Low',
      'Medium',
      'High',
    ])

    segments.find((button) => button.textContent?.trim() === 'XHigh')?.click()
    await tick()
    expect(value.reasoning_effort).toBe(3)
  })
})
