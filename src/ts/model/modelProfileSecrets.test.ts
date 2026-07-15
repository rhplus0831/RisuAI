import { describe, expect, it } from 'vitest'
import {
  MASKED_MODEL_PROFILE_SECRET,
  createModelProfileSecretDraft,
  modelProfileSecretValueForSave,
} from './modelProfileSecrets'

describe('model profile secret drafts', () => {
  it('preserves an untouched saved credential with the masked placeholder', () => {
    const draft = createModelProfileSecretDraft(MASKED_MODEL_PROFILE_SECRET)

    expect(draft).toMatchObject({ disposition: 'preserve', hasExistingSecret: true, value: '' })
    expect(modelProfileSecretValueForSave(draft)).toBe(MASKED_MODEL_PROFILE_SECRET)
  })

  it('saves a replacement credential', () => {
    const draft = {
      ...createModelProfileSecretDraft(MASKED_MODEL_PROFILE_SECRET),
      disposition: 'replace' as const,
      value: 'replacement-key',
    }

    expect(modelProfileSecretValueForSave(draft)).toBe('replacement-key')
  })

  it('clears an existing credential explicitly', () => {
    const draft = {
      ...createModelProfileSecretDraft(MASKED_MODEL_PROFILE_SECRET),
      disposition: 'clear' as const,
    }

    expect(modelProfileSecretValueForSave(draft)).toBeUndefined()
  })
})
