import { isMaskedProviderSecret } from '@risuai/shared-core/provider-secret-mask'
import {
  normalizeProviderCredentials,
  ProviderCredentialRecordValidationError,
  readProviderCredentials,
  type ProviderCredentialRecord,
  type ProviderCredentialType,
} from '@risuai/shared-core/provider-credential-records'

export { normalizeProviderCredentials, ProviderCredentialRecordValidationError, readProviderCredentials }
export type { ProviderCredentialRecord, ProviderCredentialType }

/**
 * Normalizes the server's browser projection, where stored secrets are
 * represented by the shared masked placeholder. This is intentionally
 * separate from persisted-data normalization so a masked placeholder can
 * prove that a projected credential exists without becoming valid storage.
 */
export function normalizeProjectedProviderCredentials(value: unknown): ProviderCredentialRecord[] {
  if (!Array.isArray(value)) return []

  const credentials: ProviderCredentialRecord[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!isRecord(item)) continue
    const id = nonBlankString(item.id)
    const name = nonBlankString(item.name)
    if (!id || !name || seen.has(id)) continue

    if (item.type === 'apiKey') {
      const apiKey = nonBlankString(item.apiKey)
      if (!apiKey) continue
      credentials.push({ id, name, type: 'apiKey', apiKey })
      seen.add(id)
      continue
    }

    if (item.type === 'vertexServiceAccount' && isRecord(item.vertex)) {
      const clientEmail = nonBlankString(item.vertex.clientEmail)
      const privateKey = nonBlankString(item.vertex.privateKey)
      if (!clientEmail || !privateKey || isMaskedProviderSecret(clientEmail)) {
        continue
      }
      credentials.push({
        id,
        name,
        type: 'vertexServiceAccount',
        vertex: { clientEmail, privateKey },
      })
      seen.add(id)
    }
  }
  return credentials
}

function nonBlankString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
