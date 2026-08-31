import { beforeEach, describe, expect, it, vi } from 'vitest'

const modelOverrideState = vi.hoisted(() => ({
  updatePromptPreset: vi.fn(),
  settingsResourceState: {
    value: {} as Record<string, unknown>,
    status: 'ready',
    groupStatuses: {} as Record<string, string>,
    standaloneStatuses: {} as Record<string, string>,
  },
  collectionsResourceState: {
    values: {} as Record<string, unknown>,
    status: 'ready',
    statuses: {} as Record<string, string>,
  },
}))

vi.mock('./storage/database.svelte', () => ({
  updatePromptPreset: modelOverrideState.updatePromptPreset,
}))

vi.mock('./server/resourceState.svelte', () => ({
  settingsResourceState: modelOverrideState.settingsResourceState,
  collectionsResourceState: modelOverrideState.collectionsResourceState,
}))

import {
  currentPromptPresetModelOverrideValue,
  currentPromptPresetModelOverrideMirrorValue,
  mirrorPromptPresetModelOverrideFieldToTarget,
  resolvePromptPresetModelOverrideMirrorTarget,
  setPromptPresetModelOverrideEnabled,
} from './promptPresetModelOverrides.svelte'

describe('prompt preset model override ownership', () => {
  beforeEach(() => {
    modelOverrideState.updatePromptPreset.mockClear()
    modelOverrideState.settingsResourceState.status = 'ready'
    modelOverrideState.settingsResourceState.value = { promptPresetsId: 0, temperature: 0.5 }
    modelOverrideState.settingsResourceState.groupStatuses = { runtime: 'ready' }
    modelOverrideState.settingsResourceState.standaloneStatuses = { promptPresetsId: 'ready' }
    modelOverrideState.collectionsResourceState.status = 'ready'
    modelOverrideState.collectionsResourceState.values = {
      promptPresets: [{ id: 'prompt-a', name: 'Prompt A', temperature: 0.7 }],
    }
    modelOverrideState.collectionsResourceState.statuses = { promptPresets: 'ready' }
  })

  it('resolves and writes through the unique canonical prompt owner without reading the aggregate facade', () => {
    const target = resolvePromptPresetModelOverrideMirrorTarget('temperature')

    expect(target).toEqual({ databaseKey: 'temperature', presetField: 'temperature', presetId: 'prompt-a' })
    expect(currentPromptPresetModelOverrideMirrorValue(target!)).toBe(0.7)
    expect(mirrorPromptPresetModelOverrideFieldToTarget(target!, 0.9)).toBe(true)
    expect(modelOverrideState.updatePromptPreset).toHaveBeenCalledWith(0, { temperature: 0.9 })
  })

  it.each(['missing', 'duplicate'])('fails closed for a %s selected prompt owner', (kind) => {
    modelOverrideState.collectionsResourceState.values.promptPresets =
      kind === 'missing'
        ? []
        : [
            { id: 'prompt-a', name: 'Prompt A' },
            { id: 'prompt-a', name: 'Duplicate Prompt A' },
          ]

    expect(resolvePromptPresetModelOverrideMirrorTarget('temperature')).toBeNull()
    expect(
      mirrorPromptPresetModelOverrideFieldToTarget(
        { databaseKey: 'temperature', presetField: 'temperature', presetId: 'prompt-a' },
        0.9,
      ),
    ).toBe(false)
    expect(modelOverrideState.updatePromptPreset).not.toHaveBeenCalled()
  })

  it('reads the explicit settings owner when the selected preset has no override value', () => {
    modelOverrideState.collectionsResourceState.values.promptPresets = [{ id: 'prompt-a', name: 'Prompt A' }]

    expect(currentPromptPresetModelOverrideValue('temperature', 0.3)).toBe(0.5)
    expect(
      currentPromptPresetModelOverrideMirrorValue({
        databaseKey: 'temperature',
        presetField: 'temperature',
        presetId: 'prompt-a',
      }),
    ).toBe(0.5)
  })

  it('keeps a delayed override bound to its captured owner after selection changes', () => {
    ;(modelOverrideState.collectionsResourceState.values.promptPresets as Array<Record<string, unknown>>).push({
      id: 'prompt-b',
      name: 'Prompt B',
      temperature: 0.2,
    })
    const target = resolvePromptPresetModelOverrideMirrorTarget('temperature')

    modelOverrideState.settingsResourceState.value.promptPresetsId = 1
    expect(currentPromptPresetModelOverrideMirrorValue(target!)).toBe(0.7)
    expect(mirrorPromptPresetModelOverrideFieldToTarget(target!, 0.95)).toBe(true)
    expect(modelOverrideState.updatePromptPreset).toHaveBeenCalledWith(0, { temperature: 0.95 })
  })

  it('fails closed on an errored owner instead of reviving stale aggregate data', () => {
    modelOverrideState.collectionsResourceState.statuses.promptPresets = 'error'

    expect(resolvePromptPresetModelOverrideMirrorTarget('temperature')).toBeNull()
  })

  it('does not enable overrides from a partial or errored settings snapshot', () => {
    modelOverrideState.collectionsResourceState.values.promptPresets = [{ id: 'prompt-a', name: 'Prompt A' }]
    modelOverrideState.settingsResourceState.groupStatuses.runtime = 'error'

    expect(currentPromptPresetModelOverrideValue('temperature', 0.3)).toBe(0.3)
    setPromptPresetModelOverrideEnabled('parameters', true)

    expect(modelOverrideState.updatePromptPreset).not.toHaveBeenCalled()
  })

  it.each(['idle', 'loading'] as const)('does not resolve overrides while owners are %s', (status) => {
    modelOverrideState.settingsResourceState.standaloneStatuses.promptPresetsId = status
    modelOverrideState.settingsResourceState.groupStatuses.runtime = status
    modelOverrideState.collectionsResourceState.statuses.promptPresets = status

    expect(resolvePromptPresetModelOverrideMirrorTarget('temperature')).toBeNull()
    expect(currentPromptPresetModelOverrideValue('temperature', 0)).toBe(0)
  })
})
