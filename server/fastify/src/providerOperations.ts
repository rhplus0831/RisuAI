import type {
  ProviderOperation,
  ProviderOperationCredential,
  ProviderOperationRequest,
} from '../../../src/ts/server/providerOperationsProtocol.js'
import { readBoundedBodyJson } from './generation/body.js'
import { MASKED_PROVIDER_SECRET } from './providerSecrets.js'
import { createTimeoutController } from './proxy.js'

export const PROVIDER_OPERATION_TIMEOUT_MS = 30_000
export const PROVIDER_OPERATION_MAX_RESPONSE_BYTES = 16 * 1024 * 1024
export const PROVIDER_OPERATION_MAX_API_KEY_LENGTH = 16 * 1024
export const PROVIDER_OPERATION_MAX_PROFILE_ID_LENGTH = 256
export const PROVIDER_OPERATION_MAX_MODEL_ID_LENGTH = 512
export const PROVIDER_OPERATION_MAX_TEXT_LENGTH = 512 * 1024

type JsonRecord = Record<string, unknown>
type ProviderKind = 'nanogpt' | 'openrouter' | 'ollama' | 'wavespeed' | 'google' | 'anthropic'

interface ProviderOperationSpec {
  provider: ProviderKind
  credentialRequired: boolean
  storedCredential(settings: JsonRecord): string | undefined
  buildRequest(apiKey: string | undefined, input: ProviderOperationRequest['input']): ProviderUpstreamRequest
}

export interface ProviderUpstreamRequest {
  url: string
  init: RequestInit
}

export interface ProviderOperationExecutionOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxResponseBytes?: number
  signal?: AbortSignal
}

export type ProviderOperationErrorCode =
  | 'invalid_provider_operation_request'
  | 'provider_credential_unavailable'
  | 'provider_operation_failed'
  | 'provider_operation_invalid_response'
  | 'provider_operation_timeout'

export class ProviderOperationError extends Error {
  readonly code: ProviderOperationErrorCode
  readonly statusCode: number
  readonly upstreamStatus?: number

  constructor(code: ProviderOperationErrorCode, statusCode: number, upstreamStatus?: number) {
    super(code)
    this.name = 'ProviderOperationError'
    this.code = code
    this.statusCode = statusCode
    this.upstreamStatus = upstreamStatus
  }
}

const OPERATION_SPECS: Record<ProviderOperation, ProviderOperationSpec> = {
  'nanogpt.balance': {
    provider: 'nanogpt',
    credentialRequired: true,
    storedCredential: (settings) => readString(settings.nanogptKey),
    buildRequest: (apiKey) => ({
      url: 'https://nano-gpt.com/api/check-balance',
      init: fixedJsonRequest('POST', { 'x-api-key': requiredApiKey(apiKey) }),
    }),
  },
  'nanogpt.subscription': {
    provider: 'nanogpt',
    credentialRequired: true,
    storedCredential: (settings) => readString(settings.nanogptKey),
    buildRequest: (apiKey) => ({
      url: 'https://nano-gpt.com/api/subscription/v1/usage',
      init: fixedJsonRequest('GET', bearerHeader(requiredApiKey(apiKey))),
    }),
  },
  'nanogpt.model-providers': {
    provider: 'nanogpt',
    credentialRequired: true,
    storedCredential: (settings) => readString(settings.nanogptKey),
    buildRequest: (apiKey, input) => ({
      url: `https://nano-gpt.com/api/models/${encodeURIComponent(requiredModelId(input))}/providers`,
      init: fixedJsonRequest('GET', bearerHeader(requiredApiKey(apiKey))),
    }),
  },
  'nanogpt.models': {
    provider: 'nanogpt',
    credentialRequired: false,
    storedCredential: (settings) => readString(settings.nanogptKey),
    buildRequest: (apiKey) => ({
      url: `${apiKey ? 'https://nano-gpt.com/api/personalized/v1/models' : 'https://nano-gpt.com/api/v1/models'}?detailed=true`,
      init: fixedJsonRequest('GET', apiKey ? bearerHeader(apiKey) : undefined),
    }),
  },
  'nanogpt.subscription-models': {
    provider: 'nanogpt',
    credentialRequired: true,
    storedCredential: (settings) => readString(settings.nanogptKey),
    buildRequest: (apiKey) => ({
      url: 'https://nano-gpt.com/api/subscription/v1/models?detailed=true',
      init: fixedJsonRequest('GET', bearerHeader(requiredApiKey(apiKey))),
    }),
  },
  'openrouter.models': {
    provider: 'openrouter',
    credentialRequired: false,
    storedCredential: (settings) => readString(settings.openrouterKey),
    buildRequest: (apiKey) => ({
      url: 'https://openrouter.ai/api/v1/models',
      init: fixedJsonRequest('GET', apiKey ? bearerHeader(apiKey) : undefined),
    }),
  },
  'openrouter.providers': {
    provider: 'openrouter',
    credentialRequired: false,
    storedCredential: (settings) => readString(settings.openrouterKey),
    buildRequest: (apiKey) => ({
      url: 'https://openrouter.ai/api/v1/providers',
      init: fixedJsonRequest('GET', apiKey ? bearerHeader(apiKey) : undefined),
    }),
  },
  'ollama.cloud-models': {
    provider: 'ollama',
    credentialRequired: false,
    storedCredential: (settings) => readString(settings.ollamaApiKey),
    buildRequest: (apiKey) => ({
      url: 'https://ollama.com/api/tags',
      init: fixedJsonRequest('GET', apiKey ? bearerHeader(apiKey) : undefined),
    }),
  },
  'wavespeed.models': {
    provider: 'wavespeed',
    credentialRequired: true,
    storedCredential: (settings) => readNestedString(settings, 'wavespeedImage', 'key'),
    buildRequest: (apiKey) => ({
      url: 'https://api.wavespeed.ai/api/v3/models',
      init: fixedJsonRequest('GET', bearerHeader(requiredApiKey(apiKey))),
    }),
  },
  'google.models': {
    provider: 'google',
    credentialRequired: true,
    storedCredential: (settings) => readNestedString(settings, 'google', 'accessToken'),
    buildRequest: (apiKey) => {
      const url = new URL('https://generativelanguage.googleapis.com/v1beta/models')
      url.searchParams.set('key', requiredApiKey(apiKey))
      return {
        url: url.toString(),
        init: fixedJsonRequest('GET'),
      }
    },
  },
  'google.count-tokens': {
    provider: 'google',
    credentialRequired: true,
    storedCredential: (settings) => readNestedString(settings, 'google', 'accessToken'),
    buildRequest: (apiKey, input) => {
      const url = new URL(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(requiredGoogleModelId(input))}:countTokens`,
      )
      url.searchParams.set('key', requiredApiKey(apiKey))
      return {
        url: url.toString(),
        init: {
          ...fixedJsonRequest('POST'),
          body: JSON.stringify({
            contents: [{ parts: [{ text: requiredText(input) }] }],
          }),
        },
      }
    },
  },
  'anthropic.models': {
    provider: 'anthropic',
    credentialRequired: true,
    storedCredential: (settings) => readString(settings.claudeAPIKey),
    buildRequest: (apiKey) => ({
      url: 'https://api.anthropic.com/v1/models',
      init: fixedJsonRequest('GET', {
        'anthropic-version': '2023-06-01',
        'x-api-key': requiredApiKey(apiKey),
      }),
    }),
  },
}

export function parseProviderOperationRequest(body: unknown): ProviderOperationRequest {
  const record = readExactRecord(body, ['operation', 'credential', 'input'])
  const operation = record.operation
  if (typeof operation !== 'string' || !Object.prototype.hasOwnProperty.call(OPERATION_SPECS, operation)) {
    throw invalidRequest()
  }

  const credential = parseCredential(record.credential)
  const input = parseOperationInput(operation as ProviderOperation, record.input)
  return {
    operation: operation as ProviderOperation,
    credential,
    ...(input ? { input } : {}),
  }
}

export function resolveProviderUpstreamRequest(
  request: ProviderOperationRequest,
  settings: JsonRecord,
): ProviderUpstreamRequest {
  const spec = OPERATION_SPECS[request.operation]
  const apiKey = resolveCredential(request.credential, spec, settings)
  if (spec.credentialRequired && !apiKey) {
    throw credentialUnavailable()
  }
  return spec.buildRequest(apiKey, request.input)
}

export async function executeProviderOperation(
  request: ProviderOperationRequest,
  settings: JsonRecord,
  options: ProviderOperationExecutionOptions = {},
): Promise<unknown> {
  const upstream = resolveProviderUpstreamRequest(request, settings)
  const timeout = createTimeoutController(options.timeoutMs ?? PROVIDER_OPERATION_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([timeout.signal, options.signal]) : timeout.signal

  try {
    let response: Response
    try {
      response = await (options.fetchImpl ?? fetch)(upstream.url, {
        ...upstream.init,
        signal,
      })
    } catch {
      if (signal.aborted) {
        throw new ProviderOperationError('provider_operation_timeout', 504)
      }
      throw new ProviderOperationError('provider_operation_failed', 502)
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new ProviderOperationError('provider_operation_failed', 502, response.status)
    }

    try {
      return await readBoundedBodyJson(response, options.maxResponseBytes ?? PROVIDER_OPERATION_MAX_RESPONSE_BYTES)
    } catch {
      if (signal.aborted) {
        throw new ProviderOperationError('provider_operation_timeout', 504)
      }
      throw new ProviderOperationError('provider_operation_invalid_response', 502)
    }
  } finally {
    timeout.cleanup()
  }
}

function fixedJsonRequest(method: 'GET' | 'POST', headers: Record<string, string> = {}): RequestInit {
  return {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...headers,
    },
    redirect: 'error',
  }
}

function bearerHeader(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` }
}

function requiredApiKey(apiKey: string | undefined): string {
  if (!apiKey) throw credentialUnavailable()
  return apiKey
}

function requiredModelId(input: ProviderOperationRequest['input']): string {
  if (!input?.modelId) throw invalidRequest()
  return input.modelId
}

function requiredText(input: ProviderOperationRequest['input']): string {
  if (!input || !('text' in input)) throw invalidRequest()
  return input.text
}

function requiredGoogleModelId(input: ProviderOperationRequest['input']): string {
  const modelId = requiredModelId(input)
  return modelId.startsWith('models/') ? modelId.slice('models/'.length) : modelId
}

function parseCredential(value: unknown): ProviderOperationCredential {
  const record = readExactRecord(value, ['source', 'apiKey', 'profileId'])
  const source = record.source
  if (source === 'none' || source === 'stored') {
    if (Object.keys(record).length !== 1) throw invalidRequest()
    return { source }
  }
  if (source === 'provided') {
    if (Object.keys(record).length !== 2) throw invalidRequest()
    const apiKey = readBoundedNonBlankString(record.apiKey, PROVIDER_OPERATION_MAX_API_KEY_LENGTH)
    if (apiKey === MASKED_PROVIDER_SECRET) throw invalidRequest()
    return { source, apiKey }
  }
  if (source === 'model-profile') {
    if (Object.keys(record).length !== 2) throw invalidRequest()
    return {
      source,
      profileId: readBoundedNonBlankString(record.profileId, PROVIDER_OPERATION_MAX_PROFILE_ID_LENGTH),
    }
  }
  throw invalidRequest()
}

function parseOperationInput(
  operation: ProviderOperation,
  value: unknown,
): ProviderOperationRequest['input'] | undefined {
  if (operation === 'nanogpt.model-providers') {
    const record = readExactRecord(value, ['modelId'])
    if (Object.keys(record).length !== 1) throw invalidRequest()
    return {
      modelId: readBoundedNonBlankString(record.modelId, PROVIDER_OPERATION_MAX_MODEL_ID_LENGTH),
    }
  }

  if (operation === 'google.count-tokens') {
    const record = readExactRecord(value, ['modelId', 'text'])
    if (Object.keys(record).length !== 2) throw invalidRequest()
    return {
      modelId: readBoundedNonBlankString(record.modelId, PROVIDER_OPERATION_MAX_MODEL_ID_LENGTH),
      text: readBoundedString(record.text, PROVIDER_OPERATION_MAX_TEXT_LENGTH),
    }
  }

  if (value !== undefined) throw invalidRequest()
  return undefined
}

function resolveCredential(
  credential: ProviderOperationCredential,
  spec: ProviderOperationSpec,
  settings: JsonRecord,
): string | undefined {
  if (credential.source === 'none') return undefined
  if (credential.source === 'stored') return spec.storedCredential(settings)
  if (credential.source === 'provided') return credential.apiKey
  if (spec.provider === 'wavespeed') throw credentialUnavailable()

  const profiles = settings.modelProfiles
  if (!Array.isArray(profiles)) throw credentialUnavailable()
  const profile = profiles.find(
    (candidate): candidate is JsonRecord => isRecord(candidate) && candidate.id === credential.profileId,
  )
  if (!profile || !profileMatchesProvider(profile, spec.provider)) throw credentialUnavailable()
  return readNestedString(profile, 'providerOptions', 'apiKey') ?? spec.storedCredential(settings)
}

function profileMatchesProvider(profile: JsonRecord, provider: ProviderKind): boolean {
  const providerId = readString(profile.providerId)
  const modelId = readString(profile.modelId)
  if (provider === 'openrouter') return providerId === 'openrouter' || modelId === 'openrouter'
  if (provider === 'nanogpt') return providerId === 'nanogpt' || modelId === 'nanogpt'
  if (provider === 'ollama') return providerId === 'ollama' || modelId === 'ollama-cloud'
  if (provider === 'google') return providerId === 'google'
  if (provider === 'anthropic') return providerId === 'anthropic'
  return false
}

function readExactRecord(value: unknown, allowedKeys: readonly string[]): JsonRecord {
  if (!isRecord(value)) throw invalidRequest()
  const allowed = new Set(allowedKeys)
  if (Object.keys(value).some((key) => !allowed.has(key))) throw invalidRequest()
  return value
}

function readBoundedNonBlankString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) throw invalidRequest()
  return value
}

function readBoundedString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) throw invalidRequest()
  return value
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function readNestedString(record: JsonRecord, parentKey: string, childKey: string): string | undefined {
  const parent = record[parentKey]
  return isRecord(parent) ? readString(parent[childKey]) : undefined
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function invalidRequest(): ProviderOperationError {
  return new ProviderOperationError('invalid_provider_operation_request', 400)
}

function credentialUnavailable(): ProviderOperationError {
  return new ProviderOperationError('provider_credential_unavailable', 400)
}
