import {
  FIXTURE_ASSISTANT_ID,
  FIXTURE_CHARACTER_ID,
  FIXTURE_CHAT_ID,
  FIXTURE_USER_ID,
  MOCK_OPENAI_KEY,
} from './fixture'
import type { CapturedProviderRequest } from './types'

const FIXTURE_IDS = new Set([FIXTURE_ASSISTANT_ID, FIXTURE_CHARACTER_ID, FIXTURE_CHAT_ID, FIXTURE_USER_ID])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function idNormalizer() {
  const mapped = new Map<string, string>()
  let next = 1
  return (value: unknown): unknown => {
    if (typeof value !== 'string' || value.length === 0 || FIXTURE_IDS.has(value)) return value
    let normalized = mapped.get(value)
    if (!normalized) {
      normalized = `<generated-id-${next}>`
      next += 1
      mapped.set(value, normalized)
    }
    return normalized
  }
}

const GENERATION_ID_KEYS = new Set([
  'generationId',
  'databaseLineage',
  'operationId',
  'acceptedMessageId',
  'jobId',
  'effectLedgerKeyId',
  'effectLedgerCharacterId',
  'effectLedgerChatId',
])

function normalizeGenerationInfo(value: unknown, normalizeId: (value: unknown) => unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalJson(item))
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, GENERATION_ID_KEYS.has(key) ? normalizeId(value[key]) : canonicalJson(value[key])]),
  )
}

export function normalizeTranscript(messages: unknown[]): Array<Record<string, unknown>> {
  const normalizeId = idNormalizer()
  return messages.map((raw) => {
    if (!isRecord(raw)) throw new Error('Transcript entries must be objects')
    return Object.fromEntries(
      Object.keys(raw)
        .sort()
        .map((key) => {
          if (key === 'chatId' || key === 'saying') return [key, normalizeId(raw[key])]
          if (key === 'time' && raw[key] !== null) return [key, '<present>']
          if (key === 'generationInfo') return [key, normalizeGenerationInfo(raw[key], normalizeId)]
          return [key, canonicalJson(raw[key])]
        }),
    )
  })
}

function headersRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {}
  const entries =
    headers instanceof Headers ? [...headers.entries()] : Array.isArray(headers) ? headers : Object.entries(headers)
  return Object.fromEntries(
    entries
      .map(([key, value]) => [key.toLowerCase(), String(value)] as const)
      .map(([key, value]) => [key, value.replaceAll(MOCK_OPENAI_KEY, '<redacted>')] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

function decodeBody(body: BodyInit | null | undefined): string {
  if (body === undefined || body === null) return ''
  if (typeof body === 'string') return body
  if (body instanceof Uint8Array) return new TextDecoder().decode(body)
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body))
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(new Uint8Array(body.buffer, body.byteOffset, body.byteLength))
  }
  throw new Error(`Unsupported provider request body: ${Object.prototype.toString.call(body)}`)
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJson(value[key])]),
  )
}

export function captureProviderRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): CapturedProviderRequest {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const raw = decodeBody(init?.body)
  const body = raw.length > 0 ? (canonicalJson(JSON.parse(raw)) as Record<string, unknown>) : {}
  return {
    url,
    method: init?.method ?? 'GET',
    headers: headersRecord(init?.headers),
    body,
  }
}

export function openAiMockResponse(reply: string, streamed: boolean): Response {
  if (!streamed) {
    return new Response(
      JSON.stringify({
        id: 'compat-completion',
        model: 'gpt-4o',
        choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  const parts =
    reply.length <= 1
      ? [reply]
      : [reply.slice(0, Math.floor(reply.length / 2)), reply.slice(Math.floor(reply.length / 2))]
  const frames = parts
    .filter((part) => part.length > 0)
    .map(
      (part) =>
        `data: ${JSON.stringify({
          id: 'compat-completion',
          model: 'gpt-4o',
          choices: [{ index: 0, delta: { content: part }, finish_reason: null }],
        })}\n\n`,
    )
  frames.push(
    `data: ${JSON.stringify({
      id: 'compat-completion',
      model: 'gpt-4o',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`,
  )
  frames.push('data: [DONE]\n\n')
  return new Response(frames.join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  })
}
