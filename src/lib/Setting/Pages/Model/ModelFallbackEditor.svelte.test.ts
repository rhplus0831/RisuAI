import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

import type { ModelProfileRecordFallbackRef } from 'src/ts/model/modelProfileRecords'
import ModelFallbackEditorTestHost from './ModelFallbackEditor.testHost.svelte'
import { language } from 'src/lang'

type MountedHost = Parameters<typeof unmount>[0] & {
  currentValue: () => ModelProfileRecordFallbackRef[]
}

let component: MountedHost | undefined
let target: HTMLElement

function modelInput(): HTMLInputElement {
  const input = target.querySelector<HTMLInputElement>('input[type="text"]')
  if (!input) throw new Error('fallback model input not found')
  return input
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

describe('ModelFallbackEditor row identity', () => {
  it('keeps the model input mounted and focused while its editable value changes', async () => {
    component = mount(ModelFallbackEditorTestHost, { target }) as MountedHost
    await tick()

    const input = modelInput()
    input.focus()
    input.value = 'updated-model'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()

    expect(component.currentValue()).toEqual([{ mode: 'model', modelId: 'updated-model' }])
    expect(modelInput()).toBe(input)
    expect(document.activeElement).toBe(input)
  })

  it('gives every fallback control and remove action a row-aware accessible name', async () => {
    component = mount(ModelFallbackEditorTestHost, {
      target,
      props: {
        profiles: [
          { id: 'profile-a', name: 'Profile A' },
          { id: 'profile-b', name: 'Profile B' },
        ],
        initialValue: [
          { mode: 'profile', profileId: 'profile-a' },
          { mode: 'model', modelId: 'raw-model' },
          { mode: 'profile', profileId: 'profile-b' },
        ],
      },
    }) as MountedHost
    await tick()

    for (const index of [1, 2, 3]) {
      const mode = target.querySelector<HTMLSelectElement>(
        `select[aria-label="${language.modelProfiles.fallbackModeLabel(index)}"]`,
      )
      const remove = target.querySelector<HTMLButtonElement>(
        `button[aria-label="${language.modelProfiles.removeFallbackLabel(index)}"]`,
      )
      expect(mode, `fallback ${index} mode`).toBeTruthy()
      expect(remove, `fallback ${index} remove`).toBeTruthy()
    }

    expect(target.querySelector(`select[aria-label="${language.modelProfiles.fallbackProfileLabel(1)}"]`)).toBeTruthy()
    expect(target.querySelector(`input[aria-label="${language.modelProfiles.fallbackModelLabel(2)}"]`)).toBeTruthy()
    expect(target.querySelector(`select[aria-label="${language.modelProfiles.fallbackProfileLabel(3)}"]`)).toBeTruthy()
  })
})
