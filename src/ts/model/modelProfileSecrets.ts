export const MASKED_MODEL_PROFILE_SECRET = '__RISU_SECRET_MASKED__'

export interface ModelProfileSecretDraft {
  value: string
  touched: boolean
  hasExistingSecret: boolean
}

export function createModelProfileSecretDraft(value: string | undefined): ModelProfileSecretDraft {
  return {
    value: '',
    touched: false,
    hasExistingSecret: typeof value === 'string' && value.trim() !== '',
  }
}

export function modelProfileSecretValueForSave(draft: ModelProfileSecretDraft): string | undefined {
  if (!draft.touched) return draft.hasExistingSecret ? MASKED_MODEL_PROFILE_SECRET : undefined

  const value = draft.value.trim()
  return value ? value : undefined
}
