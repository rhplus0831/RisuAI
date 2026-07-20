import { describe, expect, it } from 'vitest'
import {
  SERVER_RAW_TRANSLATOR_TYPES,
  isServerAutoTranslationEligible,
} from '../src/translation/serverAutoTranslationEligibility.js'

const eligibleInput = {
  chatAutoTranslate: true,
  messageText: 'Generated reply',
  translator: 'ko',
  translatorType: 'google',
  autoTranslateCachedOnly: false,
}

describe('server automatic message translation eligibility', () => {
  it.each(SERVER_RAW_TRANSLATOR_TYPES)('accepts the supported %s translator', (translatorType) => {
    expect(isServerAutoTranslationEligible({ ...eligibleInput, translatorType })).toBe(true)
  })

  it.each([
    ['chat auto-translation disabled', { chatAutoTranslate: false }],
    ['blank message text', { messageText: '  \n ' }],
    ['missing target language', { translator: '' }],
    ['unsupported translator', { translatorType: 'custom' }],
    ['cached-only LLM translation', { translatorType: 'llm', autoTranslateCachedOnly: true }],
  ])('rejects %s', (_label, patch) => {
    expect(isServerAutoTranslationEligible({ ...eligibleInput, ...patch })).toBe(false)
  })

  it('does not apply the cached-only exclusion to non-LLM translators', () => {
    expect(
      isServerAutoTranslationEligible({
        ...eligibleInput,
        translatorType: 'deepl',
        autoTranslateCachedOnly: true,
      }),
    ).toBe(true)
  })
})
