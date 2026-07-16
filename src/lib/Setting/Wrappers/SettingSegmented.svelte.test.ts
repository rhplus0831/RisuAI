import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const segmentedMocks = vi.hoisted(() => ({
  currentValue: undefined as unknown,
  setSettingValue: vi.fn(),
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
  getLabel: (item: { fallbackLabel?: string; id: string }) => item.fallbackLabel ?? item.id,
  getSettingValue: () => segmentedMocks.currentValue,
  setSettingValue: (item: SettingItem, value: unknown, ctx: SettingContext) => {
    segmentedMocks.currentValue = value
    segmentedMocks.setSettingValue(item, value, ctx)
    item.onChange?.(value, ctx)
  },
}))

import SettingSegmented from './SettingSegmented.svelte'
import type { SettingContext, SettingItem } from 'src/ts/setting/types'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

const ctx: SettingContext = {
  db: {} as any,
  modelInfo: {} as any,
  subModelInfo: {} as any,
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  segmentedMocks.currentValue = undefined
  segmentedMocks.setSettingValue.mockClear()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('SettingSegmented initial values', () => {
  it.each([
    ['unknown', 'newer-mode'],
    ['conditionally hidden', 'temporarily-hidden'],
  ])('does not rewrite an %s persisted value on mount', async (_case, value) => {
    const action = vi.fn()
    const item: SettingItem = {
      id: 'test.mode',
      type: 'segmented',
      fallbackLabel: 'Mode',
      onChange: action,
      options: {
        segmentOptions: [
          { value: 'standard', label: 'Standard' },
          {
            value: 'temporarily-hidden',
            label: 'Temporarily hidden',
            condition: () => value !== 'temporarily-hidden',
          },
          { value: 'advanced', label: 'Advanced' },
        ],
      },
    }
    segmentedMocks.currentValue = value

    component = mount(SettingSegmented, { target, props: { item, ctx } })
    await tick()

    expect(segmentedMocks.currentValue).toBe(value)
    expect(segmentedMocks.setSettingValue).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
  })
})
