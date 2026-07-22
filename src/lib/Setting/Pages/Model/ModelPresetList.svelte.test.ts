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

const mutationSpies = vi.hoisted(() => ({
  createModelPreset: vi.fn(),
  deleteModelPreset: vi.fn(),
  reorderModelPresets: vi.fn(),
  updateModelPreset: vi.fn(),
}))

const alertSpies = vi.hoisted(() => ({
  alertError: vi.fn(),
  alertNormal: vi.fn(),
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
vi.mock('src/ts/storage/database.svelte', async (importActual) => ({
  ...(await importActual<typeof import('src/ts/storage/database.svelte')>()),
  ...mutationSpies,
}))
vi.mock('src/ts/alert', async (importActual) => ({
  ...(await importActual<typeof import('src/ts/alert')>()),
  ...alertSpies,
}))

import ModelPresetList from './ModelPresetList.svelte'
import { getDatabase, setDatabaseLite } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await tick()
}

function buttonWithText(text: string, index = 0): HTMLButtonElement {
  const buttons = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).filter((button) =>
    button.textContent?.includes(text),
  )
  const button = buttons[index]
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  setDatabaseLite({
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
  } as any)
  for (const spy of Object.values(commandSpies)) {
    spy.mockReset()
  }
  for (const spy of Object.values(mutationSpies)) {
    spy.mockReset().mockResolvedValue({ status: 'accepted' })
  }
  alertSpies.alertError.mockReset()
  alertSpies.alertNormal.mockReset()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  setDatabaseLite({} as any)
  vi.unstubAllGlobals()
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
    expect(getDatabase().modelPresetsId).toBe(0)
  })

  it.each([
    [
      'rename',
      () => {
        mutationSpies.updateModelPreset.mockResolvedValueOnce({ status: 'failed' })
        const input = target.querySelector<HTMLInputElement>('tbody input')
        if (!input) throw new Error('Preset name input not found')
        input.value = 'Rejected rename'
        input.dispatchEvent(new Event('change', { bubbles: true }))
      },
    ],
    [
      'delete',
      () => {
        mutationSpies.deleteModelPreset.mockResolvedValueOnce({ status: 'failed' })
        vi.stubGlobal(
          'confirm',
          vi.fn(() => true),
        )
        buttonWithText(language.modelProfiles.delete).click()
      },
    ],
    [
      'reorder',
      () => {
        mutationSpies.reorderModelPresets.mockResolvedValueOnce({ status: 'failed' })
        buttonWithText(language.modelProfiles.moveDown).click()
      },
    ],
  ])('surfaces a failed model-preset %s', async (_action, runAction) => {
    component = mount(ModelPresetList, { target })
    await tick()

    runAction()
    await settle()

    expect(target.querySelector('[data-risu-preset-mutation-status]')?.textContent).toContain(
      language.presetMutationFailed,
    )
    expect(alertSpies.alertError).toHaveBeenCalledWith(language.presetMutationFailed)
  })

  it('reports a queued create and a later replay discard', async () => {
    const settlement = deferred<'accepted' | 'failed'>()
    mutationSpies.createModelPreset.mockResolvedValueOnce({
      status: 'queued',
      settlement: settlement.promise,
    })
    component = mount(ModelPresetList, { target })
    await tick()

    buttonWithText(language.modelProfiles.saveCurrentRolesAsPreset).click()
    await settle()

    expect(target.querySelector('[data-risu-preset-mutation-status]')).toBeNull()
    expect(alertSpies.alertNormal).toHaveBeenCalledWith(language.presetMutationQueued)

    settlement.resolve('failed')
    await settle()
    expect(target.querySelector('[data-risu-preset-mutation-status]')?.textContent).toContain(
      language.presetMutationFailed,
    )
    expect(alertSpies.alertError).toHaveBeenCalledWith(language.presetMutationFailed)
  })
})
