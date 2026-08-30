import fs from 'node:fs'
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
import { setDatabaseLite } from 'src/ts/storage/database.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  setDatabaseLite({
    aiModel: 'test-model',
    subModel: 'test-model',
    lastLoadedLoadoutName: '',
    customSidebarItems: [{ id: 'model-picker', type: 'model', subType: '', label: 'Model' }],
  } as any)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  setDatabaseLite({} as any)
})

describe('CustomSidebar', () => {
  it('routes the model control to the canonical picker instead of the flat model field', async () => {
    component = mount(CustomSidebar, { target })
    await tick()
    const button = target.querySelector('button')
    expect(button?.textContent).toContain('Model presets')

    const source = fs.readFileSync('src/lib/SideBars/CustomSidebar.svelte', 'utf8')
    expect(source).toContain("openPresetListModal('global', 'model')")
    expect(source).not.toContain("createServerBackedSettingDraft<string>('aiModel'")
  })

  it('skips malformed setting rows instead of passing undefined into SettingRenderer', async () => {
    setDatabaseLite({
      aiModel: 'test-model',
      subModel: 'test-model',
      lastLoadedLoadoutName: '',
      customSidebarItems: [
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
      ],
    } as any)

    expect(() => {
      component = mount(CustomSidebar, { target })
    }).not.toThrow()
    await tick()

    expect(target.textContent).not.toContain('Unknown setting type')
    expect(target.textContent).not.toContain('Missing setting')
  })
})
