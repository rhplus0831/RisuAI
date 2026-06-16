import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

import CustomSidebar from './CustomSidebar.svelte'
import { DBState } from 'src/ts/stores.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  DBState.db = {
    aiModel: 'test-model',
    subModel: 'test-model',
    lastLoadedLoadoutName: '',
    customSidebarItems: [],
  } as any
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  DBState.db = {} as any
})

describe('CustomSidebar', () => {
  it('skips malformed setting rows instead of passing undefined into SettingRenderer', async () => {
    DBState.db.customSidebarItems = [
      {
        id: 'missing-setting',
        type: 'setting',
        subType: 'not-a-real-setting',
        label: 'Missing setting',
      },
      {
        id: 'missing-subtype',
        type: 'setting',
        label: 'Missing subtype',
      },
    ] as any

    expect(() => {
      component = mount(CustomSidebar, { target })
    }).not.toThrow()
    await tick()

    expect(target.textContent).not.toContain('Unknown setting type')
    expect(target.textContent).not.toContain('Missing setting')
  })
})
