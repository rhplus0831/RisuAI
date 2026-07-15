import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/lib/UI/Accordion.svelte', async () => ({
  default: (await import('./ProviderListActions.testStub.svelte')).default,
}))
vi.mock('src/lib/UI/GUI/CheckInput.svelte', async () => ({
  default: (await import('./ProviderListActions.testStub.svelte')).default,
}))
vi.mock('src/lib/UI/GUI/SelectInput.svelte', async () => ({
  default: (await import('./ProviderListActions.testStub.svelte')).default,
}))
vi.mock('src/lib/UI/GUI/OptionInput.svelte', async () => ({
  default: (await import('./ProviderListActions.testStub.svelte')).default,
}))
vi.mock('src/lib/UI/GUI/OptionalInput.svelte', async () => ({
  default: (await import('./ProviderListActions.testStub.svelte')).default,
}))
vi.mock('src/lib/UI/GUI/TextInput.svelte', async () => ({
  default: (await import('./ProviderListActions.testStub.svelte')).default,
}))
vi.mock('src/lib/UI/OpenrouterProviderList.svelte', async () => ({
  default: (await import('./ProviderListActions.testStub.svelte')).default,
}))
vi.mock('./ChatFormatSettings.svelte', async () => ({
  default: (await import('./ProviderListActions.testStub.svelte')).default,
}))

vi.mock('src/ts/model/openrouter', () => ({
  getOpenRouterProviders: vi.fn(async () => ['Provider A']),
}))
vi.mock('src/ts/server/settingsBridge.svelte', () => ({
  createServerBackedSettingDraft: (key: string, fallback: unknown) => ({
    value:
      key === 'openrouterProvider'
        ? { order: ['Provider A'], only: ['Provider A'], ignore: ['Provider A'] }
        : key === 'localStopStrings'
          ? ['STOP']
          : fallback,
  }),
}))

import OobaSettings from './OobaSettings.svelte'
import OpenrouterSettings from './OpenrouterSettings.svelte'
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

describe('provider list icon actions', () => {
  it('names OpenRouter add and remove controls for each provider list', async () => {
    component = mount(OpenrouterSettings, { target })

    await vi.waitFor(() => {
      expect(target.querySelectorAll('button[aria-label]')).toHaveLength(6)
    })

    const labels = Array.from(target.querySelectorAll<HTMLButtonElement>('button[aria-label]')).map((button) =>
      button.getAttribute('aria-label'),
    )
    expect(labels).toEqual([
      `${language.add}: ${language.openRouterProviderOrder}`,
      `${language.remove}: ${language.openRouterProviderOrder}`,
      `${language.add}: ${language.openRouterProviderOnly}`,
      `${language.remove}: ${language.openRouterProviderOnly}`,
      `${language.add}: ${language.openRouterProviderIgnore}`,
      `${language.remove}: ${language.openRouterProviderIgnore}`,
    ])
  })

  it('names Ooba stop-word controls and includes the row identity', async () => {
    component = mount(OobaSettings, {
      target,
      props: { instructionMode: true },
    })
    await tick()

    const addButton = target.querySelector<HTMLButtonElement>(
      `button[aria-label="${language.add}: ${language.customStopWords}"]`,
    )
    const removeButton = target.querySelector<HTMLButtonElement>(
      `button[aria-label="${language.remove}: ${language.customStopWords} 1"]`,
    )
    expect(addButton?.type).toBe('button')
    expect(removeButton?.type).toBe('button')
  })
})
