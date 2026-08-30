import type { DatabaseSync } from 'node:sqlite'
import {
  resolveModelProfile,
  resolveModelProfileByProfileId,
  type ResolvedModelProfile,
} from '@risuai/shared-core/model-profile-resolver'
import type { BardWikiGlobalSettings } from '@risuai/protocol'
import {
  normalizeBardWikiAliases,
  normalizeBardWikiPath,
  normalizeBardWikiTitle,
  requireBardWikiMarkdown,
} from './bardWikiRepository.js'
import type { BardWikiSourcePair } from './bardWikiReceipts.js'
import type { BardWikiChatRow, BardWikiGenerationDatabase } from './bardWikiTypes.js'
import { dispatchChatProvider } from './prompt/chatDispatch.js'
import { createMemoryProviderAbortScope, throwIfMemoryProviderAborted } from './memoryProviderDeadline.js'

export const BARDWIKI_EVENT_MODEL_OUTPUT_MAX_BYTES = 64 * 1024
export const BARDWIKI_EVENT_MODEL_MAX_TOKENS = 4_096

export interface BardWikiEventDraft {
  title: string
  logicalPath: string
  aliases: string[]
  markdown: string
}

export interface BardWikiEventAnalysisRequest {
  db: DatabaseSync
  database: BardWikiGenerationDatabase
  settings: BardWikiGlobalSettings
  source: BardWikiSourcePair
  jobId: string
  receiptId: string
  promptVersion: string
  repair?: {
    originalOutput: string
    validationErrors: readonly string[]
  }
  signal?: AbortSignal
  providerFetchDeadlineMs?: number
}

export type BardWikiEventAnalyzer = (request: BardWikiEventAnalysisRequest) => Promise<string>

const EVENT_DRAFT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    title: { type: 'string' },
    logicalPath: { type: 'string' },
    aliases: { type: 'array', items: { type: 'string' }, maxItems: 32 },
    markdown: { type: 'string' },
  },
  required: ['title', 'logicalPath', 'aliases', 'markdown'],
  additionalProperties: false,
})

export async function analyzeBardWikiEvent(request: BardWikiEventAnalysisRequest): Promise<string> {
  const profile = resolveBardWikiEventProfile(request.database, request.settings.modelProfileId)
  if (!profile) throw new Error('Configured BardWiki model profile is unavailable')
  const abortScope = createMemoryProviderAbortScope(request.signal, request.providerFetchDeadlineMs)
  try {
    throwIfMemoryProviderAborted(abortScope.signal)
    const frames = await dispatchChatProvider({
      database: request.database,
      formated: buildBardWikiEventMessages(request),
      outputTokens: BARDWIKI_EVENT_MODEL_MAX_TOKENS,
      profile,
      signal: abortScope.signal,
      schema: EVENT_DRAFT_SCHEMA,
      history: {
        db: request.db,
        source: request.repair ? 'bardwiki-event-repair' : 'bardwiki-event-analysis',
        context: { chatId: request.source.chatId },
        metadata: {
          bardWikiJobId: request.jobId,
          bardWikiReceiptId: request.receiptId,
          promptVersion: request.promptVersion,
          repairAttempt: request.repair ? 1 : 0,
        },
      },
    })
    let output = ''
    for await (const frame of frames) {
      if (frame.kind === 'token') {
        output += frame.content
        if (Buffer.byteLength(output, 'utf8') > BARDWIKI_EVENT_MODEL_OUTPUT_MAX_BYTES) {
          return truncateUtf8(output, BARDWIKI_EVENT_MODEL_OUTPUT_MAX_BYTES + 1)
        }
      } else if (frame.kind === 'error') {
        throw new Error(frame.error || 'BardWiki event-analysis provider failed')
      }
    }
    return output
  } finally {
    abortScope.dispose()
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  let result = ''
  let bytes = 0
  for (const codePoint of value) {
    const width = Buffer.byteLength(codePoint, 'utf8')
    if (bytes + width > maxBytes) break
    result += codePoint
    bytes += width
  }
  return result
}

export function validateBardWikiEventDraft(output: string): BardWikiEventDraft {
  if (Buffer.byteLength(output, 'utf8') > BARDWIKI_EVENT_MODEL_OUTPUT_MAX_BYTES) {
    throw new Error('output exceeds 64 KiB')
  }
  const parsed = parseStrictJsonObject(stripJsonFence(output))
  const keys = Object.keys(parsed)
  const expected = ['aliases', 'logicalPath', 'markdown', 'title']
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new Error(`fields must be exactly: ${expected.join(', ')}`)
  }
  if (!Array.isArray(parsed.aliases) || !parsed.aliases.every((alias) => typeof alias === 'string')) {
    throw new Error('aliases must be an array of strings')
  }
  if (
    typeof parsed.title !== 'string' ||
    typeof parsed.logicalPath !== 'string' ||
    typeof parsed.markdown !== 'string'
  ) {
    throw new Error('title, logicalPath, and markdown must be strings')
  }
  const title = normalizeBardWikiTitle(parsed.title)
  const logicalPath = normalizeBardWikiPath(parsed.logicalPath).logicalPath
  const aliases = normalizeBardWikiAliases(parsed.aliases)
  const markdown = requireBardWikiMarkdown(parsed.markdown)
  return { title, logicalPath, aliases, markdown }
}

function resolveBardWikiEventProfile(
  database: BardWikiGenerationDatabase,
  profileId: string | null,
): ResolvedModelProfile | null {
  return profileId
    ? resolveModelProfileByProfileId({ database, role: 'memory', profileId })
    : resolveModelProfile({ database, role: 'memory' })
}

function buildBardWikiEventMessages(request: BardWikiEventAnalysisRequest): BardWikiChatRow[] {
  const system = request.repair
    ? [
        'Repair the invalid BardWiki event draft. Return one JSON object only.',
        'Keep facts grounded exclusively in the supplied user/assistant source pair.',
        `Validation errors: ${JSON.stringify(request.repair.validationErrors)}`,
        `Invalid output: ${JSON.stringify(request.repair.originalOutput)}`,
      ].join('\n')
    : [
        'Create one factual BardWiki event note from the exact source pair.',
        'Return one JSON object only with title, logicalPath, aliases, and markdown.',
        'Do not invent facts, ids, provenance, review state, context policy, or another chat/source.',
        'Use concise Markdown and a relative logical path appropriate for an event.',
      ].join('\n')
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: JSON.stringify({
        user: request.source.userContent,
        assistant: request.source.assistantContent,
      }),
    },
  ]
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim()
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed)
  return match ? match[1] : trimmed
}

function parseStrictJsonObject(value: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('output must be valid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('output must be a JSON object')
  }
  return parsed as Record<string, unknown>
}
