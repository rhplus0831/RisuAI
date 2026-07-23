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

const settlementMocks = vi.hoisted(() => ({
  listeners: new Map<string, (settlement: 'accepted' | 'discarded') => void>(),
}))

vi.mock('src/ts/server/durableMutationDispatch', () => ({
  dispatchDurableMutation: vi.fn(),
  registerDurableMutationSettlementListener: vi.fn(
    (mutationId: string, listener: (settlement: 'accepted' | 'discarded') => void) => {
      settlementMocks.listeners.set(mutationId, listener)
      return () => settlementMocks.listeners.delete(mutationId)
    },
  ),
}))

vi.mock('src/ts/model/modelProfileMutations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('src/ts/model/modelProfileMutations')>()),
  ...mutationMocks,
}))
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
import {
  beginPendingModelMutation,
  finishPendingModelMutation,
  getPendingModelMutations,
  modelProfileProjectionFingerprint,
  retainPendingModelMutation,
} from 'src/ts/model/modelProfileMutations'
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

function clearPendingModelMutations(): void {
  for (const lane of ['model-profiles', 'model-runtime-defaults', 'provider-credentials'] as const) {
    for (const pending of getPendingModelMutations(lane)) finishPendingModelMutation(pending.token)
  }
}

beforeEach(() => {
  clearPendingModelMutations()
  settlementMocks.listeners.clear()
  target = document.createElement('div')
  document.body.appendChild(target)
  setDatabaseLite({
    aiModel: 'legacy-main',
    subModel: 'legacy-aux',
    providerCredentials: [],
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
  clearPendingModelMutations()
  setDatabaseLite({} as any)
})

describe('ModelSettingsShell legacy conversion', () => {
  it('opens the credential manager from the model settings tabs', async () => {
    component = mount(ModelSettingsShell, { target })
    await tick()

    const credentialsTab = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(language.modelProfiles.credentialsTab),
    )
    expect(credentialsTab).toBeTruthy()
    credentialsTab!.click()
    await tick()

    expect(target.textContent).toContain(language.modelProfiles.credentialsTabTitle)
    expect(target.textContent).toContain(language.modelProfiles.createApiCredential)
  })

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
      mutationId: 'queued-conversion',
    })
    component = mount(ModelSettingsShell, { target })
    await tick()

    const button = conversionButtons()[0]
    if (!button) throw new Error('Conversion button not found')
    button.click()
    await flushAsync()

    expect(target.querySelector('[data-model-conversion-command-notice]')).toBeNull()
    expect(conversionButtons().every((candidate) => candidate.disabled)).toBe(true)
    button.click()
    await flushAsync()
    expect(mutationMocks.convertLegacyModelProfilesDurably).toHaveBeenCalledTimes(1)

    getDatabase().modelProfiles = [
      { id: 'unrelated-profile', name: 'Unrelated', providerId: 'debug-echo', modelId: 'echo_model' },
    ]
    await flushAsync()
    expect(target.querySelector('[data-model-conversion-command-notice]')).toBeNull()
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

  it('surfaces a discarded queued conversion before releasing its lane', async () => {
    mutationMocks.convertLegacyModelProfilesDurably.mockResolvedValue({
      status: 'queued',
      result: { status: 'unavailable' },
      mutationId: 'discarded-conversion',
    })
    component = mount(ModelSettingsShell, { target })
    await tick()

    conversionButtons()[0]?.click()
    await flushAsync()
    expect(target.textContent).not.toContain(language.modelProfiles.commandQueued)

    settlementMocks.listeners.get('discarded-conversion')?.('discarded')
    await flushAsync()

    expect(target.textContent).toContain(language.modelProfiles.commandReplayDiscarded)
    expect(getPendingModelMutations('model-profiles')).toEqual([])
    expect(conversionButtons()[0]?.disabled).toBe(false)
  })

  it('keeps conversion fenced across a settings remount until its projection converges', async () => {
    mutationMocks.convertLegacyModelProfilesDurably.mockResolvedValue({
      status: 'queued',
      result: { status: 'unavailable' },
      mutationId: 'queued-conversion-remount',
    })
    component = mount(ModelSettingsShell, { target })
    await tick()
    conversionButtons()[0]?.click()
    await flushAsync()

    unmount(component)
    component = undefined
    target.replaceChildren()
    component = mount(ModelSettingsShell, { target })
    await tick()

    expect(conversionButtons().every((button) => button.disabled)).toBe(true)
    conversionButtons()[0]?.click()
    await flushAsync()
    expect(mutationMocks.convertLegacyModelProfilesDurably).toHaveBeenCalledTimes(1)

    getDatabase().modelProfiles = [
      { id: 'converted-main', name: 'Main', providerId: 'debug-echo', modelId: 'echo_model' },
      { id: 'converted-aux', name: 'Aux', providerId: 'debug-echo', modelId: 'echo_model' },
    ]
    getDatabase().modelRoleProfiles = Object.fromEntries(
      MODEL_ROLES.map((role, index) => [
        role,
        { mode: 'profile', profileId: index % 2 === 0 ? 'converted-main' : 'converted-aux' },
      ]),
    ) as any
    await flushAsync()

    expect(getPendingModelMutations('model-profiles')).toEqual([])
    expect(conversionButtons()).toHaveLength(0)
  })

  it('clears a queued profile create while the Profiles tab is unmounted', async () => {
    const attemptedProfile = {
      name: 'Queued profile',
      providerId: 'debug-echo',
      modelId: 'debug-echo',
    }
    const token = beginPendingModelMutation('model-profiles', {
      kind: 'profile-create',
      baselineIds: [],
      attemptedFingerprint: modelProfileProjectionFingerprint(attemptedProfile, true),
    })
    retainPendingModelMutation(token!, 'queued-profile-create')

    component = mount(ModelSettingsShell, { target })
    await tick()
    expect(getPendingModelMutations('model-profiles')).toHaveLength(1)

    getDatabase().modelProfiles = [{ id: 'server-generated-id', ...attemptedProfile }]
    await flushAsync()

    expect(getPendingModelMutations('model-profiles')).toEqual([])
  })

  it('releases conversion controls when the mutation helper rejects unexpectedly', async () => {
    mutationMocks.convertLegacyModelProfilesDurably.mockRejectedValueOnce(new Error('staging rejected'))
    component = mount(ModelSettingsShell, { target })
    await tick()

    conversionButtons()[0]?.click()
    await flushAsync()

    expect(target.textContent).toContain(language.modelProfiles.commandUnavailable)
    expect(conversionButtons()[0]?.disabled).toBe(false)
  })
})
