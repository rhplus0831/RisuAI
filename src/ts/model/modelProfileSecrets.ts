import { MASKED_PROVIDER_SECRET } from '../providerSecretMask'

export const MASKED_MODEL_PROFILE_SECRET = MASKED_PROVIDER_SECRET

export type ModelProfileSecretDisposition = 'preserve' | 'replace' | 'clear'

export interface ModelProfileSecretDraft {
  value: string
  disposition: ModelProfileSecretDisposition
  hasExistingSecret: boolean
}

export function createModelProfileSecretDraft(value: string | undefined): ModelProfileSecretDraft {
  return {
    value: '',
    disposition: 'preserve',
    hasExistingSecret: typeof value === 'string' && value.trim() !== '',
  }
}

export function modelProfileSecretValueForSave(draft: ModelProfileSecretDraft): string | undefined {
  if (draft.disposition === 'preserve') {
    return draft.hasExistingSecret ? MASKED_MODEL_PROFILE_SECRET : undefined
  }
  if (draft.disposition === 'clear') return undefined

  const value = draft.value.trim()
  return value ? value : undefined
}
