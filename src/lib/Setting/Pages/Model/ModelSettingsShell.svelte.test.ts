import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mutationMocks = vi.hoisted(() => ({
  convertLegacyModelProfilesDurably: vi.fn(),
  createModelProfileDurably: vi.fn(),
  deleteModelProfileDurably: vi.fn(),
  duplicateModelProfileDurably: vi.fn(),
  updateModelProfileDurably: vi.fn(),
  updateModelRoleProfilesDurably: vi.fn(),
  updateModelRuntimeDefaultsDurably: vi.fn(),
}))

vi.mock('src/ts/model/modelProfileMutations', () => mutationMocks)
vi.mock('src/ts/server/commands', () => ({
  subscribeServerCommandLocalEffectApplied: vi.fn(() => () => {}),
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

import { language } from 'src/lang'
import { MODEL_ROLES } from 'src/ts/model/modelRoles'
import { getDatabase, setDatabaseLite } from 'src/ts/storage/database.svelte'
import ModelSettingsShell from './ModelSettingsShell.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function conversionButtons(): HTMLButtonElement[] {
  return Array.from(target.querySelectorAll('button')).filter(
    (button): button is HTMLButtonElement =>
      button instanceof HTMLButtonElement && !!button.textContent?.includes(language.modelProfiles.convertToProfiles),
  )
}

async function flushAsync(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await tick()
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  setDatabaseLite({
    aiModel: 'legacy-main',
    subModel: 'legacy-aux',
    modelProfiles: [],
    modelRoleProfiles: {},
    modelRuntimeDefaults: {},
    modelPresets: [],
    modelPresetsId: -1,
  } as any)
  for (const mock of Object.values(mutationMocks)) {
    mock.mockReset()
    mock.mockResolvedValue({ status: 'accepted', result: { status: 'ok' } })
  }
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  setDatabaseLite({} as any)
})

describe('ModelSettingsShell legacy conversion', () => {
  it('reports a terminal conversion failure and leaves conversion retryable', async () => {
    mutationMocks.convertLegacyModelProfilesDurably.mockResolvedValue({
      status: 'failed',
      result: { status: 'error', error: 'conversion failed' },
    })
    component = mount(ModelSettingsShell, { target })
    await tick()

    conversionButtons()[0]?.click()
    await flushAsync()

    expect(target.textContent).toContain('conversion failed')
    expect(conversionButtons()[0]?.disabled).toBe(false)
  })

  it('latches a durably queued conversion and prevents duplicate submits', async () => {
    mutationMocks.convertLegacyModelProfilesDurably.mockResolvedValue({
      status: 'queued',
      result: { status: 'unavailable' },
    })
    component = mount(ModelSettingsShell, { target })
    await tick()

    const button = conversionButtons()[0]
    if (!button) throw new Error('Conversion button not found')
    button.click()
    await flushAsync()

    expect(target.querySelector('[data-model-conversion-command-notice]')?.textContent).toContain(
      language.modelProfiles.commandQueued,
    )
    expect(conversionButtons().every((candidate) => candidate.disabled)).toBe(true)
    button.click()
    await flushAsync()
    expect(mutationMocks.convertLegacyModelProfilesDurably).toHaveBeenCalledTimes(1)

    getDatabase().modelProfiles = [
      { id: 'unrelated-profile', name: 'Unrelated', providerId: 'debug-echo', modelId: 'echo_model' },
    ]
    await flushAsync()
    expect(target.querySelector('[data-model-conversion-command-notice]')).not.toBeNull()
    expect(conversionButtons().every((candidate) => candidate.disabled)).toBe(true)

    getDatabase().modelProfiles = [
      ...getDatabase().modelProfiles,
      { id: 'converted-profile', name: 'Converted', providerId: 'debug-echo', modelId: 'echo_model' },
    ]
    getDatabase().modelRoleProfiles = Object.fromEntries(
      MODEL_ROLES.map((role, index) => [
        role,
        { mode: 'profile', profileId: index % 2 === 0 ? 'unrelated-profile' : 'converted-profile' },
      ]),
    ) as any
    await flushAsync()
    expect(target.querySelector('[data-model-conversion-command-notice]')).toBeNull()
    expect(conversionButtons()).toHaveLength(0)
  })
})
