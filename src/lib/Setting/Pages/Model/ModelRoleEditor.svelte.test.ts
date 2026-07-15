import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/horde/getModels', () => ({
  getHordeModels: vi.fn(async () => []),
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

import ModelRoleEditor from './ModelRoleEditor.svelte'
import { setDatabaseLite } from 'src/ts/storage/database.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let backgroundTrigger: HTMLButtonElement
let component: MountedComponent | undefined

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await tick()
}

beforeEach(() => {
  backgroundTrigger = document.createElement('button')
  backgroundTrigger.textContent = 'Open role editor'
  target = document.createElement('div')
  document.body.append(backgroundTrigger, target)
  setDatabaseLite({ customModels: [], modules: [] } as any)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  backgroundTrigger.remove()
  target.remove()
  document.body.innerHTML = ''
  setDatabaseLite({} as any)
})

describe('ModelRoleEditor modal focus', () => {
  it('contains focus, gives nested picker Escape ownership, and restores the opener', async () => {
    const closeEditor = vi.fn()
    backgroundTrigger.focus()
    component = mount(ModelRoleEditor, {
      target,
      props: {
        role: 'chatMain',
        roleLabel: 'Chat Main',
        roleDescription: 'Primary chat model',
        sourceLabel: 'Base',
        providerVerdict: 'Provider',
        requestModel: 'Request model',
        fallbackCount: '0 fallbacks',
        effectiveModel: '',
        supportsParameters: false,
        roleModelMode: 'inherit',
        modelRolesDraft: { value: {} },
        seperateParametersEnabledDraft: { value: false },
        seperateParametersByModelDraft: { value: false },
        seperateParametersDraft: {
          value: {
            memory: {},
            emotion: {},
            translate: {},
            otherAx: {},
            scriptMain: {},
            scriptAux: {},
            overrides: {},
          },
        },
        fallbackModelsDraft: { value: {} },
        fallbackWhenBlankResponseDraft: { value: false },
        doNotChangeFallbackModelsDraft: { value: false },
        modelName: (model: string) => model,
        setBaseRoleModel: vi.fn(),
        setRoleOverride: vi.fn(),
        setFallbackModel: vi.fn(),
        addFallbackModel: vi.fn(),
        removeFallbackModel: vi.fn(),
        closeEditor,
      } as any,
    })
    await settle()

    const roleDialog = target.querySelector<HTMLElement>('[role="dialog"]')
    const roleBackdrop = roleDialog?.parentElement
    const roleClose = roleDialog?.querySelector<HTMLElement>('[data-modal-initial-focus]')
    if (!roleDialog || !roleBackdrop || !roleClose) throw new Error('Role editor modal not found')
    expect(roleBackdrop.hasAttribute('data-modal-root')).toBe(true)
    expect(roleBackdrop.hasAttribute('role')).toBe(false)
    expect(roleDialog.getAttribute('aria-modal')).toBe('true')
    expect(backgroundTrigger.inert).toBe(true)
    expect(document.activeElement).toBe(roleClose)

    backgroundTrigger.focus()
    expect(document.activeElement).toBe(roleClose)

    const modelPickerTrigger = roleDialog.querySelector<HTMLButtonElement>('button.drop-shadow-lg')
    if (!modelPickerTrigger) throw new Error('Model picker trigger not found')
    modelPickerTrigger.focus()
    modelPickerTrigger.click()
    await settle()

    const dialogs = target.querySelectorAll<HTMLElement>('[role="dialog"]')
    expect(dialogs).toHaveLength(2)
    const pickerDialog = dialogs[1]
    const pickerBack = pickerDialog.querySelector<HTMLElement>('[data-modal-initial-focus]')
    if (!pickerBack) throw new Error('Model picker back button not found')
    expect(document.activeElement).toBe(pickerBack)

    const pickerEscape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
    pickerBack.dispatchEvent(pickerEscape)
    await settle()

    expect(pickerEscape.defaultPrevented).toBe(true)
    expect(target.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(closeEditor).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(modelPickerTrigger)

    const roleEscape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
    modelPickerTrigger.dispatchEvent(roleEscape)
    expect(roleEscape.defaultPrevented).toBe(true)
    expect(closeEditor).toHaveBeenCalledOnce()

    unmount(component)
    component = undefined
    await settle()
    expect(backgroundTrigger.inert).toBe(false)
    expect(document.activeElement).toBe(backgroundTrigger)
  })
})
