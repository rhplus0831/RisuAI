import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { BardWikiGlobalSettings } from '@risuai/protocol'
import {
  BardWikiValidationError,
  getBardWikiReceiptSummary,
  getBardWikiChatSettings,
  type BardWikiReceiptSummary,
} from './bardWikiRepository.js'
import { enqueueBardWikiJob, getBardWikiJob, type BardWikiJob } from './bardWikiJobs.js'
import { readBardWikiGlobalSettings, resolveEffectiveBardWikiSettings } from './bardWikiSettings.js'
import { loadSettingsFromSqlite } from './repository.js'

export const BARDWIKI_EVENT_PROMPT_VERSION = 'bardwiki-event-v1'

export interface ExplicitBardWikiConfirmationInput {
  chatId: string
  userMessageId: string
  userContentHash: string
  assistantMessageId: string
  assistantContentHash: string
}

export interface ExplicitBardWikiConfirmationResult {
  receipt: BardWikiReceiptSummary
  job: Omit<BardWikiJob, 'payload'>
  created: boolean
}

export interface BardWikiSourcePair {
  chatId: string
  userMessageId: string
  userContent: string
  userContentHash: string
  assistantMessageId: string
  assistantContent: string
  assistantContentHash: string
}

interface ActiveMessageRow {
  seq: number
  uid: string
  role: string
  data: string
  json: string
}

export function hashBardWikiMessageContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export function resolveExplicitBardWikiSourcePair(
  db: DatabaseSync,
  input: ExplicitBardWikiConfirmationInput,
): BardWikiSourcePair {
  if (!db.prepare('SELECT 1 FROM chats WHERE id = ?').get(input.chatId)) {
    throw new BardWikiValidationError('bardwiki_chat_not_found')
  }
  const rows = db
    .prepare(
      `SELECT seq, uid, role, data, json
       FROM messages
       WHERE chat_id = ? AND alternate = 0
       ORDER BY seq DESC`,
    )
    .all(input.chatId) as unknown as ActiveMessageRow[]
  const assistant = rows[0]
  const user = rows[1]
  if (
    !assistant ||
    !user ||
    isSelectionBoundary(assistant) ||
    isSelectionBoundary(user) ||
    assistant.role !== 'char' ||
    user.role !== 'user' ||
    assistant.uid !== input.assistantMessageId ||
    user.uid !== input.userMessageId
  ) {
    throw new BardWikiValidationError('bardwiki_source_not_active')
  }
  const userContentHash = hashBardWikiMessageContent(user.data)
  const assistantContentHash = hashBardWikiMessageContent(assistant.data)
  if (userContentHash !== input.userContentHash || assistantContentHash !== input.assistantContentHash) {
    throw new BardWikiValidationError('bardwiki_source_not_active')
  }
  return {
    chatId: input.chatId,
    userMessageId: user.uid,
    userContent: user.data,
    userContentHash,
    assistantMessageId: assistant.uid,
    assistantContent: assistant.data,
    assistantContentHash,
  }
}

export function createOrReuseExplicitBardWikiConfirmation(
  db: DatabaseSync,
  input: ExplicitBardWikiConfirmationInput,
): ExplicitBardWikiConfirmationResult {
  const source = resolveExplicitBardWikiSourcePair(db, input)
  const settings = resolveCurrentBardWikiSettings(db, input.chatId)
  if (!settings.enabledByDefault) throw new BardWikiValidationError('bardwiki_disabled')

  const existing = findExactReceipt(db, source)
  if (existing) {
    const existingJob = existing.jobId ? getBardWikiJob(db, existing.jobId) : null
    if (existingJob) return { receipt: existing, job: toJobSummary(existingJob), created: false }
    if (existing.state !== 'queued') {
      throw new BardWikiValidationError('bardwiki_confirmation_inconsistent')
    }
    const repairedJob = insertApplyTurnJob(db, existing.id, source, settings)
    linkReceiptJob(db, existing.id, repairedJob.id)
    return {
      receipt: requireReceipt(db, existing.id),
      job: toJobSummary(repairedJob),
      created: false,
    }
  }

  const receiptId = randomUUID()
  db.prepare(
    `INSERT INTO bardwiki_turn_receipts (
      id, chat_id, user_message_id, user_content_hash, assistant_message_id,
      assistant_content_hash, confirmation_mode, state, change_set_id
    ) VALUES (?, ?, ?, ?, ?, ?, 'explicit', 'queued', ?)`,
  ).run(
    receiptId,
    source.chatId,
    source.userMessageId,
    source.userContentHash,
    source.assistantMessageId,
    source.assistantContentHash,
    randomUUID(),
  )
  const job = insertApplyTurnJob(db, receiptId, source, settings)
  linkReceiptJob(db, receiptId, job.id)
  return {
    receipt: requireReceipt(db, receiptId),
    job: toJobSummary(job),
    created: true,
  }
}

function isSelectionBoundary(row: ActiveMessageRow): boolean {
  let message: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(row.json)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return true
    message = parsed as Record<string, unknown>
  } catch {
    return true
  }
  return message.disabled === true || message.disabled === 'allBefore' || message.isComment === true
}

function resolveCurrentBardWikiSettings(db: DatabaseSync, chatId: string): BardWikiGlobalSettings {
  const settings = loadSettingsFromSqlite(db)
  const global = readBardWikiGlobalSettings(
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? (settings as Record<string, unknown>).bardWiki
      : undefined,
  )
  return resolveEffectiveBardWikiSettings(global, getBardWikiChatSettings(db, chatId))
}

function findExactReceipt(db: DatabaseSync, source: BardWikiSourcePair): BardWikiReceiptSummary | null {
  const row = db
    .prepare(
      `SELECT id FROM bardwiki_turn_receipts
       WHERE chat_id = ? AND user_message_id = ? AND user_content_hash = ?
         AND assistant_message_id = ? AND assistant_content_hash = ?`,
    )
    .get(
      source.chatId,
      source.userMessageId,
      source.userContentHash,
      source.assistantMessageId,
      source.assistantContentHash,
    ) as { id: string } | undefined
  return row ? requireReceipt(db, row.id) : null
}

function requireReceipt(db: DatabaseSync, receiptId: string): BardWikiReceiptSummary {
  const receipt = getBardWikiReceiptSummary(db, receiptId)
  if (!receipt) throw new Error('BardWiki receipt disappeared during confirmation')
  return receipt
}

function insertApplyTurnJob(
  db: DatabaseSync,
  receiptId: string,
  source: BardWikiSourcePair,
  settings: BardWikiGlobalSettings,
): BardWikiJob {
  return enqueueBardWikiJob(db, {
    chatId: source.chatId,
    receiptId,
    kind: 'apply_turn',
    payload: {
      receiptId,
      expectedUserContentHash: source.userContentHash,
      expectedAssistantContentHash: source.assistantContentHash,
      modelProfileId: settings.modelProfileId,
      promptPresetId: settings.promptPresetId,
      promptVersion: BARDWIKI_EVENT_PROMPT_VERSION,
      canonicalEnabled: settings.canonicalUpdates,
      repairAttemptCount: 0,
    },
  })
}

function linkReceiptJob(db: DatabaseSync, receiptId: string, jobId: string): void {
  db.prepare(
    `UPDATE bardwiki_turn_receipts
     SET job_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND state = 'queued'`,
  ).run(jobId, receiptId)
}

function toJobSummary(job: BardWikiJob): Omit<BardWikiJob, 'payload'> {
  const { payload: _payload, ...summary } = job
  return summary
}
