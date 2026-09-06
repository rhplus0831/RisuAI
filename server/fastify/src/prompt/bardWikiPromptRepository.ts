import type { DatabaseSync } from 'node:sqlite'
import type { BardWikiContextPolicy, BardWikiDocumentKind } from '../bardWikiRepository.js'
import type { BardWikiQuery } from './bardWikiQuery.js'

export const BARDWIKI_MAX_PROMPT_CANDIDATES = 512
export const BARDWIKI_MAX_PROMPT_LINK_TARGETS_PER_HOP = 512
export const BARDWIKI_MAX_PROMPT_LINK_EDGES = 8_192

export interface BardWikiPromptDocument {
  id: string
  chatId: string
  kind: BardWikiDocumentKind
  title: string
  logicalPath: string
  normalizedPath: string
  aliases: readonly string[]
  contextPolicy: BardWikiContextPolicy
  markdown: string
  contentHash: string
  version: number
  titleTerms: string
  aliasTerms: string
  headingTerms: string
  bodyTerms: string
}

export interface BardWikiPromptLink {
  sourceDocumentId: string
  ordinal: number
  resolvedDocumentId: string | null
}

export interface BardWikiPromptSnapshot {
  chatId: string
  indexState: 'ready' | 'degraded'
  documents: readonly BardWikiPromptDocument[]
  directCandidateIds: readonly string[]
  links: readonly BardWikiPromptLink[]
  candidateLimitReached: boolean
  linkLimitReached: boolean
}

interface PromptDocumentRow {
  id: string
  chat_id: string
  kind: BardWikiDocumentKind
  title: string
  logical_path: string
  normalized_path: string
  aliases_json: string
  context_policy: BardWikiContextPolicy
  markdown: string
  content_hash: string
  version: number
  title_terms: string | null
  alias_terms: string | null
  heading_terms: string | null
  body_terms: string | null
}

interface ExactCandidateRow {
  id: string
  normalized_path: string
  title_terms: string
  alias_terms: string
}

interface LinkRow {
  source_document_id: string
  ordinal: number
  resolved_document_id: string | null
}

/**
 * Read only the target chat's committed prompt candidates and a bounded link
 * closure. Versions, receipts, jobs, sibling chats, and deleted/review rows are
 * never hydrated on this path.
 */
export function loadBardWikiPromptSnapshot(
  db: DatabaseSync,
  input: { chatId: string; query: BardWikiQuery; maxLinkHops: 0 | 1 | 2 },
): BardWikiPromptSnapshot {
  const mandatoryRows = selectDocuments(
    db,
    `d.chat_id = ? AND d.deleted_at IS NULL AND d.review_state = 'active'
       AND d.context_policy IN ('pinned', 'always')`,
    [input.chatId],
  )
  const mandatoryIds = mandatoryRows.map((row) => row.id)
  let indexState: BardWikiPromptSnapshot['indexState'] = 'ready'
  let candidateIds: string[] = []
  let candidateLimitReached = false

  try {
    const missing = db
      .prepare(
        `SELECT COUNT(*) AS count FROM bardwiki_documents AS d
         WHERE d.chat_id = ? AND d.deleted_at IS NULL AND d.review_state = 'active'
           AND d.context_policy = 'relevant'
           AND NOT EXISTS (
             SELECT 1 FROM bardwiki_document_search AS s WHERE s.document_id = d.id
           )`,
      )
      .get(input.chatId) as { count: number }
    if (missing.count > 0) indexState = 'degraded'
    candidateIds = selectRelevantCandidateIds(db, input.chatId, input.query)
    candidateLimitReached = candidateIds.length === BARDWIKI_MAX_PROMPT_CANDIDATES
  } catch {
    indexState = 'degraded'
    candidateIds = []
  }

  const directCandidateIds = unique([...mandatoryIds, ...candidateIds])
  const directRows = selectDocumentsByIds(db, input.chatId, directCandidateIds)
  const rowsById = new Map(directRows.map((row) => [row.id, row]))
  const links: BardWikiPromptLink[] = []
  let frontier = directCandidateIds
  let linkLimitReached = false

  for (let hop = 0; hop < input.maxLinkHops && frontier.length > 0; hop++) {
    const remainingEdges = BARDWIKI_MAX_PROMPT_LINK_EDGES - links.length
    if (remainingEdges <= 0) {
      linkLimitReached = true
      break
    }
    const hopLinks = selectCurrentLinks(db, input.chatId, frontier, remainingEdges)
    links.push(...hopLinks)
    if (hopLinks.length === remainingEdges) linkLimitReached = true
    const targetIds = unique(
      hopLinks.map((link) => link.resolvedDocumentId).filter((id): id is string => id !== null && !rowsById.has(id)),
    ).slice(0, BARDWIKI_MAX_PROMPT_LINK_TARGETS_PER_HOP)
    const targetRows = selectDocumentsByIds(db, input.chatId, targetIds)
    for (const row of targetRows) rowsById.set(row.id, row)
    frontier = targetRows.map((row) => row.id)
  }

  return {
    chatId: input.chatId,
    indexState,
    documents: [...rowsById.values()].map(mapPromptDocument),
    directCandidateIds,
    links,
    candidateLimitReached,
    linkLimitReached,
  }
}

function selectRelevantCandidateIds(db: DatabaseSync, chatId: string, query: BardWikiQuery): string[] {
  if (!query.normalizedText || query.terms.length === 0) return []
  const rows = db
    .prepare(
      `SELECT d.id, d.normalized_path, s.title_terms, s.alias_terms
       FROM bardwiki_documents AS d
       JOIN bardwiki_document_search AS s ON s.document_id = d.id
       WHERE d.chat_id = ? AND d.deleted_at IS NULL AND d.review_state = 'active'
         AND d.context_policy = 'relevant'
       ORDER BY d.normalized_path, d.id`,
    )
    .all(chatId) as unknown as ExactCandidateRow[]
  const exact = rows
    .flatMap((row) => {
      const exactTitle = containsPhrase(query.normalizedText, row.title_terms)
      const exactAlias = row.alias_terms.split('\n').some((alias) => containsPhrase(query.normalizedText, alias))
      if (!exactTitle && !exactAlias) return []
      return [{ row, score: exactTitle ? 0 : 1, matches: matchingTerms(row, query.terms) }]
    })
    .sort(
      (left, right) =>
        left.score - right.score ||
        right.matches - left.matches ||
        compareText(left.row.normalized_path, right.row.normalized_path) ||
        compareText(left.row.id, right.row.id),
    )
  const exactIds = exact.slice(0, BARDWIKI_MAX_PROMPT_CANDIDATES).map(({ row }) => row.id)
  const remaining = BARDWIKI_MAX_PROMPT_CANDIDATES - exactIds.length
  if (remaining <= 0) return exactIds

  const clauses: string[] = []
  const bindings: string[] = []
  for (const term of query.terms) {
    clauses.push(
      '(instr(s.title_terms, ?) > 0 OR instr(s.alias_terms, ?) > 0 OR instr(s.heading_terms, ?) > 0 OR instr(s.body_terms, ?) > 0)',
    )
    bindings.push(term, term, term, term)
  }
  const lexical = db
    .prepare(
      `SELECT d.id
       FROM bardwiki_documents AS d
       JOIN bardwiki_document_search AS s ON s.document_id = d.id
       WHERE d.chat_id = ? AND d.deleted_at IS NULL AND d.review_state = 'active'
         AND d.context_policy = 'relevant' AND (${clauses.join(' OR ')})
       ORDER BY d.normalized_path, d.id LIMIT ?`,
    )
    .all(chatId, ...bindings, BARDWIKI_MAX_PROMPT_CANDIDATES + exactIds.length) as unknown as Array<{ id: string }>
  return unique([...exactIds, ...lexical.map(({ id }) => id)]).slice(0, BARDWIKI_MAX_PROMPT_CANDIDATES)
}

function selectDocuments(db: DatabaseSync, where: string, bindings: readonly (string | number)[]): PromptDocumentRow[] {
  return db
    .prepare(
      `SELECT d.id, d.chat_id, d.kind, d.title, d.logical_path, d.normalized_path,
              d.aliases_json, d.context_policy, d.markdown, d.content_hash, d.version,
              s.title_terms, s.alias_terms, s.heading_terms, s.body_terms
       FROM bardwiki_documents AS d
       LEFT JOIN bardwiki_document_search AS s ON s.document_id = d.id
       WHERE ${where}
       ORDER BY CASE d.context_policy WHEN 'pinned' THEN 0 WHEN 'always' THEN 1 ELSE 2 END,
                d.normalized_path, d.id`,
    )
    .all(...bindings) as unknown as PromptDocumentRow[]
}

function selectDocumentsByIds(db: DatabaseSync, chatId: string, ids: readonly string[]): PromptDocumentRow[] {
  const rows: PromptDocumentRow[] = []
  for (const chunk of chunks(ids, 400)) {
    if (chunk.length === 0) continue
    rows.push(
      ...selectDocuments(
        db,
        `d.chat_id = ? AND d.deleted_at IS NULL AND d.review_state = 'active'
         AND d.context_policy <> 'never' AND d.id IN (${chunk.map(() => '?').join(', ')})`,
        [chatId, ...chunk],
      ),
    )
  }
  const byId = new Map(rows.map((row) => [row.id, row]))
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id) as PromptDocumentRow] : []))
}

function selectCurrentLinks(
  db: DatabaseSync,
  chatId: string,
  sourceIds: readonly string[],
  limit: number,
): BardWikiPromptLink[] {
  const rows: LinkRow[] = []
  for (const chunk of chunks(sourceIds, 400)) {
    if (chunk.length === 0 || rows.length >= limit) break
    rows.push(
      ...(db
        .prepare(
          `SELECT l.source_document_id, l.ordinal, l.resolved_document_id
           FROM bardwiki_links AS l
           JOIN bardwiki_documents AS d
             ON d.id = l.source_document_id AND d.version = l.source_version
           WHERE d.chat_id = ? AND d.deleted_at IS NULL
             AND l.source_document_id IN (${chunk.map(() => '?').join(', ')})
           ORDER BY d.normalized_path, d.id, l.ordinal LIMIT ?`,
        )
        .all(chatId, ...chunk, limit - rows.length) as unknown as LinkRow[]),
    )
  }
  return rows.map((row) => ({
    sourceDocumentId: row.source_document_id,
    ordinal: row.ordinal,
    resolvedDocumentId: row.resolved_document_id,
  }))
}

function mapPromptDocument(row: PromptDocumentRow): BardWikiPromptDocument {
  return {
    id: row.id,
    chatId: row.chat_id,
    kind: row.kind,
    title: row.title,
    logicalPath: row.logical_path,
    normalizedPath: row.normalized_path,
    aliases: parseAliases(row.aliases_json),
    contextPolicy: row.context_policy,
    markdown: row.markdown,
    contentHash: row.content_hash,
    version: row.version,
    titleTerms: row.title_terms ?? '',
    aliasTerms: row.alias_terms ?? '',
    headingTerms: row.heading_terms ?? '',
    bodyTerms: row.body_terms ?? '',
  }
}

function parseAliases(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((alias): alias is string => typeof alias === 'string') : []
  } catch {
    return []
  }
}

function matchingTerms(row: ExactCandidateRow, terms: readonly string[]): number {
  const haystack = `${row.title_terms}\n${row.alias_terms}`
  return terms.reduce((count, term) => count + (haystack.includes(term) ? 1 : 0), 0)
}

function containsPhrase(text: string, phrase: string): boolean {
  if (!phrase) return false
  let start = text.indexOf(phrase)
  while (start >= 0) {
    const before = start === 0 ? '' : text[start - 1]
    const after = text[start + phrase.length] ?? ''
    if (!isLexical(before) && !isLexical(after)) return true
    start = text.indexOf(phrase, start + 1)
  }
  return false
}

function isLexical(value: string): boolean {
  return value !== '' && /[\p{L}\p{M}\p{N}_]/u.test(value)
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
