import { beforeEach, describe, expect, it, vi } from 'vitest'

const presetUpdateState = vi.hoisted(() => ({
  updateModelPreset: vi.fn(),
  updatePromptPreset: vi.fn(),
}))

const dbState = vi.hoisted(() => ({
  db: {} as Record<string, unknown>,
}))

vi.mock('./storage/database.svelte', () => ({
  updateModelPreset: presetUpdateState.updateModelPreset,
  updatePromptPreset: presetUpdateState.updatePromptPreset,
}))

vi.mock('./stores.svelte', () => ({
  DBState: dbState,
}))

import { mirrorTopLevelPresetField } from './presetFieldMirror'
import { DBState } from './stores.svelte'

describe('mirrorTopLevelPresetField', () => {
  beforeEach(() => {
    presetUpdateState.updateModelPreset.mockClear()
    presetUpdateState.updatePromptPreset.mockClear()
    ;(DBState as { db: unknown }).db = {
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
})
