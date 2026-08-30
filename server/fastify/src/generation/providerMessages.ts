import { LLMFlags } from '../../../../src/ts/model/types'

export interface ProviderMessageMultimodal {
  type: 'image' | 'video' | 'audio' | 'signature'
  base64: string
}

export interface ProviderMessageInput {
  role: 'system' | 'user' | 'assistant' | 'function'
  content: string
  memo?: string
  name?: string
  removable?: boolean
  attr?: readonly string[]
  multimodals?: readonly ProviderMessageMultimodal[]
  thoughts?: readonly string[]
  cachePoint?: boolean
}

export interface WireChatMessage {
  role: string
  content: string | OpenAIContentPart[]
  name?: string
  prefix?: boolean
  reasoning_content?: string
}

export type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'auto' | 'low' | 'high' } }

type AnthropicContentPart =
  | { type: 'text'; text: string; cache_control?: { type: 'ephemeral'; ttl?: '1h' } }
  | {
      type: 'image'
      source: { type: 'base64'; media_type: string; data: string }
      cache_control?: { type: 'ephemeral'; ttl?: '1h' }
    }

export interface AnthropicWireMessage {
  role: 'user' | 'assistant'
  content: AnthropicContentPart[]
}

function normalizedContent(row: ProviderMessageInput, newOAIHandle: boolean): string {
  if (newOAIHandle && row.memo?.startsWith('NewChat')) return ''
  return typeof row.content === 'string' ? row.content : ''
}

function visionDetail(value: unknown): 'auto' | 'low' | 'high' {
  return value === 'low' || value === 'high' ? value : 'auto'
}

function imageParts(multimodals: readonly ProviderMessageMultimodal[] | undefined): ProviderMessageMultimodal[] {
  return (multimodals ?? []).filter((modal) => modal.type === 'image' && typeof modal.base64 === 'string')
}

/**
 * Construct a provider-safe text-only message projection. Every object is new,
 * so internal prompt metadata can never leak through JSON serialization.
 */
export function sanitizeTextMessages(
  messages: readonly ProviderMessageInput[],
  options: { newOAIHandle?: boolean; developerRole?: boolean } = {},
): WireChatMessage[] {
  const newOAIHandle = options.newOAIHandle !== false
  const out: WireChatMessage[] = []
  for (const row of messages) {
    const content = normalizedContent(row, newOAIHandle)
    if (newOAIHandle && content.length === 0) continue
    const role = options.developerRole && row.role === 'system' ? 'developer' : row.role
    const wire: WireChatMessage = { role, content }
    if (row.role === 'function' && typeof row.name === 'string' && row.name.length > 0) {
      wire.name = row.name
    } else if (newOAIHandle && row.name?.startsWith('example_')) {
      wire.name = row.name
    }
    out.push(wire)
  }
  return out
}

/** Provider-native OpenAI Chat Completions conversion. */
export function buildOpenAIWireMessages(
  messages: readonly ProviderMessageInput[],
  options: {
    flags?: readonly number[]
    newOAIHandle?: boolean
    visionQuality?: unknown
  } = {},
): WireChatMessage[] {
  const flags = options.flags ?? []
  const newOAIHandle = options.newOAIHandle !== false
  const out: WireChatMessage[] = []
  for (let index = 0; index < messages.length; index++) {
    const row = messages[index]
    const text = normalizedContent(row, newOAIHandle)
    const images = row.role === 'user' ? imageParts(row.multimodals) : []
    if (newOAIHandle && text.length === 0 && images.length === 0) continue

    const role = flags.includes(LLMFlags.DeveloperRole) && row.role === 'system' ? 'developer' : row.role
    const wire: WireChatMessage = {
      role,
      content:
        images.length > 0
          ? [
              ...images.map(
                (modal): OpenAIContentPart => ({
                  type: 'image_url',
                  image_url: { url: modal.base64, detail: visionDetail(options.visionQuality) },
                }),
              ),
              { type: 'text', text },
            ]
          : text,
    }
    if (row.role === 'function' && typeof row.name === 'string' && row.name.length > 0) {
      wire.name = row.name
    } else if (newOAIHandle && row.name?.startsWith('example_')) {
      wire.name = row.name
    }
    if (flags.includes(LLMFlags.deepSeekPrefix) && index === messages.length - 1 && row.role === 'assistant') {
      wire.prefix = true
    }
    if (
      flags.includes(LLMFlags.deepSeekThinkingInput) &&
      index === messages.length - 1 &&
      row.role === 'assistant' &&
      Array.isArray(row.thoughts) &&
      row.thoughts.length > 0
    ) {
      wire.reasoning_content = row.thoughts.join('\n')
    }
    out.push(wire)
  }
  return out
}

function parseDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/su.exec(dataUrl)
  if (!match) return null
  return { mediaType: match[1], data: match[2] }
}

function markAnthropicCache(part: AnthropicContentPart, oneHour: boolean): void {
  part.cache_control = oneHour ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' }
}

/** Provider-native Anthropic messages, including image and prompt-cache parts. */
export function buildAnthropicWireMessages(
  messages: readonly ProviderMessageInput[],
  options: { oneHourCache?: boolean; newOAIHandle?: boolean } = {},
): AnthropicWireMessage[] {
  const newOAIHandle = options.newOAIHandle !== false
  const out: AnthropicWireMessage[] = []
  for (const row of messages) {
    if (row.role !== 'user' && row.role !== 'assistant') continue
    const text = normalizedContent(row, newOAIHandle)
    const parts: AnthropicContentPart[] = []
    for (const image of imageParts(row.multimodals)) {
      const parsed = parseDataUrl(image.base64)
      if (!parsed) continue
      parts.push({
        type: 'image',
        source: { type: 'base64', media_type: parsed.mediaType, data: parsed.data },
      })
    }
    if (text.length > 0 || parts.length === 0) parts.push({ type: 'text', text })
    if (newOAIHandle && text.length === 0 && parts.length === 1 && parts[0].type === 'text') continue

    const previous = out.at(-1)
    if (previous?.role === row.role) {
      const previousLast = previous.content.at(-1)
      const first = parts[0]
      if (previousLast?.type === 'text' && first?.type === 'text') {
        previousLast.text += `\n\n${first.text}`
        parts.shift()
      }
      previous.content.push(...parts)
      if (row.cachePoint && previous.content.length > 0) {
        markAnthropicCache(previous.content[previous.content.length - 1], options.oneHourCache === true)
      }
      continue
    }

    if (row.cachePoint && parts.length > 0) {
      markAnthropicCache(parts[parts.length - 1], options.oneHourCache === true)
    }
    out.push({ role: row.role, content: parts })
  }
  return out
}
