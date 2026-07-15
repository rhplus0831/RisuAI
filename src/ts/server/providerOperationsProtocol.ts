export const PROVIDER_OPERATIONS = [
  'nanogpt.balance',
  'nanogpt.subscription',
  'nanogpt.model-providers',
  'nanogpt.models',
  'nanogpt.subscription-models',
  'openrouter.models',
  'openrouter.providers',
  'ollama.cloud-models',
  'wavespeed.models',
  'google.models',
  'google.count-tokens',
  'anthropic.models',
] as const

export type ProviderOperation = (typeof PROVIDER_OPERATIONS)[number]

export type ProviderOperationCredential =
  | { source: 'none' }
  | { source: 'stored' }
  | { source: 'model-profile'; profileId: string }
  | { source: 'provided'; apiKey: string }

export interface ProviderOperationRequest {
  operation: ProviderOperation
  credential: ProviderOperationCredential
  input?: { modelId: string } | { modelId: string; text: string }
}

export interface ProviderOperationSuccess {
  operation: ProviderOperation
  data: unknown
}

export function isProviderOperation(value: unknown): value is ProviderOperation {
  return typeof value === 'string' && (PROVIDER_OPERATIONS as readonly string[]).includes(value)
}
