import { beforeEach, describe, expect, it, vi } from 'vitest'

const presetUpdateState = vi.hoisted(() => ({
  updateModelPreset: vi.fn(),
  updatePromptPreset: vi.fn(),
}))

const dbState = vi.hoisted(() => ({
  db: {} as Record<string, unknown>,
}))

vi.mock('./storage/database.svelte', () => ({
  getDatabase: () => dbState.db,
  updateModelPreset: presetUpdateState.updateModelPreset,
  updatePromptPreset: presetUpdateState.updatePromptPreset,
}))

import {
  mirrorTopLevelPresetField,
  mirrorTopLevelPresetFieldToTarget,
  resolveTopLevelPresetFieldMirrorTarget,
} from './presetFieldMirror'

describe('mirrorTopLevelPresetField', () => {
  beforeEach(() => {
    presetUpdateState.updateModelPreset.mockClear()
    presetUpdateState.updatePromptPreset.mockClear()
    dbState.db = {
      modelPresetsId: 0,
      modelPresets: [{ id: 'model-a', name: 'Model A', temperature: 0.7 }],
      promptPresetsId: 0,
      promptPresets: [
        {
          id: 'prompt-a',
          name: 'Prompt A',
          mainPrompt: 'old prompt',
          promptTemplate: [{ id: 'row-a', type: 'plain', text: 'owned by prompt preset' }],
        },
      ],
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
  })

  it('keeps a delayed mirror bound to the preset id captured before selection changes', () => {
    ;(dbState.db as any).modelPresets.push({ id: 'model-b', name: 'Model B', temperature: 0.2 })
    const target = resolveTopLevelPresetFieldMirrorTarget('temperature')

    ;(dbState.db as any).modelPresetsId = 1
    expect(target).toMatchObject({ kind: 'model', presetId: 'model-a', presetKey: 'temperature' })
    expect(mirrorTopLevelPresetFieldToTarget(target!, 0.95)).toBe(true)

    expect(presetUpdateState.updateModelPreset).toHaveBeenCalledWith(0, { temperature: 0.95 })
  })
})
