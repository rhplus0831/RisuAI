import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const conversionMocks = vi.hoisted(() => ({
  addImportedLegacyPreset: vi.fn(),
  alertError: vi.fn(),
  alertNormal: vi.fn(),
}))

vi.mock('../storage/database.svelte', () => ({
  addImportedLegacyPreset: conversionMocks.addImportedLegacyPreset,
  presetTemplate: {
    name: '',
    promptTemplate: [],
  },
}))

vi.mock('../tokenizer', () => ({
  tokenizeAccurate: vi.fn(async () => 0),
}))

vi.mock('../alert', () => ({
  alertError: conversionMocks.alertError,
  alertNormal: conversionMocks.alertNormal,
}))

import { language } from '../../lang'
import { promptConvertion } from './prompt'

function stChatFile() {
  return {
    name: 'st-chat.json',
    type: 'STCHAT',
    content: JSON.stringify({
      chat_completion_source: 'openai',
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      top_a: 0,
      min_p: 0,
      repetition_penalty: 1.05,
      frequency_penalty: 0,
      presence_penalty: 0,
      prompt_order: [{ order: [{ identifier: 'main', enabled: true }] }],
      prompts: [{ identifier: 'main', content: 'Converted prompt', role: 'system' }],
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('safeStructuredClone', (value: unknown) => JSON.parse(JSON.stringify(value)))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('prompt conversion persistence outcome', () => {
  it.each([
    {
      outcome: 'applied' as const,
      expectedNotice: language.presetConversionSuccess,
      expectedNoticeKind: 'normal' as const,
    },
    {
      outcome: 'queued' as const,
      expectedNotice: language.presetConversionQueued,
      expectedNoticeKind: 'normal' as const,
    },
    {
      outcome: 'failed' as const,
      expectedNotice: language.presetConversionFailed,
      expectedNoticeKind: 'error' as const,
    },
  ])('reports a durable $outcome conversion only after persistence settles', async (testCase) => {
    conversionMocks.addImportedLegacyPreset.mockResolvedValueOnce(testCase.outcome)

    await expect(promptConvertion([stChatFile()])).resolves.toBe(testCase.outcome)

    expect(conversionMocks.addImportedLegacyPreset).toHaveBeenCalledWith(
      expect.objectContaining({
        aiModel: 'openrouter',
        promptTemplate: [
          expect.objectContaining({
            type: 'plain',
            type2: 'main',
            text: 'Converted prompt',
          }),
        ],
        subModel: 'openrouter',
      }),
    )
    if (testCase.expectedNoticeKind === 'normal') {
      expect(conversionMocks.alertNormal).toHaveBeenCalledWith(testCase.expectedNotice)
      expect(conversionMocks.alertError).not.toHaveBeenCalled()
    } else {
      expect(conversionMocks.alertError).toHaveBeenCalledWith(testCase.expectedNotice)
      expect(conversionMocks.alertNormal).not.toHaveBeenCalled()
    }
  })
})
