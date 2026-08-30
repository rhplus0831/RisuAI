import type {
  CustomEmbeddingConfiguration,
  EmbeddingInputType,
  EmbeddingOperationCredential,
  EmbeddingOperationRequest,
  EmbeddingOperationSuccess,
} from '@risuai/protocol/embedding-operation'
import { isContextualRemoteEmbeddingModel, isRemoteEmbeddingModel } from '@risuai/protocol/embedding-operation'
import {
  embedTextGroups,
  embedTexts,
  MEMORY_EMBEDDING_MAX_DIMENSION,
  MEMORY_EMBEDDING_MAX_RESPONSE_BYTES,
  MEMORY_EMBEDDING_MAX_VECTOR_VALUES,
} from './memoryEmbeddingAdapter.js'
import {
  resolveMemoryEmbeddingModel,
  type MemoryEmbeddingModelRequest,
  type MemoryEmbeddingSettings,
} from './memoryEmbeddingModel.js'
import { MASKED_PROVIDER_SECRET } from './providerSecrets.js'
import { createTimeoutController } from './proxy.js'

export const EMBEDDING_OPERATION_TIMEOUT_MS = 30_000
export const EMBEDDING_OPERATION_BODY_LIMIT = 8 * 1024 * 1024
export const EMBEDDING_OPERATION_MAX_INPUT_BYTES = 4 * 1024 * 1024
export const EMBEDDING_OPERATION_MAX_INPUT_STRING_BYTES = 128 * 1024
export const EMBEDDING_OPERATION_MAX_TEXTS = 1_000
export const EMBEDDING_OPERATION_MAX_GROUPS = 256
export const EMBEDDING_OPERATION_MAX_GROUP_CHUNKS = 1_000
export const EMBEDDING_OPERATION_MAX_API_KEY_LENGTH = 16 * 1024
export const EMBEDDING_OPERATION_MAX_CUSTOM_URL_LENGTH = 2_048
export const EMBEDDING_OPERATION_MAX_CUSTOM_MODEL_LENGTH = 512

type JsonRecord = Record<string, unknown>

export interface EmbeddingOperationExecutionOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxResponseBytes?: number
  maxDimension?: number
  maxVectorValues?: number
  signal?: AbortSignal
}

export type EmbeddingOperationErrorCode =
  | 'invalid_embedding_operation_request'
  | 'embedding_credential_unavailable'
  | 'embedding_configuration_invalid'
  | 'embedding_operation_failed'
  | 'embedding_operation_invalid_response'
  | 'embedding_operation_timeout'

export class EmbeddingOperationError extends Error {
  readonly code: EmbeddingOperationErrorCode
  readonly statusCode: number

  constructor(code: EmbeddingOperationErrorCode, statusCode: number) {
    super(code)
    this.name = 'EmbeddingOperationError'
    this.code = code
    this.statusCode = statusCode
  }
}

export function parseEmbeddingOperationRequest(body: unknown): EmbeddingOperationRequest {
  const record = readExactRecord(body, ['operation', 'model', 'inputType', 'input', 'groups', 'credential', 'custom'])
  const operation = record.operation
  const model = record.model
  const inputType = parseInputType(record.inputType)
  const credential = parseCredential(record.credential)

  if (operation === 'texts') {
    if (!isRemoteEmbeddingModel(model) || isContextualRemoteEmbeddingModel(model)) throw invalidRequest()
    const input = parseStringArray(record.input, EMBEDDING_OPERATION_MAX_TEXTS)
    const custom = model === 'custom' ? parseCustomConfiguration(record.custom) : undefined
    if (model !== 'custom' && record.custom !== undefined) throw invalidRequest()
    if (record.groups !== undefined) throw invalidRequest()
    return {
      operation,
      model,
      inputType,
      input,
      credential,
      ...(custom ? { custom } : {}),
    }
  }

  if (operation === 'groups') {
    if (!isContextualRemoteEmbeddingModel(model) || record.input !== undefined || record.custom !== undefined) {
      throw invalidRequest()
    }
    return {
      operation,
      model,
      inputType,
      groups: parseGroups(record.groups),
      credential,
    }
  }

  throw invalidRequest()
}

export function resolveEmbeddingOperationModel(
  request: EmbeddingOperationRequest,
  settings: JsonRecord,
): MemoryEmbeddingModelRequest {
  const effective = { ...settings } as JsonRecord
  const model = request.model

  if (model === 'custom') {
    const storedCustom = readRecord(settings.hypaCustomSettings)
    const storedUrl = readString(storedCustom.url)
    const storedModel = readString(storedCustom.model)
    const storedKey = readUsableSecret(storedCustom.key)
    const configuration = request.custom
    if (!configuration) throw invalidRequest()

    let url = storedUrl
    let wireModel = storedModel
    if (configuration.source === 'provided') {
      url = configuration.url.trim()
      wireModel = configuration.model?.trim() ?? ''
      const providedEndpoint = validateCustomEmbeddingUrl(url)
      if (request.credential.source === 'stored' && storedKey) {
        if (!storedUrl || validateCustomEmbeddingUrl(storedUrl) !== providedEndpoint) {
          // Never pair a stored secret with a one-shot endpoint. A dirty URL
          // draft must either be persisted first or carry its own draft key.
          throw credentialUnavailable()
        }
      }
    }

    const key = resolveCredential(request.credential, storedKey)
    effective.hypaCustomSettings = { url, model: wireModel, key }
  } else if (isContextualRemoteEmbeddingModel(model)) {
    effective.voyageApiKey = resolveCredential(request.credential, readUsableSecret(settings.voyageApiKey))
  } else {
    effective.hypaV3Key = resolveCredential(request.credential, readUsableSecret(settings.hypaV3Key))
  }

  const resolved = resolveMemoryEmbeddingModel(effective as MemoryEmbeddingSettings, model)
  if (resolved.ok === false) {
    if (resolved.error.includes('requires') && resolved.error.toLowerCase().includes('key')) {
      throw credentialUnavailable()
    }
    throw configurationInvalid()
  }
  if (resolved.request.provider === 'custom') {
    validateCustomEmbeddingUrl(resolved.request.endpoint)
  }
  return resolved.request
}

export async function executeEmbeddingOperation(
  request: EmbeddingOperationRequest,
  settings: JsonRecord,
  options: EmbeddingOperationExecutionOptions = {},
): Promise<EmbeddingOperationSuccess> {
  const modelRequest = resolveEmbeddingOperationModel(request, settings)
  const timeout = createTimeoutController(options.timeoutMs ?? EMBEDDING_OPERATION_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([timeout.signal, options.signal]) : timeout.signal
  const adapterOptions = {
    request: modelRequest,
    signal,
    fetchImpl: options.fetchImpl,
    maxResponseBytes: options.maxResponseBytes ?? MEMORY_EMBEDDING_MAX_RESPONSE_BYTES,
    maxDimension: options.maxDimension ?? MEMORY_EMBEDDING_MAX_DIMENSION,
    maxVectorValues: options.maxVectorValues ?? MEMORY_EMBEDDING_MAX_VECTOR_VALUES,
  }

  try {
    if (request.operation === 'texts') {
      const result = await embedTexts({ ...adapterOptions, input: request.input })
      if ('error' in result) throw mapAdapterError(result.code, timeout.timedOut())
      return {
        operation: 'texts',
        model: result.model,
        dimension: result.dim,
        vectors: result.vectors.map((vector) => Array.from(vector)),
      }
    }

    const result = await embedTextGroups({
      ...adapterOptions,
      groups: request.groups,
      inputType: request.inputType,
    })
    if ('error' in result) throw mapAdapterError(result.code, timeout.timedOut())
    return {
      operation: 'groups',
      model: result.model,
      dimension: result.dim,
      groups: result.groups.map((group) => group.map((vector) => Array.from(vector))),
    }
  } finally {
    timeout.cleanup()
  }
}

function parseCredential(value: unknown): EmbeddingOperationCredential {
  const record = readExactRecord(value, ['source', 'apiKey'])
  if (record.source === 'none' || record.source === 'stored') {
    if (Object.keys(record).length !== 1) throw invalidRequest()
    return { source: record.source }
  }
  if (record.source === 'provided') {
    if (Object.keys(record).length !== 2) throw invalidRequest()
    const apiKey = readBoundedNonBlankString(record.apiKey, EMBEDDING_OPERATION_MAX_API_KEY_LENGTH)
    if (apiKey === MASKED_PROVIDER_SECRET) throw invalidRequest()
    return { source: 'provided', apiKey }
  }
  throw invalidRequest()
}

function parseCustomConfiguration(value: unknown): CustomEmbeddingConfiguration {
  const record = readExactRecord(value, ['source', 'url', 'model'])
  if (record.source === 'stored') {
    if (Object.keys(record).length !== 1) throw invalidRequest()
    return { source: 'stored' }
  }
  if (record.source === 'provided') {
    if (!Object.prototype.hasOwnProperty.call(record, 'url')) throw invalidRequest()
    const url = readBoundedNonBlankString(record.url, EMBEDDING_OPERATION_MAX_CUSTOM_URL_LENGTH)
    validateCustomEmbeddingUrl(url)
    const model =
      record.model === undefined
        ? undefined
        : readBoundedString(record.model, EMBEDDING_OPERATION_MAX_CUSTOM_MODEL_LENGTH).trim()
    return { source: 'provided', url, ...(model ? { model } : {}) }
  }
  throw invalidRequest()
}

function parseInputType(value: unknown): EmbeddingInputType {
  if (value === 'query' || value === 'document') return value
  throw invalidRequest()
}

function parseStringArray(value: unknown, maxCount: number): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxCount) throw invalidRequest()
  let totalBytes = 0
  const result = value.map((entry) => {
    if (typeof entry !== 'string') throw invalidRequest()
    const bytes = Buffer.byteLength(entry, 'utf8')
    if (bytes > EMBEDDING_OPERATION_MAX_INPUT_STRING_BYTES) throw invalidRequest()
    totalBytes += bytes
    return entry
  })
  if (totalBytes > EMBEDDING_OPERATION_MAX_INPUT_BYTES) throw invalidRequest()
  return result
}

function parseGroups(value: unknown): string[][] {
  if (!Array.isArray(value) || value.length === 0 || value.length > EMBEDDING_OPERATION_MAX_GROUPS) {
    throw invalidRequest()
  }
  let totalChunks = 0
  let totalBytes = 0
  const groups = value.map((group) => {
    if (!Array.isArray(group) || group.length === 0) throw invalidRequest()
    totalChunks += group.length
    return group.map((entry) => {
      if (typeof entry !== 'string') throw invalidRequest()
      const bytes = Buffer.byteLength(entry, 'utf8')
      if (bytes > EMBEDDING_OPERATION_MAX_INPUT_STRING_BYTES) throw invalidRequest()
      totalBytes += bytes
      return entry
    })
  })
  if (totalChunks > EMBEDDING_OPERATION_MAX_GROUP_CHUNKS || totalBytes > EMBEDDING_OPERATION_MAX_INPUT_BYTES) {
    throw invalidRequest()
  }
  return groups
}

function resolveCredential(credential: EmbeddingOperationCredential, stored: string | undefined): string {
  if (credential.source === 'none') return ''
  if (credential.source === 'provided') return credential.apiKey.trim()
  return stored ?? ''
}

function readUsableSecret(value: unknown): string | undefined {
  const secret = readString(value)
  return secret && secret !== MASKED_PROVIDER_SECRET ? secret : undefined
}

function validateCustomEmbeddingUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw configurationInvalid()
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    isCloudMetadataHost(url.hostname)
  ) {
    throw configurationInvalid()
  }
  const pathname = url.pathname.replace(/\/+$/, '')
  url.pathname = pathname.endsWith('/embeddings') ? pathname : `${pathname}/embeddings`
  return url.toString()
}

function isCloudMetadataHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    normalized === '169.254.169.254' ||
    normalized === 'fd00:ec2::254' ||
    normalized === 'metadata.google.internal' ||
    normalized === 'metadata.google.internal.'
  )
}

function mapAdapterError(
  code: 'configuration' | 'aborted' | 'fetch' | 'upstream' | 'invalid-json' | 'invalid-response' | 'dimension-mismatch',
  timedOut: boolean,
): EmbeddingOperationError {
  if (timedOut) return new EmbeddingOperationError('embedding_operation_timeout', 504)
  if (code === 'configuration') return configurationInvalid()
  if (code === 'invalid-json' || code === 'invalid-response' || code === 'dimension-mismatch') {
    return new EmbeddingOperationError('embedding_operation_invalid_response', 502)
  }
  return new EmbeddingOperationError('embedding_operation_failed', 502)
}

function readExactRecord(value: unknown, allowedKeys: readonly string[]): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidRequest()
  const record = value as JsonRecord
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) throw invalidRequest()
  return record
}

function readRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function readBoundedNonBlankString(value: unknown, maxLength: number): string {
  const text = readBoundedString(value, maxLength).trim()
  if (!text) throw invalidRequest()
  return text
}

function readBoundedString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) throw invalidRequest()
  return value
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const result = value.trim()
  return result || undefined
}

function invalidRequest(): EmbeddingOperationError {
  return new EmbeddingOperationError('invalid_embedding_operation_request', 400)
}

function credentialUnavailable(): EmbeddingOperationError {
  return new EmbeddingOperationError('embedding_credential_unavailable', 400)
}

function configurationInvalid(): EmbeddingOperationError {
  return new EmbeddingOperationError('embedding_configuration_invalid', 400)
}
