import { basename, extname } from 'node:path'
import { readBoundedBodyText } from './generation/body.js'
import { MASKED_PROVIDER_SECRET } from './providerSecrets.js'
import { createTimeoutController } from './proxy.js'

export const OPENAI_TRANSCRIPTION_MAX_FILE_BYTES = 25 * 1024 * 1024
export const OPENAI_TRANSCRIPTION_MAX_RESPONSE_BYTES = 4 * 1024 * 1024
export const OPENAI_TRANSCRIPTION_TIMEOUT_MS = 120_000
export const OPENAI_TRANSCRIPTION_MAX_FILENAME_LENGTH = 255

const TRANSCRIPTION_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions'
const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.mpeg': 'audio/mpeg',
  '.mpga': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
}

type JsonRecord = Record<string, unknown>

export interface OpenAITranscriptionInput {
  bytes: Uint8Array
  filename: string
}

export interface OpenAITranscriptionExecutionOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxResponseBytes?: number
  signal?: AbortSignal
}

export type OpenAITranscriptionErrorCode =
  | 'invalid_openai_transcription_request'
  | 'openai_transcription_credential_unavailable'
  | 'openai_transcription_failed'
  | 'openai_transcription_invalid_response'
  | 'openai_transcription_timeout'
  | 'openai_transcription_cancelled'

export class OpenAITranscriptionError extends Error {
  readonly code: OpenAITranscriptionErrorCode
  readonly statusCode: number
  readonly upstreamStatus?: number

  constructor(code: OpenAITranscriptionErrorCode, statusCode: number, upstreamStatus?: number) {
    super(code)
    this.name = 'OpenAITranscriptionError'
    this.code = code
    this.statusCode = statusCode
    this.upstreamStatus = upstreamStatus
  }
}

export function validateOpenAITranscriptionInput(input: OpenAITranscriptionInput): {
  bytes: Uint8Array
  filename: string
  contentType: string
} {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) throw invalidRequest()
  if (input.bytes.byteLength > OPENAI_TRANSCRIPTION_MAX_FILE_BYTES) throw invalidRequest()
  if (typeof input.filename !== 'string' || input.filename.length === 0 || input.filename.length > 4096) {
    throw invalidRequest()
  }

  const filename = basename(input.filename).slice(0, OPENAI_TRANSCRIPTION_MAX_FILENAME_LENGTH)
  if (!filename || filename === '.' || filename === '..') throw invalidRequest()
  const extension = extname(filename).toLowerCase()
  const contentType = CONTENT_TYPE_BY_EXTENSION[extension]
  if (!contentType) throw invalidRequest()
  return { bytes: input.bytes, filename, contentType }
}

export async function executeOpenAITranscription(
  input: OpenAITranscriptionInput,
  settings: JsonRecord,
  options: OpenAITranscriptionExecutionOptions = {},
): Promise<string> {
  const validated = validateOpenAITranscriptionInput(input)
  const apiKey = readString(settings.openAIKey)
  if (!apiKey || apiKey === MASKED_PROVIDER_SECRET) throw credentialUnavailable()

  const fileBuffer = new ArrayBuffer(validated.bytes.byteLength)
  new Uint8Array(fileBuffer).set(validated.bytes)
  const form = new FormData()
  form.append('file', new Blob([fileBuffer], { type: validated.contentType }), validated.filename)
  form.append('model', 'whisper-1')
  form.append('response_format', 'vtt')

  const timeout = createTimeoutController(options.timeoutMs ?? OPENAI_TRANSCRIPTION_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([timeout.signal, options.signal]) : timeout.signal
  try {
    let response: Response
    try {
      response = await (options.fetchImpl ?? fetch)(TRANSCRIPTION_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'text/vtt, text/plain;q=0.9',
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
        redirect: 'error',
        signal,
      })
    } catch {
      if (timeout.timedOut()) throw new OpenAITranscriptionError('openai_transcription_timeout', 504)
      if (options.signal?.aborted) throw new OpenAITranscriptionError('openai_transcription_cancelled', 499)
      throw new OpenAITranscriptionError('openai_transcription_failed', 502)
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new OpenAITranscriptionError('openai_transcription_failed', 502, response.status)
    }

    let vtt: string
    try {
      vtt = await readBoundedBodyText(response, options.maxResponseBytes ?? OPENAI_TRANSCRIPTION_MAX_RESPONSE_BYTES)
    } catch {
      if (timeout.timedOut()) throw new OpenAITranscriptionError('openai_transcription_timeout', 504)
      if (options.signal?.aborted) throw new OpenAITranscriptionError('openai_transcription_cancelled', 499)
      throw invalidResponse()
    }
    if (!/^WEBVTT(?:\s|$)/.test(vtt) || vtt.includes('\0')) throw invalidResponse()
    return vtt
  } finally {
    timeout.cleanup()
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function invalidRequest(): OpenAITranscriptionError {
  return new OpenAITranscriptionError('invalid_openai_transcription_request', 400)
}

function credentialUnavailable(): OpenAITranscriptionError {
  return new OpenAITranscriptionError('openai_transcription_credential_unavailable', 400)
}

function invalidResponse(): OpenAITranscriptionError {
  return new OpenAITranscriptionError('openai_transcription_invalid_response', 502)
}
