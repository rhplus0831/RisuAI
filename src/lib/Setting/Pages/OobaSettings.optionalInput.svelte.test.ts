import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/lib/UI/Accordion.svelte', async () => ({
  default: (await import('./ProviderListActions.testStub.svelte')).default,
}))
vi.mock('src/lib/UI/GUI/SelectInput.svelte', async () => ({
  default: (await import('./ProviderListActions.testStub.svelte')).default,
}))
vi.mock('src/lib/UI/GUI/OptionInput.svelte', async () => ({
  default: (await import('./ProviderListActions.testStub.svelte')).default,
}))
vi.mock('./ChatFormatSettings.svelte', async () => ({
  default: (await import('./ProviderListActions.testStub.svelte')).default,
}))
vi.mock('src/ts/server/settingsBridge.svelte', () => ({
  createServerBackedSettingDraft: (key: string, fallback: unknown) => ({
    value:
      key === 'reverseProxyOobaArgs'
        ? {
            tokenizer: null,
            min_p: 0.1,
            top_k: 40,
          }
        : fallback,
  }),
}))

import OobaSettings from './OobaSettings.svelte'
import { language } from 'src/lang'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

function optionalGroup(label: string): HTMLElement {
  const group = target.querySelector<HTMLElement>(`[role="group"][aria-label="${label}"]`)
  if (!group) throw new Error(`Optional group not found: ${label}`)
  return group
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

describe('OobaSettings optional parameter names', () => {
  it('renders a distinct enable checkbox and value name for every general parameter', async () => {
    component = mount(OobaSettings, { target })
    await tick()

    const groups = Array.from(target.querySelectorAll<HTMLElement>('[role="group"][aria-label]'))
    const groupNames = groups.map((group) => group.getAttribute('aria-label'))
    expect(groups).toHaveLength(32)
    expect(groupNames.every(Boolean)).toBe(true)
    expect(new Set(groupNames).size).toBe(groupNames.length)

    const tokenizer = optionalGroup('tokenizer')
    const tokenizerToggle = tokenizer.querySelector<HTMLInputElement>('input[type="checkbox"]')
    const tokenizerValue = tokenizer.querySelector<HTMLInputElement>('input[type="text"]')
    expect(tokenizerToggle?.getAttribute('aria-label')).toBe(`${language.enable}: tokenizer`)
    expect(tokenizerToggle?.checked).toBe(false)
    expect(tokenizerValue?.getAttribute('aria-label')).toBe(`${language.value}: tokenizer`)
    expect(tokenizerValue?.disabled).toBe(true)
    expect(tokenizerToggle?.getAttribute('aria-label')).not.toBe(tokenizerValue?.getAttribute('aria-label'))

    for (const label of ['min_p', 'top_k']) {
      const group = optionalGroup(label)
      const checkbox = group.querySelector<HTMLInputElement>('input[type="checkbox"]')
      const value = group.querySelector<HTMLInputElement>('input[type="number"]')
      expect(checkbox?.getAttribute('aria-label')).toBe(`${language.enable}: ${label}`)
      expect(checkbox?.checked).toBe(true)
      expect(value?.getAttribute('aria-label')).toBe(`${language.value}: ${label}`)
      expect(value?.disabled).toBe(false)
    }
  })
})
