import type {
  FishSynthesisInput,
  HuggingFaceSynthesisInput,
  NovelAiSynthesisInput,
  OpenAiSynthesisInput,
  OpenAiTtsFormat,
  ProvidedOpenAiSynthesisConfig,
  TtsSynthesisCredential,
  TtsSynthesisOperation,
  TtsSynthesisRequest,
} from '@risuai/protocol/tts-synthesis'
import { isTtsSynthesisOperation } from '@risuai/protocol/tts-synthesis'
import { readBoundedBodyJson } from './generation/body.js'
import { MASKED_PROVIDER_SECRET } from './providerSecrets.js'
import { createTimeoutController } from './proxy.js'

export const TTS_SYNTHESIS_TIMEOUT_MS = 150_000
export const TTS_SYNTHESIS_MAX_RESPONSE_BYTES = 64 * 1024 * 1024
export const TTS_SYNTHESIS_BODY_LIMIT = 256 * 1024
export const TTS_MAX_TEXT_LENGTH = 100_000
export const TTS_MAX_API_KEY_LENGTH = 16 * 1024
export const TTS_MAX_CHARACTER_ID_LENGTH = 256
export const TTS_MAX_IDENTIFIER_LENGTH = 1_024
export const TTS_MAX_BASE_URL_LENGTH = 2_048
export const HF_TTS_MAX_ATTEMPTS = 5
export const HF_TTS_MAX_TOTAL_RETRY_WAIT_MS = 120_000
const HF_TTS_RETRY_BODY_BYTES = 64 * 1024

type JsonRecord = Record<string, unknown>

export interface TtsStoredContext {
  settings: JsonRecord
  character?: JsonRecord | null
}

export interface TtsUpstreamRequest {
  url: string
  init: RequestInit
  fallbackContentType: string
}

export interface TtsSynthesisResult {
  bytes: Uint8Array
  contentType: string
}

export interface TtsSynthesisExecutionOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxResponseBytes?: number
  signal?: AbortSignal
  sleepImpl?: (delayMs: number, signal: AbortSignal) => Promise<void>
}

export type TtsSynthesisErrorCode =
  | 'invalid_tts_request'
  | 'tts_credential_unavailable'
  | 'tts_character_unavailable'
  | 'tts_upstream_failed'
  | 'tts_upstream_invalid_response'
  | 'tts_upstream_timeout'

export class TtsSynthesisError extends Error {
  readonly code: TtsSynthesisErrorCode
  readonly statusCode: number
  readonly upstreamStatus?: number

  constructor(code: TtsSynthesisErrorCode, statusCode: number, upstreamStatus?: number) {
    super(code)
    this.name = 'TtsSynthesisError'
    this.code = code
    this.statusCode = statusCode
    this.upstreamStatus = upstreamStatus
  }
}

export function parseTtsSynthesisRequest(body: unknown): TtsSynthesisRequest {
  const record = readExactRecord(body, ['operation', 'credential', 'input'])
  if (!isTtsSynthesisOperation(record.operation)) throw invalidRequest()

  const credential = parseCredential(record.credential)
  const input = parseInput(record.operation, record.input, credential)
  return {
    operation: record.operation,
    credential,
    input,
  } as TtsSynthesisRequest
}

export function resolveTtsUpstreamRequest(request: TtsSynthesisRequest, context: TtsStoredContext): TtsUpstreamRequest {
  switch (request.operation) {
    case 'elevenlabs.synthesize': {
      const apiKey = requiredGlobalCredential(request.credential, context.settings, 'elevenLabKey')
      return {
        url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(request.input.voiceId)}`,
        init: fixedRequest(
          'POST',
          {
            Accept: 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
          },
          {
            text: request.input.text,
            model_id: 'eleven_multilingual_v2',
          },
        ),
        fallbackContentType: 'audio/mpeg',
      }
    }
    case 'fish.synthesize': {
      const apiKey = requiredGlobalCredential(request.credential, context.settings, 'fishSpeechKey')
      return {
        url: 'https://api.fish.audio/v1/tts',
        init: fixedRequest(
          'POST',
          {
            Accept: 'audio/mpeg',
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          {
            text: request.input.text,
            reference_id: request.input.referenceId,
            chunk_length: request.input.chunkLength,
            normalize: request.input.normalize,
            format: 'mp3',
            mp3_bitrate: 192,
          },
        ),
        fallbackContentType: 'audio/mpeg',
      }
    }
    case 'huggingface.synthesize': {
      const apiKey = requiredGlobalCredential(request.credential, context.settings, 'huggingfaceKey')
      const modelPath = request.input.model
        .split('/')
        .map((part) => encodeURIComponent(part))
        .join('/')
      return {
        url: `https://api-inference.huggingface.co/models/${modelPath}`,
        init: fixedRequest(
          'POST',
          {
            Accept: 'audio/*',
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          { inputs: request.input.text },
        ),
        fallbackContentType: 'audio/wav',
      }
    }
    case 'novelai.synthesize': {
      const apiKey = requiredGlobalCredential(request.credential, context.settings, 'NAIApiKey')
      const url = new URL('https://api.novelai.net/ai/generate-voice')
      url.searchParams.set('text', request.input.text)
      url.searchParams.set('voice', '-1')
      url.searchParams.set('seed', request.input.seed)
      url.searchParams.set('opus', 'false')
      url.searchParams.set('version', request.input.version)
      return {
        url: url.toString(),
        init: fixedRequest('GET', {
          Accept: 'audio/wav',
          Authorization: `Bearer ${apiKey}`,
        }),
        fallbackContentType: 'audio/wav',
      }
    }
    case 'openai.synthesize': {
      const resolved = resolveOpenAiConfiguration(request.credential, request.input, context)
      const url = appendPathToBaseUrl(resolved.config.baseUrl, 'audio/speech')
      return {
        url,
        init: fixedRequest(
          'POST',
          {
            Accept: 'audio/*',
            'Content-Type': 'application/json',
            ...(resolved.apiKey ? { Authorization: `Bearer ${resolved.apiKey}` } : {}),
          },
          {
            model: resolved.config.model,
            input: request.input.text,
            voice: resolved.config.voice,
            response_format: resolved.config.format,
          },
        ),
        fallbackContentType: contentTypeForOpenAiFormat(resolved.config.format),
      }
    }
  }
}

export async function executeTtsSynthesis(
  request: TtsSynthesisRequest,
  context: TtsStoredContext,
  options: TtsSynthesisExecutionOptions = {},
): Promise<TtsSynthesisResult> {
  const upstream = resolveTtsUpstreamRequest(request, context)
  const timeout = createTimeoutController(options.timeoutMs ?? TTS_SYNTHESIS_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([timeout.signal, options.signal]) : timeout.signal
  const fetchImpl = options.fetchImpl ?? fetch

  try {
    let response: Response
    if (request.operation === 'huggingface.synthesize') {
      response = await executeHuggingFaceRequest(upstream, fetchImpl, signal, options.sleepImpl)
    } else {
      response = await fetchUpstream(upstream, fetchImpl, signal)
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new TtsSynthesisError('tts_upstream_failed', 502, response.status)
    }

    let contentType: string
    try {
      contentType = resolveAudioContentType(response.headers.get('content-type'), upstream.fallbackContentType)
    } catch (error) {
      await response.body?.cancel().catch(() => undefined)
      throw error
    }
    let bytes: Uint8Array
    try {
      bytes = await readBoundedBodyBytes(response, options.maxResponseBytes ?? TTS_SYNTHESIS_MAX_RESPONSE_BYTES)
    } catch {
      if (signal.aborted) throw new TtsSynthesisError('tts_upstream_timeout', 504)
      throw new TtsSynthesisError('tts_upstream_invalid_response', 502)
    }
    if (bytes.byteLength === 0) throw new TtsSynthesisError('tts_upstream_invalid_response', 502)
    return { bytes, contentType }
  } finally {
    timeout.cleanup()
  }
}

async function executeHuggingFaceRequest(
  upstream: TtsUpstreamRequest,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  sleepImpl: TtsSynthesisExecutionOptions['sleepImpl'],
): Promise<Response> {
  let totalRetryWaitMs = 0
  for (let attempt = 1; attempt <= HF_TTS_MAX_ATTEMPTS; attempt += 1) {
    const response = await fetchUpstream(upstream, fetchImpl, signal)
    if (response.status !== 503 || !isJsonContentType(response.headers.get('content-type'))) return response

    let retryDelayMs: number | null = null
    try {
      retryDelayMs = huggingFaceRetryDelayMs(await readBoundedBodyJson(response, HF_TTS_RETRY_BODY_BYTES))
    } catch {
      if (signal.aborted) throw new TtsSynthesisError('tts_upstream_timeout', 504)
      throw new TtsSynthesisError('tts_upstream_invalid_response', 502)
    }
    const canRetry =
      retryDelayMs !== null &&
      attempt < HF_TTS_MAX_ATTEMPTS &&
      totalRetryWaitMs + retryDelayMs <= HF_TTS_MAX_TOTAL_RETRY_WAIT_MS
    if (!canRetry || retryDelayMs === null) {
      throw new TtsSynthesisError('tts_upstream_failed', 502, response.status)
    }

    totalRetryWaitMs += retryDelayMs
    await (sleepImpl ?? abortableSleep)(retryDelayMs, signal)
  }
  throw new TtsSynthesisError('tts_upstream_failed', 502, 503)
}

async function fetchUpstream(
  upstream: TtsUpstreamRequest,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<Response> {
  try {
    return await fetchImpl(upstream.url, { ...upstream.init, signal })
  } catch {
    if (signal.aborted) throw new TtsSynthesisError('tts_upstream_timeout', 504)
    throw new TtsSynthesisError('tts_upstream_failed', 502)
  }
}

function parseCredential(value: unknown): TtsSynthesisCredential {
  const record = readExactRecord(value, ['source', 'apiKey', 'characterId'])
  if (record.source === 'none' || record.source === 'stored') {
    if (Object.keys(record).length !== 1) throw invalidRequest()
    return { source: record.source }
  }
  if (record.source === 'provided') {
    if (Object.keys(record).length !== 2) throw invalidRequest()
    const apiKey = readBoundedNonBlankString(record.apiKey, TTS_MAX_API_KEY_LENGTH)
    if (apiKey === MASKED_PROVIDER_SECRET) throw invalidRequest()
    return { source: 'provided', apiKey }
  }
  if (record.source === 'stored-character') {
    if (Object.keys(record).length !== 2) throw invalidRequest()
    return {
      source: 'stored-character',
      characterId: readBoundedNonBlankString(record.characterId, TTS_MAX_CHARACTER_ID_LENGTH),
    }
  }
  throw invalidRequest()
}

function parseInput(
  operation: TtsSynthesisOperation,
  value: unknown,
  credential: TtsSynthesisCredential,
): TtsSynthesisRequest['input'] {
  switch (operation) {
    case 'elevenlabs.synthesize': {
      rejectCredentialSources(credential, ['stored', 'provided'])
      const input = readExactRecord(value, ['text', 'voiceId'])
      return {
        text: readTtsText(input.text),
        voiceId: readBoundedNonBlankString(input.voiceId, TTS_MAX_IDENTIFIER_LENGTH),
      }
    }
    case 'fish.synthesize': {
      rejectCredentialSources(credential, ['stored', 'provided'])
      const input = readExactRecord(value, ['text', 'referenceId', 'chunkLength', 'normalize'])
      return {
        text: readTtsText(input.text),
        referenceId: readBoundedNonBlankString(input.referenceId, TTS_MAX_IDENTIFIER_LENGTH),
        chunkLength: readBoundedInteger(input.chunkLength, 1, 10_000),
        normalize: readBoolean(input.normalize),
      } satisfies FishSynthesisInput
    }
    case 'huggingface.synthesize': {
      rejectCredentialSources(credential, ['stored', 'provided'])
      const input = readExactRecord(value, ['text', 'model'])
      const model = readBoundedNonBlankString(input.model, TTS_MAX_IDENTIFIER_LENGTH)
      if (model.split('/').some((part) => part.length === 0 || part === '.' || part === '..')) throw invalidRequest()
      return {
        text: readTtsText(input.text),
        model,
      } satisfies HuggingFaceSynthesisInput
    }
    case 'novelai.synthesize': {
      rejectCredentialSources(credential, ['stored', 'provided'])
      const input = readExactRecord(value, ['text', 'seed', 'version'])
      if (input.version !== 'v1' && input.version !== 'v2') throw invalidRequest()
      return {
        text: readTtsText(input.text),
        seed: readBoundedNonBlankString(input.seed, TTS_MAX_IDENTIFIER_LENGTH),
        version: input.version,
      } satisfies NovelAiSynthesisInput
    }
    case 'openai.synthesize': {
      rejectCredentialSources(credential, ['none', 'provided', 'stored-character'])
      const input = readExactRecord(value, ['text', 'config'])
      const text = readTtsText(input.text)
      if (credential.source === 'stored-character') {
        if (input.config !== undefined) throw invalidRequest()
        return { text } satisfies OpenAiSynthesisInput
      }
      return {
        text,
        config: parseProvidedOpenAiConfig(input.config),
      } satisfies OpenAiSynthesisInput
    }
  }
}

function parseProvidedOpenAiConfig(value: unknown): ProvidedOpenAiSynthesisConfig {
  const config = readExactRecord(value, ['baseUrl', 'model', 'voice', 'format'])
  return {
    baseUrl: normalizeOpenAiBaseUrl(readBoundedNonBlankString(config.baseUrl, TTS_MAX_BASE_URL_LENGTH)),
    model: readBoundedNonBlankString(config.model, TTS_MAX_IDENTIFIER_LENGTH),
    voice: readBoundedNonBlankString(config.voice, TTS_MAX_IDENTIFIER_LENGTH),
    format: readOpenAiFormat(config.format),
  }
}

function resolveOpenAiConfiguration(
  credential: TtsSynthesisCredential,
  input: OpenAiSynthesisInput,
  context: TtsStoredContext,
): { apiKey: string | undefined; config: ProvidedOpenAiSynthesisConfig } {
  if (credential.source === 'stored-character') {
    const character = context.character
    if (!character || character.chaId !== credential.characterId || character.ttsMode !== 'openai') {
      throw new TtsSynthesisError('tts_character_unavailable', 404)
    }
    const rawConfig = character.oaiTTSConfig
    const configRecord: JsonRecord | undefined =
      isRecord(rawConfig) && rawConfig.enabled === true ? rawConfig : undefined
    const characterKey = configRecord ? readString(configRecord.apiKey) : undefined
    const globalKey = readString(context.settings.openAIKey)
    return {
      apiKey: characterKey ?? globalKey,
      config: {
        baseUrl: normalizeOpenAiBaseUrl(readString(configRecord?.baseURL) ?? 'https://api.openai.com/v1'),
        model: readString(configRecord?.model) ?? 'tts-1',
        voice: readString(configRecord?.voice) ?? readString(character.oaiVoice) ?? 'alloy',
        format: readOpenAiFormat(configRecord?.format ?? 'mp3'),
      },
    }
  }

  if (credential.source === 'stored') throw invalidRequest()
  if (!input.config) throw invalidRequest()
  return {
    apiKey: credential.source === 'provided' ? credential.apiKey : undefined,
    config: input.config,
  }
}

function requiredGlobalCredential(
  credential: TtsSynthesisCredential,
  settings: JsonRecord,
  settingKey: string,
): string {
  if (credential.source === 'provided') return credential.apiKey
  if (credential.source === 'stored') {
    const value = readString(settings[settingKey])
    if (value) return value
  }
  throw new TtsSynthesisError('tts_credential_unavailable', 400)
}

function fixedRequest(method: 'GET' | 'POST', headers: Record<string, string>, body?: unknown): RequestInit {
  return {
    method,
    headers,
    redirect: 'error',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}

function appendPathToBaseUrl(baseUrl: string, suffix: string): string {
  const parsed = new URL(normalizeOpenAiBaseUrl(baseUrl))
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/${suffix}`
  return parsed.toString()
}

function normalizeOpenAiBaseUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw invalidRequest()
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw invalidRequest()
  }
  return parsed.toString().replace(/\/+$/, '')
}

function contentTypeForOpenAiFormat(format: OpenAiTtsFormat): string {
  if (format === 'mp3') return 'audio/mpeg'
  if (format === 'opus') return 'audio/opus'
  if (format === 'aac') return 'audio/aac'
  if (format === 'flac') return 'audio/flac'
  if (format === 'pcm') return 'audio/pcm'
  return 'audio/wav'
}

function resolveAudioContentType(value: string | null, fallback: string): string {
  if (!value) return fallback
  const contentType = value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (!contentType.startsWith('audio/') && contentType !== 'application/octet-stream') {
    throw new TtsSynthesisError('tts_upstream_invalid_response', 502)
  }
  return contentType
}

async function readBoundedBodyBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('tts response exceeded byte limit')
  }
  const body = response.body
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) throw new Error('tts response exceeded byte limit')
      chunks.push(value)
    }
  } finally {
    reader.cancel().catch(() => undefined)
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

function huggingFaceRetryDelayMs(value: unknown): number | null {
  if (!isRecord(value)) return null
  const estimatedTime = Number(value.estimated_time)
  if (!Number.isFinite(estimatedTime) || estimatedTime <= 0) return null
  return Math.ceil(estimatedTime * 1_000)
}

function isJsonContentType(value: string | null): boolean {
  return value?.toLowerCase().includes('application/json') ?? false
}

function abortableSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new TtsSynthesisError('tts_upstream_timeout', 504))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new TtsSynthesisError('tts_upstream_timeout', 504))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function rejectCredentialSources(
  credential: TtsSynthesisCredential,
  allowed: readonly TtsSynthesisCredential['source'][],
): void {
  if (!allowed.includes(credential.source)) throw invalidRequest()
}

function readTtsText(value: unknown): string {
  return readBoundedNonBlankString(value, TTS_MAX_TEXT_LENGTH)
}

function readOpenAiFormat(value: unknown): OpenAiTtsFormat {
  if (
    value === 'mp3' ||
    value === 'opus' ||
    value === 'aac' ||
    value === 'flac' ||
    value === 'wav' ||
    value === 'pcm'
  ) {
    return value
  }
  throw invalidRequest()
}

function readBoundedInteger(value: unknown, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw invalidRequest()
  return value as number
}

function readBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw invalidRequest()
  return value
}

function readBoundedNonBlankString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) throw invalidRequest()
  return value
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function readExactRecord(value: unknown, allowedKeys: readonly string[]): JsonRecord {
  if (!isRecord(value)) throw invalidRequest()
  const allowed = new Set(allowedKeys)
  if (Object.keys(value).some((key) => !allowed.has(key))) throw invalidRequest()
  return value
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function invalidRequest(): TtsSynthesisError {
  return new TtsSynthesisError('invalid_tts_request', 400)
}
