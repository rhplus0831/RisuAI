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
})
