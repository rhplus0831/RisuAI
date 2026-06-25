import { createHash } from 'node:crypto'

type Jsonish = null | boolean | number | string | Jsonish[] | { [key: string]: Jsonish }

const SECRET_KEY_PATTERN =
  /^(authorization|api[-_]?key|key|token|access[-_]?token|refresh[-_]?token|secret|password|private[-_]?key|client[-_]?secret|bearer)$/i

const REDACTED = '[redacted]'

function stringBytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeJsonValue(value: unknown, seen: WeakSet<object>): Jsonish {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : { $type: 'number', value: String(value) }
  if (typeof value === 'bigint') return { $type: 'bigint', value: value.toString() }
  if (typeof value === 'undefined') return { $type: 'undefined' }
  if (typeof value === 'symbol') return { $type: 'symbol', value: String(value.description ?? '') }
  if (typeof value === 'function') return { $type: 'function' }
  if (value instanceof Date)
    return { $type: 'date', value: Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString() }
  if (value instanceof URL) return { $type: 'url', host: value.host, path: value.pathname }
  if (Array.isArray(value)) {
    if (seen.has(value)) return { $type: 'circular' }
    seen.add(value)
    const out = value.map((item) => normalizeJsonValue(item, seen))
    seen.delete(value)
    return out
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return { $type: 'circular' }
    seen.add(value)
    const record = value as Record<string, unknown>
    const out: Record<string, Jsonish> = {}
    for (const key of Object.keys(record).sort()) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : normalizeJsonValue(record[key], seen)
    }
    seen.delete(value)
    return out
  }
  return { $type: typeof value, value: String(value) }
}

export function canonicalProviderJson(value: unknown): string {
  return JSON.stringify(normalizeJsonValue(value, new WeakSet<object>()))
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function endpointMetricFields(url: string): { endpointHost: string; endpointPath: string } {
  try {
    const parsed = new URL(url)
    return { endpointHost: parsed.host, endpointPath: parsed.pathname }
  } catch {
    return { endpointHost: 'invalid-url', endpointPath: '' }
  }
}

export function providerBodyMetricFields(args: {
  provider: string
  stream: boolean
  url: string
  body: unknown
  bodyText: string
  requestModel?: string
}): Record<string, unknown> {
  const canonical = canonicalProviderJson(args.body)
  const requestModel =
    args.requestModel ?? (isPlainObject(args.body) && typeof args.body.model === 'string' ? args.body.model : undefined)
  return {
    provider: args.provider,
    stream: args.stream,
    ...endpointMetricFields(args.url),
    requestBodyBytes: stringBytes(args.bodyText),
    requestBodySha256: sha256Hex(canonical),
    ...(requestModel !== undefined ? { requestModel } : {}),
  }
}

function sortedCounts(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of Object.keys(counts).sort()) out[key] = counts[key]
  return out
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

const OPENAI_ROLE_BUCKETS = new Set(['user', 'assistant', 'system', 'tool', 'function', 'developer'])
const GEMINI_ROLE_BUCKETS = new Set(['user', 'model'])

function roleBucket(role: unknown, allowlist: ReadonlySet<string>): string {
  if (typeof role !== 'string' || role.length === 0) return 'unknown'
  return allowlist.has(role) ? role : 'other'
}

function hashUnknownList(values: unknown[]): string {
  return sha256Hex(canonicalProviderJson(values))
}

function textFromPart(part: unknown): string | null {
  if (typeof part === 'string') return part
  if (!isPlainObject(part)) return null
  for (const key of ['text', 'input_text', 'output_text']) {
    const value = part[key]
    if (typeof value === 'string') return value
  }
  return null
}

function openAIPartKind(part: unknown): 'text' | 'image' | 'audio' | 'media' | 'other' {
  if (typeof part === 'string') return 'text'
  if (!isPlainObject(part)) return 'other'
  const type = typeof part.type === 'string' ? part.type.toLowerCase() : ''
  if (textFromPart(part) !== null || type === 'text' || type === 'input_text' || type === 'output_text') return 'text'
  if (type.includes('image') || 'image_url' in part || 'input_image' in part) return 'image'
  if (type.includes('audio') || 'input_audio' in part || 'audio_url' in part) return 'audio'
  if (type.includes('video') || type.includes('file') || 'file' in part || 'file_id' in part) return 'media'
  return 'other'
}

function contentParts(content: unknown): unknown[] {
  if (content === undefined || content === null) return []
  return Array.isArray(content) ? content : [content]
}

export function summarizeOpenAIProviderBody(body: unknown): Record<string, unknown> {
  const messages = isPlainObject(body) && Array.isArray(body.messages) ? body.messages : []
  const roleCounts: Record<string, number> = {}
  const messageContents: unknown[] = []
  let systemMessageCount = 0
  let systemContentBytes = 0
  let messageContentBytes = 0
  let contentPartCount = 0
  let textPartCount = 0
  let imagePartCount = 0
  let audioPartCount = 0
  let mediaPartCount = 0

  for (const message of messages) {
    if (!isPlainObject(message)) {
      increment(roleCounts, 'unknown')
      continue
    }
    const role = roleBucket(message.role, OPENAI_ROLE_BUCKETS)
    increment(roleCounts, role)
    if (role === 'system') systemMessageCount += 1

    const content = message.content
    messageContents.push(content)
    for (const part of contentParts(content)) {
      contentPartCount += 1
      const text = textFromPart(part)
      if (text !== null) {
        const bytes = stringBytes(text)
        messageContentBytes += bytes
        if (role === 'system') systemContentBytes += bytes
      }
      const kind = openAIPartKind(part)
      if (kind === 'text') textPartCount += 1
      else if (kind === 'image') {
        imagePartCount += 1
        mediaPartCount += 1
      } else if (kind === 'audio') {
        audioPartCount += 1
        mediaPartCount += 1
      } else if (kind === 'media') {
        mediaPartCount += 1
      }
    }
  }

  const tools = isPlainObject(body) && Array.isArray(body.tools) ? body.tools : []
  const functions = isPlainObject(body) && Array.isArray(body.functions) ? body.functions : []
  const functionToolCount = tools.filter((tool) => isPlainObject(tool) && tool.type === 'function').length

  return {
    messageCount: messages.length,
    messageRoleCounts: sortedCounts(roleCounts),
    systemMessageCount,
    systemContentBytes,
    messageContentBytes,
    messageContentSha256: hashUnknownList(messageContents),
    contentPartCount,
    textPartCount,
    imagePartCount,
    audioPartCount,
    mediaPartCount,
    toolCount: tools.length,
    functionCount: functions.length + functionToolCount,
  }
}

function geminiPartMediaKind(part: unknown): 'image' | 'audio' | 'video' | null {
  if (!isPlainObject(part)) return null
  const data = isPlainObject(part.inlineData)
    ? part.inlineData
    : isPlainObject(part.inline_data)
      ? part.inline_data
      : isPlainObject(part.fileData)
        ? part.fileData
        : isPlainObject(part.file_data)
          ? part.file_data
          : null
  const mimeType =
    typeof data?.mimeType === 'string' ? data.mimeType : typeof data?.mime_type === 'string' ? data.mime_type : ''
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('video/')) return 'video'
  return null
}

function geminiParts(value: unknown): unknown[] {
  return isPlainObject(value) && Array.isArray(value.parts) ? value.parts : []
}

export function summarizeGeminiProviderBody(body: unknown): Record<string, unknown> {
  const contents = isPlainObject(body) && Array.isArray(body.contents) ? body.contents : []
  const roleCounts: Record<string, number> = {}
  const textParts: string[] = []
  let partCount = 0
  let inlineDataPartCount = 0
  let fileDataPartCount = 0
  let imagePartCount = 0
  let audioPartCount = 0
  let videoPartCount = 0

  for (const content of contents) {
    if (!isPlainObject(content)) {
      increment(roleCounts, 'unknown')
      continue
    }
    const role = roleBucket(content.role, GEMINI_ROLE_BUCKETS)
    increment(roleCounts, role)
    for (const part of geminiParts(content)) {
      partCount += 1
      if (isPlainObject(part) && typeof part.text === 'string') textParts.push(part.text)
      if (isPlainObject(part) && (isPlainObject(part.inlineData) || isPlainObject(part.inline_data))) {
        inlineDataPartCount += 1
      }
      if (isPlainObject(part) && (isPlainObject(part.fileData) || isPlainObject(part.file_data))) {
        fileDataPartCount += 1
      }
      const mediaKind = geminiPartMediaKind(part)
      if (mediaKind === 'image') imagePartCount += 1
      else if (mediaKind === 'audio') audioPartCount += 1
      else if (mediaKind === 'video') videoPartCount += 1
    }
  }

  const systemParts = isPlainObject(body) ? geminiParts(body.systemInstruction) : []
  const systemTexts = systemParts.flatMap((part) =>
    isPlainObject(part) && typeof part.text === 'string' ? [part.text] : [],
  )
  const generationConfig =
    isPlainObject(body) && isPlainObject(body.generationConfig) ? Object.keys(body.generationConfig) : []

  return {
    contentsCount: contents.length,
    contentRoleCounts: sortedCounts(roleCounts),
    partCount,
    textPartCount: textParts.length,
    textPartBytes: textParts.reduce((sum, text) => sum + stringBytes(text), 0),
    textPartSha256: hashUnknownList(textParts),
    systemInstructionCount: systemParts.length,
    systemInstructionBytes: systemTexts.reduce((sum, text) => sum + stringBytes(text), 0),
    systemInstructionSha256: hashUnknownList(systemTexts),
    inlineDataPartCount,
    fileDataPartCount,
    imagePartCount,
    audioPartCount,
    videoPartCount,
    toolCount: isPlainObject(body) && Array.isArray(body.tools) ? body.tools.length : 0,
    safetySettingCount: isPlainObject(body) && Array.isArray(body.safetySettings) ? body.safetySettings.length : 0,
    generationConfigKeyCount: generationConfig.length,
  }
}
