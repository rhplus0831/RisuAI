import { beforeEach, describe, expect, it, vi } from 'vitest'

const presetUpdateState = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  updateModelPreset: vi.fn(),
  updatePromptPreset: vi.fn(),
  settingsResourceState: {
    value: {} as Record<string, unknown>,
    status: 'ready',
    standaloneStatuses: {} as Record<string, string>,
  },
  collectionsResourceState: {
    values: {} as Record<string, unknown>,
    status: 'ready',
    statuses: {} as Record<string, string>,
  },
}))

const dbState = vi.hoisted(() => ({
  db: {} as Record<string, unknown>,
}))

vi.mock('./storage/database.svelte', () => ({
  getDatabase: presetUpdateState.getDatabase,
  updateModelPreset: presetUpdateState.updateModelPreset,
  updatePromptPreset: presetUpdateState.updatePromptPreset,
}))

vi.mock('./server/resourceState.svelte', () => ({
  settingsResourceState: presetUpdateState.settingsResourceState,
  collectionsResourceState: presetUpdateState.collectionsResourceState,
}))

import {
  currentTopLevelPresetFieldMirrorValue,
  mirrorTopLevelPresetField,
  mirrorTopLevelPresetFieldWithOutcome,
  mirrorTopLevelPresetFieldToTarget,
  resolveTopLevelPresetFieldMirrorTarget,
} from './presetFieldMirror'

describe('mirrorTopLevelPresetField', () => {
  beforeEach(() => {
    presetUpdateState.updateModelPreset.mockClear()
    presetUpdateState.updatePromptPreset.mockClear()
    presetUpdateState.getDatabase.mockReset()
    dbState.db = {
      modelPresetsId: 0,
      modelPresets: [{ id: 'compat-model', name: 'Stale model', temperature: 0.1 }],
      promptPresetsId: 0,
      promptPresets: [{ id: 'compat-prompt', name: 'Stale prompt', mainPrompt: 'stale prompt' }],
    }
    presetUpdateState.getDatabase.mockImplementation(() => dbState.db)
    presetUpdateState.settingsResourceState.status = 'ready'
    presetUpdateState.settingsResourceState.value = { modelPresetsId: 0, promptPresetsId: 0 }
    presetUpdateState.settingsResourceState.standaloneStatuses = {
      modelPresetsId: 'ready',
      promptPresetsId: 'ready',
    }
    presetUpdateState.collectionsResourceState.status = 'ready'
    presetUpdateState.collectionsResourceState.values = {
      modelPresets: [{ id: 'model-a', name: 'Model A', temperature: 0.7 }],
      promptPresets: [
        {
          id: 'prompt-a',
          name: 'Prompt A',
          mainPrompt: 'old prompt',
          promptTemplate: [{ id: 'row-a', type: 'plain', text: 'owned by prompt preset' }],
        },
      ],
    }
    presetUpdateState.collectionsResourceState.statuses = {
      modelPresets: 'ready',
      promptPresets: 'ready',
    }
  })

  it('does not mirror top-level promptTemplate through the generic prompt preset path', () => {
    const nextTemplate = [{ id: 'row-b', type: 'plain', text: 'compatibility projection only' }]

    expect(mirrorTopLevelPresetField('promptTemplate', nextTemplate)).toBe(false)

    expect(presetUpdateState.updatePromptPreset).not.toHaveBeenCalled()
    expect(presetUpdateState.updateModelPreset).not.toHaveBeenCalled()
  })

  it('still mirrors other prompt preset fields through the generic path', () => {
    expect(mirrorTopLevelPresetField('mainPrompt', 'new prompt')).toBe(true)

    expect(presetUpdateState.updatePromptPreset).toHaveBeenCalledWith(0, { mainPrompt: 'new prompt' })
    expect(presetUpdateState.updateModelPreset).not.toHaveBeenCalled()
    expect(presetUpdateState.getDatabase).not.toHaveBeenCalled()
  })

  it.each(['missing', 'duplicate'])('fails closed for a %s selected prompt owner', (kind) => {
    presetUpdateState.collectionsResourceState.values.promptPresets =
      kind === 'missing'
        ? []
        : [
            { id: 'prompt-a', name: 'Prompt A' },
            { id: 'prompt-a', name: 'Duplicate Prompt A' },
          ]

    expect(resolveTopLevelPresetFieldMirrorTarget('mainPrompt')).toBeNull()
    expect(mirrorTopLevelPresetField('mainPrompt', 'should not write')).toBe(false)
    expect(presetUpdateState.updatePromptPreset).not.toHaveBeenCalled()
  })

  it('keeps a delayed mirror bound to the preset id captured before selection changes', () => {
    ;(presetUpdateState.collectionsResourceState.values.modelPresets as Array<Record<string, unknown>>).push({
      id: 'model-b',
      name: 'Model B',
      temperature: 0.2,
    })
    const target = resolveTopLevelPresetFieldMirrorTarget('temperature')

    presetUpdateState.settingsResourceState.value.modelPresetsId = 1
    expect(target).toMatchObject({ kind: 'model', presetId: 'model-a', presetKey: 'temperature' })
    expect(currentTopLevelPresetFieldMirrorValue(target!)).toBe(0.7)
    expect(mirrorTopLevelPresetFieldToTarget(target!, 0.95)).toBe(true)

    expect(presetUpdateState.updateModelPreset).toHaveBeenCalledWith(0, { temperature: 0.95 })
  })

  it.each([
    { status: 'accepted' as const },
    { status: 'queued' as const, settlement: Promise.resolve('accepted' as const) },
    { status: 'failed' as const },
  ])('returns the $status owner mutation outcome to bridge callers', (result) => {
    const outcome = Promise.resolve(result)
    presetUpdateState.updateModelPreset.mockReturnValueOnce(outcome)

    expect(mirrorTopLevelPresetFieldWithOutcome('temperature', 0.95)).toBe(outcome)
    expect(presetUpdateState.updateModelPreset).toHaveBeenCalledWith(0, { temperature: 0.95 })
  })

  it('fails closed on errored owners instead of reviving the aggregate compatibility projection', () => {
    presetUpdateState.collectionsResourceState.statuses.modelPresets = 'error'

    expect(resolveTopLevelPresetFieldMirrorTarget('temperature')).toBeNull()
    expect(presetUpdateState.getDatabase).not.toHaveBeenCalled()
  })

  it('retains the cold-start aggregate compatibility fallback', () => {
    presetUpdateState.settingsResourceState.status = 'loading'
    presetUpdateState.settingsResourceState.standaloneStatuses = {}
    presetUpdateState.collectionsResourceState.status = 'loading'
    presetUpdateState.collectionsResourceState.statuses = {}
    dbState.db = {
      modelPresetsId: 0,
      modelPresets: [{ id: 'compat-model', temperature: 0.4 }],
      promptPresetsId: 0,
      promptPresets: [{ id: 'compat-prompt', mainPrompt: 'compat prompt' }],
    }

    expect(resolveTopLevelPresetFieldMirrorTarget('temperature')).toMatchObject({ presetId: 'compat-model' })
    expect(presetUpdateState.getDatabase).toHaveBeenCalled()
  })
})
