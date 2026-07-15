export const MASKED_PROVIDER_SECRET = '__RISU_SECRET_MASKED__'

export function isMaskedProviderSecret(value: unknown): value is typeof MASKED_PROVIDER_SECRET {
  return value === MASKED_PROVIDER_SECRET
}
