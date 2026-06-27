import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const accordionMocks = vi.hoisted(() => ({
  getLabel: vi.fn((item) => item.fallbackLabel ?? item.id),
}))

vi.mock('src/ts/setting/utils', () => ({
  getLabel: accordionMocks.getLabel,
}))

vi.mock('src/lib/UI/Accordion.svelte', async () => {
  const { default: AccordionHarness } = await import('src/lib/Setting/testHarness/AccordionHarness.svelte')
  return { default: AccordionHarness }
})

vi.mock('../SettingRenderer.svelte', async () => {
  const { default: SettingRendererPropsProbe } =
    await import('src/lib/Setting/testHarness/SettingRendererPropsProbe.svelte')
  return { default: SettingRendererPropsProbe }
})

import SettingAccordion from './SettingAccordion.svelte'
import type { SettingContext, SettingItem } from 'src/ts/setting/types'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  accordionMocks.getLabel.mockClear()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  document.body.innerHTML = ''
})

describe('SettingAccordion rendered behavior', () => {
  it('forwards renderer context to nested setting rows', async () => {
    const item: SettingItem = {
      id: 'accordion.prompt-overrides',
      type: 'accordion',
      fallbackLabel: 'Prompt Overrides',
      options: {
        children: [{ id: 'accordion.child', type: 'header', fallbackLabel: 'Nested child' }],
      },
    }
    const ctx: SettingContext = {
      db: {} as any,
      modelInfo: { id: 'model-main' } as any,
      presetMirrorTarget: 'promptModelOverrides',
      subModelInfo: { id: 'model-sub' } as any,
    }

    component = mount(SettingAccordion, { target, props: { item, ctx } })
    await tick()

    const button = Array.from(target.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Prompt Overrides'),
    )
    expect(button).toBeTruthy()
    button!.click()
    await tick()

    const probe = target.querySelector<HTMLElement>('[data-setting-renderer-probe]')
    expect(probe).toBeTruthy()
    expect(probe!.dataset.items).toBe('1')
    expect(probe!.dataset.model).toBe('model-main')
    expect(probe!.dataset.subModel).toBe('model-sub')
    expect(probe!.dataset.presetMirrorTarget).toBe('promptModelOverrides')
  })
})
