import type { Chat } from '../../../../src/ts/storage/database.svelte'
import { compileBoundedRegex } from './boundedRegex.js'

const DEFAULT_REGEX_CACHE_LIMIT = 1_000

interface TranscriptEntry {
  raw: string
  lower?: string
  strictWords?: Set<string>
}

interface TranscriptBucket {
  generation: number
  entriesByDepth: Map<number, TranscriptEntry>
}

export interface TriggerRunCache {
  transcriptGeneration: number
  transcriptByMessages: WeakMap<Chat['message'], TranscriptBucket>
  regexes: Map<string, RegExp>
  regexLimit: number
}

export function createTriggerRunCache(opts: { regexLimit?: number } = {}): TriggerRunCache {
  return {
    transcriptGeneration: 0,
    transcriptByMessages: new WeakMap(),
    regexes: new Map(),
    regexLimit: opts.regexLimit ?? DEFAULT_REGEX_CACHE_LIMIT,
  }
}

export function invalidateTriggerTranscriptCache(cache: TriggerRunCache): void {
  cache.transcriptGeneration++
}

function getTranscriptEntry(cache: TriggerRunCache, chat: Chat, depth: number): TranscriptEntry {
  let bucket = cache.transcriptByMessages.get(chat.message)
  if (!bucket || bucket.generation !== cache.transcriptGeneration) {
    bucket = {
      generation: cache.transcriptGeneration,
      entriesByDepth: new Map(),
    }
    cache.transcriptByMessages.set(chat.message, bucket)
  }

  let entry = bucket.entriesByDepth.get(depth)
  if (!entry) {
    entry = {
      raw: chat.message
        .slice(0 - depth)
        .map((v) => v.data)
        .join(' '),
    }
    bucket.entriesByDepth.set(depth, entry)
  }
  return entry
}

export function getRecentTranscriptRaw(cache: TriggerRunCache, chat: Chat, depth: number): string {
  return getTranscriptEntry(cache, chat, depth).raw
}

export function getRecentTranscriptLower(cache: TriggerRunCache, chat: Chat, depth: number): string {
  const entry = getTranscriptEntry(cache, chat, depth)
  entry.lower ??= entry.raw.toLowerCase()
  return entry.lower
}

export function getRecentTranscriptStrictWords(cache: TriggerRunCache, chat: Chat, depth: number): Set<string> {
  const entry = getTranscriptEntry(cache, chat, depth)
  entry.strictWords ??= new Set(entry.raw.split(' '))
  return entry.strictWords
}

export function getCachedTriggerRegex(
  cache: TriggerRunCache,
  pattern: string,
  flags: string,
  context = 'trigger regex',
): RegExp {
  const key = `${flags}\u0000${pattern}`
  let regex = cache.regexes.get(key)
  if (!regex) {
    regex = compileBoundedRegex(pattern, flags, context)
    cache.regexes.set(key, regex)
    if (cache.regexes.size > cache.regexLimit) {
      const oldestKey = cache.regexes.keys().next().value
      if (oldestKey !== undefined) {
        cache.regexes.delete(oldestKey)
      }
    }
  }
  regex.lastIndex = 0
  return regex
}

export function getCachedRegexDelimiter(
  cache: TriggerRunCache,
  delimiter: string,
  context = 'trigger regex delimiter',
): RegExp {
  const regexMatch = delimiter.match(/^\/(.+)\/([gimuy]*)$/)
  if (regexMatch) {
    const [, pattern, flags] = regexMatch
    return getCachedTriggerRegex(cache, pattern, flags, context)
  }
  return getCachedTriggerRegex(cache, delimiter, '', context)
}
