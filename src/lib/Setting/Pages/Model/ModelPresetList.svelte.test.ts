import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const commandSpies = vi.hoisted(() => ({
  runServerCommand: vi.fn(),
  createModelPresetCommand: vi.fn(),
  updateModelPresetCommand: vi.fn(),
  deleteModelPresetCommand: vi.fn(),
  selectModelPresetCommand: vi.fn(),
  reorderModelPresetsCommand: vi.fn(),
}))

vi.mock('src/ts/server/commands', () => ({
  runServerCommand: commandSpies.runServerCommand,
  createModelPresetCommand: commandSpies.createModelPresetCommand,
  updateModelPresetCommand: commandSpies.updateModelPresetCommand,
  deleteModelPresetCommand: commandSpies.deleteModelPresetCommand,
  selectModelPresetCommand: commandSpies.selectModelPresetCommand,
  reorderModelPresetsCommand: commandSpies.reorderModelPresetsCommand,
}))
vi.mock('src/ts/process/modules', () => ({
  applyModule: vi.fn(),
  exportModule: vi.fn(),
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  importModule: vi.fn(),
  moduleUpdate: vi.fn(),
  readModule: vi.fn(),
  refreshModules: vi.fn(),
}))

import ModelPresetList from './ModelPresetList.svelte'
import { DBState } from 'src/ts/stores.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  DBState.db = {
    modelProfiles: [],
    modelRoleProfiles: {},
    modelRuntimeDefaults: {},
    modelPresets: [
      {
        id: 'model-a',
        name: 'Model A',
        modelRoleProfiles: {},
      },
      {
        id: 'model-b',
        name: 'Model B',
        modelRoleProfiles: {},
      },
    ],
    modelPresetsId: 0,
    promptPresets: [],
    promptPresetsId: -1,
  } as any
  for (const spy of Object.values(commandSpies)) {
    spy.mockReset()
  }
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  DBState.db = {} as any
})

describe('ModelPresetList', () => {
  it('does not apply a preset when Space is pressed inside the preset name input', async () => {
    const afterApply = vi.fn()
    component = mount(ModelPresetList, { target, props: { embedded: true, afterApply } })
    await tick()

    const nameInput = target.querySelector('tbody input')
    if (!(nameInput instanceof HTMLInputElement)) throw new Error('Preset name input not found')

    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    nameInput.dispatchEvent(event)
    await tick()

    expect(event.defaultPrevented).toBe(false)
    expect(afterApply).not.toHaveBeenCalled()
    expect(commandSpies.selectModelPresetCommand).not.toHaveBeenCalled()
    expect(DBState.db.modelPresetsId).toBe(0)
  })
})
