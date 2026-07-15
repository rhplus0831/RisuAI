import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const settingMocks = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

vi.mock('src/ts/setting/utils', () => ({
  UNINITIALIZED: Symbol('UNINITIALIZED'),
  getLabel: (item: { fallbackLabel?: string }) => item.fallbackLabel ?? '',
  getSettingValue: (item: { id: string }) => settingMocks.values.get(item.id),
  getSettingWriteOwnerKey: (item: { id: string }) => item.id,
  setSettingValue: (item: { id: string }, value: unknown) => settingMocks.values.set(item.id, value),
}))

vi.mock('src/ts/setting/inputDraft.svelte', () => ({
  createSettingInputDraft: (getItem: () => { id: string }) => ({
    value: settingMocks.values.get(getItem().id),
  }),
}))

import SettingNumber from './SettingNumber.svelte'
import SettingColor from './SettingColor.svelte'
import SettingSelect from './SettingSelect.svelte'
import SettingSlider from './SettingSlider.svelte'
import SettingText from './SettingText.svelte'
import SettingTextarea from './SettingTextarea.svelte'
import { language } from 'src/lang'
import type { SettingContext, SettingItem } from 'src/ts/setting/types'

type MountedComponent = Parameters<typeof unmount>[0]

const ctx: SettingContext = {
  db: {} as any,
  modelInfo: {} as any,
  subModelInfo: {} as any,
}

let target: HTMLElement
let component: MountedComponent | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  settingMocks.values.clear()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

async function mountSetting(
  SettingComponent: Parameters<typeof mount>[0],
  item: SettingItem,
  value: unknown,
): Promise<void> {
  settingMocks.values.set(item.id, value)
  component = mount(SettingComponent, { target, props: { item, ctx } })
  await tick()
}

async function resetMountedSetting(): Promise<void> {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.replaceChildren()
  await tick()
}

describe('data-driven setting input labels', () => {
  it('gives every core setting control the visible setting name', async () => {
    await mountSetting(SettingText, { id: 'accessible.text', type: 'text', fallbackLabel: 'Text setting' }, 'value')
    expect(target.querySelector('input[type="text"]')?.getAttribute('aria-label')).toBe('Text setting')

    await resetMountedSetting()
    await mountSetting(SettingNumber, { id: 'accessible.number', type: 'number', fallbackLabel: 'Number setting' }, 2)
    expect(target.querySelector('input[type="number"]')?.getAttribute('aria-label')).toBe('Number setting')

    await resetMountedSetting()
    await mountSetting(
      SettingSelect,
      {
        id: 'accessible.select',
        type: 'select',
        fallbackLabel: 'Select setting',
        options: { selectOptions: [{ value: 'a', label: 'A' }] },
      },
      'a',
    )
    expect(target.querySelector('select')?.getAttribute('aria-label')).toBe('Select setting')

    await resetMountedSetting()
    await mountSetting(
      SettingTextarea,
      { id: 'accessible.textarea', type: 'textarea', fallbackLabel: 'Textarea setting' },
      'value',
    )
    expect(target.querySelector('textarea')?.getAttribute('aria-label')).toBe('Textarea setting')

    await resetMountedSetting()
    await mountSetting(
      SettingSlider,
      {
        id: 'accessible.slider',
        type: 'slider',
        fallbackLabel: 'Slider setting',
        options: { min: 0, max: 10, disableable: true },
      },
      5,
    )
    expect(target.querySelector('[role="slider"]')?.getAttribute('aria-label')).toBe('Slider setting')
    expect(target.querySelector('input[type="checkbox"]')?.getAttribute('aria-label')).toBe(
      `${language.enable}: Slider setting`,
    )

    await resetMountedSetting()
    await mountSetting(
      SettingColor,
      { id: 'accessible.color', type: 'color', fallbackLabel: 'Color setting' },
      '#123456',
    )
    const colorInput = target.querySelector<HTMLInputElement>('input[type="color"]')
    expect(colorInput?.value).toBe('#123456')
    expect(colorInput?.labels?.[0]?.textContent?.trim()).toBe('Color setting')
  })
})
