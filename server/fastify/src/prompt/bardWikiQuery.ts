import { createHash } from 'node:crypto'
import { normalizeBardWikiMatch } from '../bardWikiRepository.js'

export const BARDWIKI_MAX_QUERY_TERMS = 128
export const BARDWIKI_MAX_QUERY_CODE_POINTS = 65_536

export interface BardWikiQueryInput {
  currentInput: string
  recentMessages: readonly string[]
  recentMessageCount: number
}

export interface BardWikiQuery {
  normalizedText: string
  terms: readonly string[]
  queryHash: string
  recentMessagesUsed: number
  truncated: boolean
}

/** Build the immutable, provider-free lexical query used by prompt retrieval. */
export function buildBardWikiQuery(input: BardWikiQueryInput): BardWikiQuery {
  const recentMessageCount = Math.max(1, Math.min(50, Math.trunc(input.recentMessageCount)))
  const recentMessages = input.recentMessages.slice(-recentMessageCount)
  const source = [input.currentInput, ...recentMessages].join('\n')
  const bounded = takeCodePoints(source, BARDWIKI_MAX_QUERY_CODE_POINTS)
  const normalizedText = normalizeBardWikiMatch(bounded.value)
  const terms = [...new Set(normalizedText.match(/[\p{L}\p{M}\p{N}_]+/gu) ?? [])]
    .filter(Boolean)
    .slice(0, BARDWIKI_MAX_QUERY_TERMS)
    .sort(compareText)
  return {
    normalizedText,
    terms,
    queryHash: createHash('sha256').update(normalizedText, 'utf8').digest('hex'),
    recentMessagesUsed: recentMessages.length,
    truncated: bounded.truncated || terms.length === BARDWIKI_MAX_QUERY_TERMS,
  }
}

function takeCodePoints(value: string, limit: number): { value: string; truncated: boolean } {
  const codePoints = [...value]
  return codePoints.length <= limit
    ? { value, truncated: false }
    : { value: codePoints.slice(0, limit).join(''), truncated: true }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
