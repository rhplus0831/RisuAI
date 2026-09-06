import { describe, expect, it } from 'vitest'
import { seedSetting } from './botSettingsParamsData'
import type { SettingContext } from './types'
import type { LLMModel } from '../model/types'

function context(modelId: string, flatModelId: string): SettingContext {
  const modelInfo = { id: modelId } as LLMModel
  return {
    db: { aiModel: flatModelId } as SettingContext['db'],
    modelInfo,
    subModelInfo: modelInfo,
  }
}

describe('bot settings parameter ownership', () => {
  it.each(['gpt-5.4', 'reverse_proxy', 'openrouter'])('shows seed controls for resolved model %s', (modelId) => {
    expect(seedSetting.condition?.(context(modelId, 'stale-flat-model'))).toBe(true)
  })

  it('does not expose seed controls from a conflicting flat model', () => {
    expect(seedSetting.condition?.(context('claude-opus-4-8', 'gpt-5.4'))).toBe(false)
  })
})
