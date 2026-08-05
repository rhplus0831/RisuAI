import { isMaskedProviderSecret } from '../providerSecretMask'

export type ProviderCredentialType = 'apiKey' | 'vertexServiceAccount'

export interface ProviderCredentialRecord {
  id: string
  name: string
  type: ProviderCredentialType
  apiKey?: string
  vertex?: {
    clientEmail: string
    privateKey: string
  }
}

export class ProviderCredentialRecordValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderCredentialRecordValidationError'
  }
}

const PROVIDER_CREDENTIAL_KEYS = new Set(['id', 'name', 'type', 'apiKey', 'vertex'])
const PROVIDER_CREDENTIAL_VERTEX_KEYS = new Set(['clientEmail', 'privateKey'])

export function normalizeProviderCredentials(value: unknown): ProviderCredentialRecord[] {
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
      if (!apiKey || isMaskedProviderSecret(apiKey)) continue
      credentials.push({ id, name, type: 'apiKey', apiKey })
      seen.add(id)
      continue
    }

    if (item.type === 'vertexServiceAccount' && isRecord(item.vertex)) {
      const clientEmail = nonBlankString(item.vertex.clientEmail)
      const privateKey = nonBlankString(item.vertex.privateKey)
      if (!clientEmail || !privateKey || isMaskedProviderSecret(clientEmail) || isMaskedProviderSecret(privateKey)) {
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

export function readProviderCredentials(value: unknown): ProviderCredentialRecord[] {
  if (!Array.isArray(value)) {
    throw new ProviderCredentialRecordValidationError('providerCredentials must be an array')
  }

  const credentials: ProviderCredentialRecord[] = []
  const seen = new Set<string>()
  value.forEach((item, index) => {
    const credential = readProviderCredential(item, `providerCredentials[${index}]`)
    if (seen.has(credential.id)) {
      throw new ProviderCredentialRecordValidationError(`Duplicate provider credential id: ${credential.id}`)
    }
    seen.add(credential.id)
    credentials.push(credential)
  })
  return credentials
}

function readProviderCredential(value: unknown, path: string): ProviderCredentialRecord {
  if (!isRecord(value)) {
    throw new ProviderCredentialRecordValidationError(`${path} must be an object`)
  }
  for (const key of Object.keys(value)) {
    if (!PROVIDER_CREDENTIAL_KEYS.has(key)) {
      throw new ProviderCredentialRecordValidationError(`${path}.${key} is not supported`)
    }
  }

  const id = nonBlankString(value.id)
  if (!id) {
    throw new ProviderCredentialRecordValidationError(`${path}.id must be a non-empty string`)
  }
  const name = nonBlankString(value.name)
  if (!name) {
    throw new ProviderCredentialRecordValidationError(`${path}.name must be a non-empty string`)
  }

  if (value.type === 'apiKey') {
    if (Object.prototype.hasOwnProperty.call(value, 'vertex')) {
      throw new ProviderCredentialRecordValidationError(`${path}.vertex is only supported for vertexServiceAccount`)
    }
    const apiKey = nonBlankString(value.apiKey)
    if (!apiKey) {
      throw new ProviderCredentialRecordValidationError(`${path}.apiKey must be a non-empty string`)
    }
    return { id, name, type: 'apiKey', apiKey }
  }

  if (value.type === 'vertexServiceAccount') {
    if (Object.prototype.hasOwnProperty.call(value, 'apiKey')) {
      throw new ProviderCredentialRecordValidationError(`${path}.apiKey is only supported for apiKey`)
    }
    if (!isRecord(value.vertex)) {
      throw new ProviderCredentialRecordValidationError(`${path}.vertex must be an object`)
    }
    for (const key of Object.keys(value.vertex)) {
      if (!PROVIDER_CREDENTIAL_VERTEX_KEYS.has(key)) {
        throw new ProviderCredentialRecordValidationError(`${path}.vertex.${key} is not supported`)
      }
    }
    const clientEmail = nonBlankString(value.vertex.clientEmail)
    const privateKey = nonBlankString(value.vertex.privateKey)
    if (!clientEmail) {
      throw new ProviderCredentialRecordValidationError(`${path}.vertex.clientEmail must be a non-empty string`)
    }
    if (!privateKey) {
      throw new ProviderCredentialRecordValidationError(`${path}.vertex.privateKey must be a non-empty string`)
    }
    return {
      id,
      name,
      type: 'vertexServiceAccount',
      vertex: { clientEmail, privateKey },
    }
  }

  throw new ProviderCredentialRecordValidationError(`${path}.type must be apiKey or vertexServiceAccount`)
}

function nonBlankString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
