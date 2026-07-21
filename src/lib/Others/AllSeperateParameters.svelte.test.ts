import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/server/resourceState.svelte', () => ({
  getResourceDatabase: () => ({}),
}))

vi.mock('src/ts/model/modellist', () => ({
  getModelInfo: () => ({ flags: [], parameters: ['temperature'] }),
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
      language.modelProfiles.runtimeFields.verbosity,
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
})
