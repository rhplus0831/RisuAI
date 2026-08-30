import { beforeEach, describe, expect, it, vi } from 'vitest'

const modelOverrideState = vi.hoisted(() => ({
  db: {} as Record<string, unknown>,
  updatePromptPreset: vi.fn(),
}))

vi.mock('./storage/database.svelte', () => ({
  getDatabase: () => modelOverrideState.db,
  updatePromptPreset: modelOverrideState.updatePromptPreset,
}))

import {
  currentPromptPresetModelOverrideMirrorValue,
  mirrorPromptPresetModelOverrideFieldToTarget,
  resolvePromptPresetModelOverrideMirrorTarget,
} from './promptPresetModelOverrides.svelte'

describe('prompt preset model override ownership', () => {
  beforeEach(() => {
    modelOverrideState.updatePromptPreset.mockClear()
    modelOverrideState.db = {
      promptPresetsId: 0,
      promptPresets: [{ id: 'prompt-a', name: 'Prompt A', temperature: 0.7 }],
      temperature: 0.5,
    }
  })

  it('resolves and writes through the unique selected prompt owner', () => {
    const target = resolvePromptPresetModelOverrideMirrorTarget('temperature')

    expect(target).toEqual({ databaseKey: 'temperature', presetField: 'temperature', presetId: 'prompt-a' })
    expect(currentPromptPresetModelOverrideMirrorValue(target!)).toBe(0.7)
    expect(mirrorPromptPresetModelOverrideFieldToTarget(target!, 0.9)).toBe(true)
    expect(modelOverrideState.updatePromptPreset).toHaveBeenCalledWith(0, { temperature: 0.9 })
  })

  it.each(['missing', 'duplicate'])('fails closed for a %s selected prompt owner', (kind) => {
    modelOverrideState.db.promptPresets =
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
})
