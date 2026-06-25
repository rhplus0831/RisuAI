import { createHash } from 'node:crypto'
import type { MultiModal, OpenAIChat } from '../../../../src/ts/process/index.svelte'

export interface PromptContentSummary {
  kind: string
  chars?: number
  bytes?: number
  sha256?: string
  canonicalJsonBytes?: number
  canonicalJsonSha256?: string
}

export interface PromptMultimodalSummary {
  type: MultiModal['type'] | string
  width?: number
  height?: number
  base64Bytes: number
  base64Sha256: string
}

export interface PromptRowSummary {
  index: number
  role: OpenAIChat['role'] | string
  content: PromptContentSummary
  nameBytes?: number
  nameSha256?: string
  memoBytes?: number
  memoSha256?: string
  removable?: boolean
  cachePoint?: boolean
  attrCount: number
  attrSha256?: string
  attrHashes?: string[]
  thoughtCount: number
  thoughtSha256?: string
  thoughtHashes?: string[]
  multimodalCount: number
  multimodals?: PromptMultimodalSummary[]
}

export interface PromptRowsSummary {
  version: 1
  promptHash: string
  rowCount: number
  roleSequence: string[]
  rows: PromptRowSummary[]
}

type JsonLike = null | boolean | number | string | JsonLike[] | { [key: string]: JsonLike }

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function stringBytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function contentKind(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function canonicalize(value: unknown): JsonLike {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return String(value)
  }
  if (Array.isArray(value)) return value.map((item) => canonicalize(item))
  const record = value as Record<string, unknown>
  const out: Record<string, JsonLike> = {}
  for (const key of Object.keys(record).sort()) {
    out[key] = canonicalize(record[key])
  }
  return out
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function summarizeContent(content: unknown): PromptContentSummary {
  if (typeof content === 'string') {
    return {
      kind: 'string',
      chars: content.length,
      bytes: stringBytes(content),
      sha256: sha256(content),
    }
  }
  const json = canonicalJson(content)
  return {
    kind: contentKind(content),
    canonicalJsonBytes: stringBytes(json),
    canonicalJsonSha256: sha256(json),
  }
}

function summarizeOptionalString(target: Record<string, unknown>, prefix: 'name' | 'memo', value: unknown): void {
  if (typeof value !== 'string') return
  target[`${prefix}Bytes`] = stringBytes(value)
  target[`${prefix}Sha256`] = sha256(value)
}

function summarizeStringArray(value: unknown): { count: number; hashes?: string[]; sha256?: string } {
  if (!Array.isArray(value) || value.length === 0) return { count: 0 }
  const hashes = value.map((item) => sha256(typeof item === 'string' ? item : canonicalJson(item)))
  return {
    count: value.length,
    hashes,
    sha256: sha256(JSON.stringify(hashes)),
  }
}

function summarizeMultimodals(value: unknown): { count: number; multimodals?: PromptMultimodalSummary[] } {
  if (!Array.isArray(value) || value.length === 0) return { count: 0 }
  const multimodals = value.map((item) => {
    const modal = item && typeof item === 'object' ? (item as Partial<MultiModal>) : {}
    const base64 = typeof modal.base64 === 'string' ? modal.base64 : ''
    const summary: PromptMultimodalSummary = {
      type: typeof modal.type === 'string' ? modal.type : 'unknown',
      base64Bytes: stringBytes(base64),
      base64Sha256: sha256(base64),
    }
    if (typeof modal.width === 'number') summary.width = modal.width
    if (typeof modal.height === 'number') summary.height = modal.height
    return summary
  })
  return { count: multimodals.length, multimodals }
}

export function summarizePromptRows(rows: readonly OpenAIChat[]): PromptRowsSummary {
  const canonicalRows = rows.map((row, index): PromptRowSummary => {
    const raw = row as OpenAIChat & Record<string, unknown>
    const attr = summarizeStringArray(raw.attr)
    const thoughts = summarizeStringArray(raw.thoughts)
    const multimodal = summarizeMultimodals(raw.multimodals)
    const summary: PromptRowSummary = {
      index,
      role: typeof raw.role === 'string' ? raw.role : 'unknown',
      content: summarizeContent(raw.content),
      attrCount: attr.count,
      thoughtCount: thoughts.count,
      multimodalCount: multimodal.count,
    }
    summarizeOptionalString(summary as unknown as Record<string, unknown>, 'name', raw.name)
    summarizeOptionalString(summary as unknown as Record<string, unknown>, 'memo', raw.memo)
    if (raw.removable === true || raw.removable === false) summary.removable = raw.removable
    if (raw.cachePoint === true || raw.cachePoint === false) summary.cachePoint = raw.cachePoint
    if (attr.hashes) summary.attrHashes = attr.hashes
    if (attr.sha256) summary.attrSha256 = attr.sha256
    if (thoughts.hashes) summary.thoughtHashes = thoughts.hashes
    if (thoughts.sha256) summary.thoughtSha256 = thoughts.sha256
    if (multimodal.multimodals) summary.multimodals = multimodal.multimodals
    return summary
  })
  const promptHash = sha256(JSON.stringify({ version: 1, rows: canonicalRows }))
  return {
    version: 1,
    promptHash,
    rowCount: canonicalRows.length,
    roleSequence: canonicalRows.map((row) => row.role),
    rows: canonicalRows,
  }
}

export function hashPromptRows(rows: readonly OpenAIChat[]): string {
  return summarizePromptRows(rows).promptHash
}

export function promptSummaryMetricFields(
  summary: PromptRowsSummary | undefined,
  prefix = 'prompt',
): Record<string, unknown> {
  if (!summary) return {}
  const rowContentBytes = summary.rows.reduce(
    (sum, row) => sum + (row.content.bytes ?? row.content.canonicalJsonBytes ?? 0),
    0,
  )
  const rowContentChars = summary.rows.reduce((sum, row) => sum + (row.content.chars ?? 0), 0)
  const multimodalCount = summary.rows.reduce((sum, row) => sum + row.multimodalCount, 0)
  const multimodalBase64Bytes = summary.rows.reduce(
    (sum, row) => sum + (row.multimodals ?? []).reduce((inner, modal) => inner + modal.base64Bytes, 0),
    0,
  )
  return {
    [`${prefix}Hash`]: summary.promptHash,
    [`${prefix}RowCount`]: summary.rowCount,
    [`${prefix}RoleSequence`]: summary.roleSequence.join(','),
    [`${prefix}Rows`]: summary.rows,
    [`${prefix}ContentBytes`]: rowContentBytes,
    [`${prefix}ContentChars`]: rowContentChars,
    [`${prefix}MultimodalCount`]: multimodalCount,
    [`${prefix}MultimodalBase64Bytes`]: multimodalBase64Bytes,
  }
}
