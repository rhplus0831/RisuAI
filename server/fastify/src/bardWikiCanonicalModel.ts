import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  resolveModelProfile,
  resolveModelProfileByProfileId,
  type ResolvedModelProfile,
} from '@risuai/shared-core/model-profile-resolver'
import type { BardWikiGlobalSettings } from '@risuai/protocol'
import {
  listBardWikiDocuments,
  normalizeBardWikiAliases,
  normalizeBardWikiPath,
  normalizeBardWikiText,
  normalizeBardWikiTitle,
  requireBardWikiMarkdown,
  type BardWikiDocument,
  type BardWikiDocumentKind,
} from './bardWikiRepository.js'
import type { BardWikiEventDraft } from './bardWikiEventModel.js'
import type { BardWikiChatRow, BardWikiGenerationDatabase } from './bardWikiTypes.js'
import { dispatchChatProvider } from './prompt/chatDispatch.js'
import { createMemoryProviderAbortScope, throwIfMemoryProviderAborted } from './memoryProviderDeadline.js'

export const BARDWIKI_CANONICAL_MAX_OPERATIONS = 32
export const BARDWIKI_CANONICAL_MAX_SNAPSHOT_DOCUMENTS = 32
export const BARDWIKI_CANONICAL_MAX_SNAPSHOT_BYTES = 256 * 1024
export const BARDWIKI_CANONICAL_MODEL_OUTPUT_MAX_BYTES = 128 * 1024
export const BARDWIKI_CANONICAL_MODEL_MAX_TOKENS = 8_192

type CanonicalKind = Exclude<BardWikiDocumentKind, 'event'>

export interface BardWikiCanonicalSection {
  heading: string
  markdown: string
}

export type BardWikiCanonicalOperation =
  | {
      op: 'create'
      kind: CanonicalKind
      title: string
      logicalPath: string
      aliases: string[]
      sections: BardWikiCanonicalSection[]
    }
  | {
      op: 'upsert_h3'
      documentId: string
      baseVersion: number
      baseHash: string
      heading: string
      markdown: string
    }
  | {
      op: 'delete_h3'
      documentId: string
      baseVersion: number
      baseHash: string
      heading: string
    }

export interface BardWikiCanonicalDocumentSnapshot {
  id: string
  kind: CanonicalKind
  title: string
  logicalPath: string
  aliases: string[]
  version: number
  contentHash: string
  markdown: string
}

export type BardWikiStagedCanonicalChange =
  | {
      type: 'create'
      id: string
      kind: CanonicalKind
      title: string
      logicalPath: string
      aliases: string[]
      markdown: string
    }
  | {
      type: 'update'
      documentId: string
      beforeVersion: number
      beforeHash: string
      markdown: string
    }

export interface BardWikiCanonicalCompileRequest {
  db: DatabaseSync
  chatId: string
  database: BardWikiGenerationDatabase
  settings: BardWikiGlobalSettings
  eventDraft: BardWikiEventDraft
  documents: readonly BardWikiCanonicalDocumentSnapshot[]
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

export type BardWikiCanonicalCompiler = (request: BardWikiCanonicalCompileRequest) => Promise<string>

const CANONICAL_SCHEMA = JSON.stringify({
  type: 'array',
  maxItems: BARDWIKI_CANONICAL_MAX_OPERATIONS,
  items: {
    oneOf: [
      {
        type: 'object',
        properties: {
          op: { const: 'create' },
          kind: { enum: ['character', 'location', 'scene', 'faction', 'item', 'concept', 'other'] },
          title: { type: 'string' },
          logicalPath: { type: 'string' },
          aliases: { type: 'array', items: { type: 'string' }, maxItems: 32 },
          sections: {
            type: 'array',
            minItems: 1,
            maxItems: 32,
            items: {
              type: 'object',
              properties: { heading: { type: 'string' }, markdown: { type: 'string' } },
              required: ['heading', 'markdown'],
              additionalProperties: false,
            },
          },
        },
        required: ['op', 'kind', 'title', 'logicalPath', 'aliases', 'sections'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          op: { const: 'upsert_h3' },
          documentId: { type: 'string' },
          baseVersion: { type: 'integer', minimum: 1 },
          baseHash: { type: 'string' },
          heading: { type: 'string' },
          markdown: { type: 'string' },
        },
        required: ['op', 'documentId', 'baseVersion', 'baseHash', 'heading', 'markdown'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          op: { const: 'delete_h3' },
          documentId: { type: 'string' },
          baseVersion: { type: 'integer', minimum: 1 },
          baseHash: { type: 'string' },
          heading: { type: 'string' },
        },
        required: ['op', 'documentId', 'baseVersion', 'baseHash', 'heading'],
        additionalProperties: false,
      },
    ],
  },
})

export async function compileBardWikiCanonical(request: BardWikiCanonicalCompileRequest): Promise<string> {
  const profile = resolveCanonicalProfile(request.database, request.settings.modelProfileId)
  if (!profile) throw new Error('Configured BardWiki model profile is unavailable')
  const abortScope = createMemoryProviderAbortScope(request.signal, request.providerFetchDeadlineMs)
  try {
    throwIfMemoryProviderAborted(abortScope.signal)
    const frames = await dispatchChatProvider({
      database: request.database,
      formated: buildCanonicalMessages(request),
      outputTokens: BARDWIKI_CANONICAL_MODEL_MAX_TOKENS,
      profile,
      signal: abortScope.signal,
      schema: CANONICAL_SCHEMA,
      history: {
        db: request.db,
        source: request.repair ? 'bardwiki-canonical-repair' : 'bardwiki-canonical-compile',
        context: { chatId: request.chatId },
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
        if (Buffer.byteLength(output, 'utf8') > BARDWIKI_CANONICAL_MODEL_OUTPUT_MAX_BYTES) {
          return truncateUtf8(output, BARDWIKI_CANONICAL_MODEL_OUTPUT_MAX_BYTES + 1)
        }
      } else if (frame.kind === 'error') {
        throw new Error(frame.error || 'BardWiki canonical compiler provider failed')
      }
    }
    return output
  } finally {
    abortScope.dispose()
  }
}

export function snapshotBardWikiCanonicalDocuments(
  db: DatabaseSync,
  chatId: string,
): BardWikiCanonicalDocumentSnapshot[] {
  const result: BardWikiCanonicalDocumentSnapshot[] = []
  let bytes = 0
  for (const document of listBardWikiDocuments(db, chatId)) {
    if (document.kind === 'event' || document.reviewState !== 'active') continue
    const documentBytes = Buffer.byteLength(document.markdown, 'utf8')
    if (result.length >= BARDWIKI_CANONICAL_MAX_SNAPSHOT_DOCUMENTS) break
    if (bytes + documentBytes > BARDWIKI_CANONICAL_MAX_SNAPSHOT_BYTES) continue
    bytes += documentBytes
    result.push(snapshotDocument(document))
  }
  return result
}

export function validateBardWikiCanonicalOperations(
  output: string,
  snapshot: readonly BardWikiCanonicalDocumentSnapshot[],
): BardWikiCanonicalOperation[] {
  if (Buffer.byteLength(output, 'utf8') > BARDWIKI_CANONICAL_MODEL_OUTPUT_MAX_BYTES) {
    throw new Error('canonical output exceeds 128 KiB')
  }
  const parsed = parseJsonArray(stripJsonFence(output))
  if (parsed.length > BARDWIKI_CANONICAL_MAX_OPERATIONS) throw new Error('canonical output exceeds 32 operations')
  const documents = new Map(snapshot.map((document) => [document.id, document]))
  return parsed.map((value, index) => validateOperation(value, index, documents))
}

export function stageBardWikiCanonicalChanges(
  operations: readonly BardWikiCanonicalOperation[],
  snapshot: readonly BardWikiCanonicalDocumentSnapshot[],
): BardWikiStagedCanonicalChange[] {
  const source = new Map(snapshot.map((document) => [document.id, document]))
  const pendingUpdates = new Map<string, BardWikiStagedCanonicalChange & { type: 'update' }>()
  const creates: Array<BardWikiStagedCanonicalChange & { type: 'create' }> = []
  const livePaths = new Set(snapshot.map((document) => normalizeBardWikiPath(document.logicalPath).normalizedPath))

  for (const operation of operations) {
    if (operation.op === 'create') {
      const normalizedPath = normalizeBardWikiPath(operation.logicalPath)
      if (livePaths.has(normalizedPath.normalizedPath)) throw new Error('canonical create path already exists')
      livePaths.add(normalizedPath.normalizedPath)
      creates.push({
        type: 'create',
        id: randomUUID(),
        kind: operation.kind,
        title: operation.title,
        logicalPath: normalizedPath.logicalPath,
        aliases: operation.aliases,
        markdown: renderCanonicalSections(operation.sections),
      })
      continue
    }
    const document = source.get(operation.documentId)
    if (!document) throw new Error(`canonical document is not in the snapshot: ${operation.documentId}`)
    if (document.version !== operation.baseVersion || document.contentHash !== operation.baseHash) {
      throw new Error(`canonical base fence does not match: ${operation.documentId}`)
    }
    const current = pendingUpdates.get(document.id)?.markdown ?? document.markdown
    const markdown = applyCanonicalSectionOperation(current, operation)
    pendingUpdates.set(document.id, {
      type: 'update',
      documentId: document.id,
      beforeVersion: document.version,
      beforeHash: document.contentHash,
      markdown,
    })
  }
  return [...creates, ...pendingUpdates.values()]
}

function validateOperation(
  value: unknown,
  index: number,
  documents: ReadonlyMap<string, BardWikiCanonicalDocumentSnapshot>,
): BardWikiCanonicalOperation {
  const record = strictObject(value, `operation ${index}`)
  if (record.op === 'create') {
    exactKeys(record, ['aliases', 'kind', 'logicalPath', 'op', 'sections', 'title'], `operation ${index}`)
    if (!isCanonicalKind(record.kind)) throw new Error(`operation ${index} kind is invalid`)
    if (!Array.isArray(record.aliases) || !record.aliases.every((alias) => typeof alias === 'string')) {
      throw new Error(`operation ${index} aliases must be strings`)
    }
    if (!Array.isArray(record.sections) || record.sections.length < 1 || record.sections.length > 32) {
      throw new Error(`operation ${index} sections must contain 1-32 entries`)
    }
    if (typeof record.title !== 'string' || typeof record.logicalPath !== 'string') {
      throw new Error(`operation ${index} title and logicalPath must be strings`)
    }
    const seen = new Set<string>()
    const sections = record.sections.map((section, sectionIndex) => {
      const item = strictObject(section, `operation ${index} section ${sectionIndex}`)
      exactKeys(item, ['heading', 'markdown'], `operation ${index} section ${sectionIndex}`)
      if (typeof item.heading !== 'string' || typeof item.markdown !== 'string') {
        throw new Error(`operation ${index} section ${sectionIndex} fields must be strings`)
      }
      const heading = normalizeHeading(item.heading)
      if (seen.has(heading)) throw new Error(`operation ${index} has duplicate H3 heading: ${heading}`)
      seen.add(heading)
      const markdown = normalizeSectionBody(item.markdown)
      return { heading, markdown }
    })
    return {
      op: 'create',
      kind: record.kind,
      title: normalizeBardWikiTitle(record.title),
      logicalPath: normalizeBardWikiPath(record.logicalPath).logicalPath,
      aliases: normalizeBardWikiAliases(record.aliases),
      sections,
    }
  }
  if (record.op === 'upsert_h3' || record.op === 'delete_h3') {
    const expected =
      record.op === 'upsert_h3'
        ? ['baseHash', 'baseVersion', 'documentId', 'heading', 'markdown', 'op']
        : ['baseHash', 'baseVersion', 'documentId', 'heading', 'op']
    exactKeys(record, expected, `operation ${index}`)
    if (
      typeof record.documentId !== 'string' ||
      !Number.isSafeInteger(record.baseVersion) ||
      (record.baseVersion as number) < 1 ||
      typeof record.baseHash !== 'string' ||
      typeof record.heading !== 'string'
    ) {
      throw new Error(`operation ${index} has invalid section fence fields`)
    }
    const document = documents.get(record.documentId)
    if (!document) throw new Error(`operation ${index} targets an unknown canonical document`)
    if (document.version !== record.baseVersion || document.contentHash !== record.baseHash) {
      throw new Error(`operation ${index} base fence does not match its snapshot`)
    }
    const common = {
      documentId: record.documentId,
      baseVersion: record.baseVersion as number,
      baseHash: record.baseHash,
      heading: normalizeHeading(record.heading),
    }
    if (record.op === 'delete_h3') return { op: 'delete_h3', ...common }
    if (typeof record.markdown !== 'string') throw new Error(`operation ${index} markdown must be a string`)
    return { op: 'upsert_h3', ...common, markdown: normalizeSectionBody(record.markdown) }
  }
  throw new Error(`operation ${index} op is invalid`)
}

function renderCanonicalSections(sections: readonly BardWikiCanonicalSection[]): string {
  const markdown = sections.map((section) => `### ${section.heading}\n\n${section.markdown}`).join('\n\n')
  parseH3Sections(markdown)
  return requireBardWikiMarkdown(markdown)
}

function applyCanonicalSectionOperation(
  markdown: string,
  operation: Extract<BardWikiCanonicalOperation, { op: 'upsert_h3' | 'delete_h3' }>,
): string {
  const normalizedMarkdown = markdown.replace(/\r\n?/gu, '\n')
  const sections = parseH3Sections(normalizedMarkdown)
  const section = sections.find((entry) => entry.heading === operation.heading)
  if (operation.op === 'delete_h3') {
    if (!section) throw new Error(`H3 section does not exist: ${operation.heading}`)
    return requireBardWikiMarkdown(
      joinMarkdown(normalizedMarkdown.slice(0, section.start), normalizedMarkdown.slice(section.end)),
    )
  }
  const replacement = `### ${operation.heading}\n\n${operation.markdown}`
  const next = section
    ? joinMarkdown(
        joinMarkdown(normalizedMarkdown.slice(0, section.start), replacement),
        normalizedMarkdown.slice(section.end),
      )
    : joinMarkdown(normalizedMarkdown, replacement)
  parseH3Sections(next)
  return requireBardWikiMarkdown(next)
}

interface ParsedH3Section {
  heading: string
  start: number
  end: number
}

function parseH3Sections(markdown: string): ParsedH3Section[] {
  const lines = markdown.match(/.*(?:\n|$)/gu) ?? []
  const headings: Array<{ level: number; heading: string; start: number }> = []
  let offset = 0
  let fence: { marker: '`' | '~'; width: number } | null = null
  for (const lineWithNewline of lines) {
    const line = lineWithNewline.endsWith('\n') ? lineWithNewline.slice(0, -1) : lineWithNewline
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/u.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as '`' | '~'
      if (!fence) fence = { marker, width: fenceMatch[1].length }
      else if (fence.marker === marker && fenceMatch[1].length >= fence.width) fence = null
      offset += lineWithNewline.length
      continue
    }
    if (!fence) {
      const headingMatch = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/u.exec(line)
      if (headingMatch) {
        const level = headingMatch[1].length
        if (level <= 3) {
          headings.push({ level, heading: normalizeHeading(headingMatch[2]), start: offset })
        }
      }
    }
    offset += lineWithNewline.length
  }
  const sections: ParsedH3Section[] = []
  const seen = new Set<string>()
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]
    if (heading.level !== 3) continue
    if (seen.has(heading.heading)) throw new Error(`duplicate H3 heading: ${heading.heading}`)
    seen.add(heading.heading)
    const next = headings.slice(index + 1).find((candidate) => candidate.level <= 3)
    sections.push({ heading: heading.heading, start: heading.start, end: next?.start ?? markdown.length })
  }
  return sections
}

function normalizeHeading(value: string): string {
  return normalizeBardWikiTitle(value)
}

function normalizeSectionBody(value: string): string {
  const markdown = requireBardWikiMarkdown(value.replace(/\r\n?/gu, '\n').trim())
  if (markdown.length === 0) throw new Error('canonical section markdown must not be empty')
  const lines = markdown.match(/.*(?:\n|$)/gu) ?? []
  let fence: { marker: '`' | '~'; width: number } | null = null
  for (const lineWithNewline of lines) {
    const line = lineWithNewline.endsWith('\n') ? lineWithNewline.slice(0, -1) : lineWithNewline
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/u.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as '`' | '~'
      if (!fence) fence = { marker, width: fenceMatch[1].length }
      else if (fence.marker === marker && fenceMatch[1].length >= fence.width) fence = null
      continue
    }
    if (!fence && /^ {0,3}#{1,3}[ \t]+/u.test(line)) {
      throw new Error('canonical section markdown cannot contain H1-H3 headings')
    }
  }
  return markdown
}

function snapshotDocument(document: BardWikiDocument): BardWikiCanonicalDocumentSnapshot {
  return {
    id: document.id,
    kind: document.kind as CanonicalKind,
    title: document.title,
    logicalPath: document.logicalPath,
    aliases: document.aliases,
    version: document.version,
    contentHash: document.contentHash,
    markdown: document.markdown,
  }
}

function buildCanonicalMessages(request: BardWikiCanonicalCompileRequest): BardWikiChatRow[] {
  const system = request.repair
    ? [
        'Repair the invalid BardWiki canonical operation array. Return one JSON array only.',
        'Use only the supplied event and exact document snapshot fences.',
        `Validation errors: ${JSON.stringify(request.repair.validationErrors)}`,
        `Invalid output: ${JSON.stringify(request.repair.originalOutput)}`,
      ].join('\n')
    : [
        'Compile the event into zero or more bounded BardWiki canonical operations.',
        'Return one JSON array only. Use create, upsert_h3, or delete_h3 exactly as described by the schema.',
        'Existing documents may be changed only by exact H3 name with their supplied id, version, and hash.',
        'Do not replace whole existing documents, invent ids, or target event documents.',
      ].join('\n')
  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify({ event: request.eventDraft, documents: request.documents }) },
  ]
}

function resolveCanonicalProfile(
  database: BardWikiGenerationDatabase,
  profileId: string | null,
): ResolvedModelProfile | null {
  return profileId
    ? resolveModelProfileByProfileId({ database, role: 'memory', profileId })
    : resolveModelProfile({ database, role: 'memory' })
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim()
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed)
  return match ? match[1] : trimmed
}

function parseJsonArray(value: string): unknown[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('canonical output must be valid JSON')
  }
  if (!Array.isArray(parsed)) throw new Error('canonical output must be a JSON array')
  return parsed
}

function strictObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[], name: string): void {
  const keys = Object.keys(record)
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new Error(`${name} fields must be exactly: ${expected.join(', ')}`)
  }
}

function isCanonicalKind(value: unknown): value is CanonicalKind {
  return (
    value === 'character' ||
    value === 'location' ||
    value === 'scene' ||
    value === 'faction' ||
    value === 'item' ||
    value === 'concept' ||
    value === 'other'
  )
}

function joinMarkdown(left: string, right: string): string {
  return [left.trimEnd(), right.trimStart()].filter(Boolean).join('\n\n')
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
