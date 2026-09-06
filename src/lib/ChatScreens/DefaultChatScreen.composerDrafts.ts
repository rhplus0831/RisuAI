import {
  draftRecoveryScopesEqual,
  readDraftRecoveryScope,
  type DraftRecoveryScope,
} from 'src/ts/server/draftRecoveryScope'

export interface DefaultChatComposerDraft {
  messageInput: string
  messageInputTranslate: string
  fileInput: string[]
  draftText: string
  btwText: string
}

export interface DefaultChatComposerDraftGeneration extends DraftRecoveryScope {
  readonly transcriptIdentity: string
  readonly sequence: number
}

interface StoredDefaultChatComposerDraftRecord extends DraftRecoveryScope {
  version: 1
  surface: 'default-chat-composer'
  owner: { transcriptIdentity: string }
  baseline: null
  payload: DefaultChatComposerDraft
  sequence: number
  updatedAt: number
}

interface ComposerDraftCacheEntry {
  draft: DefaultChatComposerDraft
  generation: DefaultChatComposerDraftGeneration | null
  updatedAt: number
}

export const DEFAULT_CHAT_COMPOSER_DRAFT_LIMIT = 50
export const DEFAULT_CHAT_COMPOSER_DRAFT_MAX_RECORD_BYTES = 256 * 1024
export const DEFAULT_CHAT_COMPOSER_DRAFT_MAX_TOTAL_BYTES = 2 * 1024 * 1024
export const DEFAULT_CHAT_COMPOSER_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const COMPOSER_DRAFT_STORAGE_PREFIX = 'risu:recovery-draft:composer:v1:'
const MAX_TRANSCRIPT_IDENTITY_LENGTH = 2_048
const MAX_ASSET_IDS = 256
const MAX_ASSET_ID_LENGTH = 4_096

const composerDrafts = new Map<string, ComposerDraftCacheEntry>()
const storageFailureListeners = new Set<() => void>()
let hydratedScope: DraftRecoveryScope | null = null
let nextSequence = 0
let storageFailureReported = false

export function readDefaultChatComposerDraft(identity: string): DefaultChatComposerDraft | undefined {
  hydrateComposerDraftsForCurrentScope()
  const entry = composerDrafts.get(identity)
  if (!entry) return undefined

  // Refresh insertion order and the persisted timestamp so LRU recency survives
  // a page reload without serializing the whole cache on every keystroke.
  composerDrafts.delete(identity)
  entry.updatedAt = Date.now()
  if (entry.generation) {
    entry.generation =
      persistComposerDraft(identity, entry.draft, entry.updatedAt, entry.generation.sequence) ?? entry.generation
  }
  composerDrafts.set(identity, entry)
  return cloneComposerDraft(entry.draft)
}

export function writeDefaultChatComposerDraft(
  identity: string,
  draft: DefaultChatComposerDraft,
): DefaultChatComposerDraftGeneration | null {
  hydrateComposerDraftsForCurrentScope()
  const cloned = cloneComposerDraft(draft)
  const existing = composerDrafts.get(identity)
  if (existing?.generation && composerDraftsEqual(existing.draft, cloned)) {
    composerDrafts.delete(identity)
    composerDrafts.set(identity, existing)
    return { ...existing.generation }
  }
  const updatedAt = Date.now()
  const generation = persistComposerDraft(identity, cloned, updatedAt)

  composerDrafts.delete(identity)
  composerDrafts.set(identity, { draft: cloned, generation, updatedAt })
  evictComposerDraftsOverLimit()
  return generation
}

export function currentDefaultChatComposerDraftGeneration(identity: string): DefaultChatComposerDraftGeneration | null {
  hydrateComposerDraftsForCurrentScope()
  const generation = composerDrafts.get(identity)?.generation
  return generation ? { ...generation } : null
}

export function isDefaultChatComposerDraftGenerationCurrent(
  generation: DefaultChatComposerDraftGeneration | null,
): boolean {
  if (!generation) return false
  const current = currentDefaultChatComposerDraftGeneration(generation.transcriptIdentity)
  return current !== null && composerDraftGenerationsEqual(current, generation)
}

export function deleteDefaultChatComposerDraft(
  identity: string,
  expectedGeneration?: DefaultChatComposerDraftGeneration | null,
): boolean {
  hydrateComposerDraftsForCurrentScope()
  const entry = composerDrafts.get(identity)
  if (
    expectedGeneration &&
    (!entry?.generation || !composerDraftGenerationsEqual(entry.generation, expectedGeneration))
  ) {
    return false
  }

  composerDrafts.delete(identity)
  const scope = expectedGeneration ?? readDraftRecoveryScope()
  if (!scope) return true
  try {
    globalThis.sessionStorage?.removeItem(composerDraftStorageKey(scope, identity))
    return true
  } catch {
    reportComposerDraftStorageFailure()
    return false
  }
}

/** Explicit-discard/test helper: clears both memory and every composer record in this tab. */
export function clearDefaultChatComposerDrafts(): void {
  composerDrafts.clear()
  hydratedScope = null
  nextSequence = 0
  storageFailureReported = false
  removeAllComposerDraftStorageRecords()
}

/** Simulate a fresh JS runtime while retaining sessionStorage for reload tests. */
export function resetDefaultChatComposerDraftRuntimeForTests(): void {
  composerDrafts.clear()
  hydratedScope = null
  nextSequence = 0
  storageFailureReported = false
}

export function registerDefaultChatComposerDraftStorageFailureListener(listener: () => void): () => void {
  storageFailureListeners.add(listener)
  if (storageFailureReported) listener()
  return () => storageFailureListeners.delete(listener)
}

function hydrateComposerDraftsForCurrentScope(): void {
  const scope = readDraftRecoveryScope()
  if (!scope) {
    if (hydratedScope) composerDrafts.clear()
    hydratedScope = null
    return
  }
  if (hydratedScope && draftRecoveryScopesEqual(hydratedScope, scope)) return

  composerDrafts.clear()
  hydratedScope = scope
  nextSequence = 0
  const now = Date.now()
  const valid: Array<{ key: string; record: StoredDefaultChatComposerDraftRecord; bytes: number }> = []
  const storage = globalThis.sessionStorage
  if (!storage) return

  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index)
      if (!key?.startsWith(COMPOSER_DRAFT_STORAGE_PREFIX)) continue
      const serialized = storage.getItem(key)
      const record = parseStoredComposerDraftRecord(serialized)
      if (!record || now - record.updatedAt > DEFAULT_CHAT_COMPOSER_DRAFT_MAX_AGE_MS) {
        storage.removeItem(key)
        continue
      }
      if (record.databaseLineage !== scope.databaseLineage) {
        storage.removeItem(key)
        continue
      }
      const expectedKey = composerDraftStorageKey(record, record.owner.transcriptIdentity)
      const bytes = serializedByteLength(serialized ?? '')
      if (key !== expectedKey || bytes > DEFAULT_CHAT_COMPOSER_DRAFT_MAX_RECORD_BYTES) {
        storage.removeItem(key)
        continue
      }
      if (record.writerSessionId === scope.writerSessionId) {
        nextSequence = Math.max(nextSequence, record.sequence)
      }
      valid.push({ key, record, bytes })
    }

    valid.sort((left, right) =>
      left.record.updatedAt === right.record.updatedAt
        ? left.record.owner.transcriptIdentity.localeCompare(right.record.owner.transcriptIdentity)
        : left.record.updatedAt - right.record.updatedAt,
    )
    let totalBytes = valid.reduce((total, candidate) => total + candidate.bytes, 0)
    while (
      valid.length > DEFAULT_CHAT_COMPOSER_DRAFT_LIMIT ||
      totalBytes > DEFAULT_CHAT_COMPOSER_DRAFT_MAX_TOTAL_BYTES
    ) {
      const expired = valid.shift()
      if (!expired) break
      storage.removeItem(expired.key)
      totalBytes -= expired.bytes
    }
    for (const { record } of valid) {
      // A same-lineage draft owned by another writer stays dormant. This tab
      // must not import it, but writer loss alone is not a discard action.
      if (record.writerSessionId !== scope.writerSessionId) continue
      const identity = record.owner.transcriptIdentity
      composerDrafts.set(identity, {
        draft: cloneComposerDraft(record.payload),
        generation: generationFromRecord(record),
        updatedAt: record.updatedAt,
      })
    }
  } catch {
    reportComposerDraftStorageFailure()
  }
}

function persistComposerDraft(
  identity: string,
  draft: DefaultChatComposerDraft,
  updatedAt: number,
  existingSequence?: number,
): DefaultChatComposerDraftGeneration | null {
  const scope = readDraftRecoveryScope()
  if (!scope) return null
  if (!isValidTranscriptIdentity(identity) || !isValidComposerDraft(draft)) {
    reportComposerDraftStorageFailure()
    return null
  }

  const sequence = existingSequence ?? nextComposerDraftSequence()
  const record: StoredDefaultChatComposerDraftRecord = {
    version: 1,
    databaseLineage: scope.databaseLineage,
    writerSessionId: scope.writerSessionId,
    surface: 'default-chat-composer',
    owner: { transcriptIdentity: identity },
    baseline: null,
    payload: cloneComposerDraft(draft),
    sequence,
    updatedAt,
  }
  const serialized = JSON.stringify(record)
  if (serializedByteLength(serialized) > DEFAULT_CHAT_COMPOSER_DRAFT_MAX_RECORD_BYTES) {
    reportComposerDraftStorageFailure()
    return null
  }

  try {
    globalThis.sessionStorage?.setItem(composerDraftStorageKey(scope, identity), serialized)
    cleanupComposerDraftStorageCaps(scope)
    return generationFromRecord(record)
  } catch {
    reportComposerDraftStorageFailure()
    return null
  }
}

function cleanupComposerDraftStorageCaps(scope: DraftRecoveryScope): void {
  const storage = globalThis.sessionStorage
  if (!storage) return
  const now = Date.now()
  const records: Array<{ key: string; writerSessionId: string; updatedAt: number; identity: string; bytes: number }> =
    []
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index)
    if (!key?.startsWith(COMPOSER_DRAFT_STORAGE_PREFIX)) continue
    const serialized = storage.getItem(key)
    const record = parseStoredComposerDraftRecord(serialized)
    if (
      !record ||
      record.databaseLineage !== scope.databaseLineage ||
      now - record.updatedAt > DEFAULT_CHAT_COMPOSER_DRAFT_MAX_AGE_MS
    ) {
      storage.removeItem(key)
      continue
    }
    if (key !== composerDraftStorageKey(record, record.owner.transcriptIdentity)) {
      storage.removeItem(key)
      continue
    }
    records.push({
      key,
      writerSessionId: record.writerSessionId,
      updatedAt: record.updatedAt,
      identity: record.owner.transcriptIdentity,
      bytes: serializedByteLength(serialized ?? ''),
    })
  }
  records.sort((left, right) =>
    left.updatedAt === right.updatedAt ? left.identity.localeCompare(right.identity) : left.updatedAt - right.updatedAt,
  )
  let totalBytes = records.reduce((total, record) => total + record.bytes, 0)
  while (
    records.length > DEFAULT_CHAT_COMPOSER_DRAFT_LIMIT ||
    totalBytes > DEFAULT_CHAT_COMPOSER_DRAFT_MAX_TOTAL_BYTES
  ) {
    const oldest = records.shift()
    if (!oldest) break
    storage.removeItem(oldest.key)
    totalBytes -= oldest.bytes
    const cached = composerDrafts.get(oldest.identity)
    if (oldest.writerSessionId === scope.writerSessionId && cached && cached.updatedAt <= oldest.updatedAt) {
      composerDrafts.delete(oldest.identity)
    }
  }
}

function evictComposerDraftsOverLimit(): void {
  while (composerDrafts.size > DEFAULT_CHAT_COMPOSER_DRAFT_LIMIT) {
    const oldestIdentity = composerDrafts.keys().next().value
    if (oldestIdentity === undefined) break
    const generation = composerDrafts.get(oldestIdentity)?.generation
    deleteDefaultChatComposerDraft(oldestIdentity, generation)
  }
}

function parseStoredComposerDraftRecord(serialized: string | null): StoredDefaultChatComposerDraftRecord | null {
  if (!serialized || serializedByteLength(serialized) > DEFAULT_CHAT_COMPOSER_DRAFT_MAX_RECORD_BYTES) return null
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Partial<StoredDefaultChatComposerDraftRecord>
  if (
    record.version !== 1 ||
    record.surface !== 'default-chat-composer' ||
    record.baseline !== null ||
    typeof record.databaseLineage !== 'string' ||
    typeof record.writerSessionId !== 'string' ||
    !record.owner ||
    !isValidTranscriptIdentity(record.owner.transcriptIdentity) ||
    !Number.isSafeInteger(record.sequence) ||
    (record.sequence ?? 0) <= 0 ||
    typeof record.updatedAt !== 'number' ||
    !Number.isFinite(record.updatedAt) ||
    !isValidComposerDraft(record.payload)
  ) {
    return null
  }
  return record as StoredDefaultChatComposerDraftRecord
}

function isValidComposerDraft(value: unknown): value is DefaultChatComposerDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const draft = value as Partial<DefaultChatComposerDraft>
  return (
    typeof draft.messageInput === 'string' &&
    typeof draft.messageInputTranslate === 'string' &&
    typeof draft.draftText === 'string' &&
    typeof draft.btwText === 'string' &&
    Array.isArray(draft.fileInput) &&
    draft.fileInput.length <= MAX_ASSET_IDS &&
    draft.fileInput.every((assetId) => typeof assetId === 'string' && assetId.length <= MAX_ASSET_ID_LENGTH)
  )
}

function isValidTranscriptIdentity(identity: unknown): identity is string {
  return typeof identity === 'string' && identity.length > 0 && identity.length <= MAX_TRANSCRIPT_IDENTITY_LENGTH
}

function composerDraftStorageKey(scope: DraftRecoveryScope, identity: string): string {
  return `${COMPOSER_DRAFT_STORAGE_PREFIX}${encodeURIComponent(scope.databaseLineage)}:${encodeURIComponent(scope.writerSessionId)}:${encodeURIComponent(identity)}`
}

function generationFromRecord(record: StoredDefaultChatComposerDraftRecord): DefaultChatComposerDraftGeneration {
  return {
    databaseLineage: record.databaseLineage,
    writerSessionId: record.writerSessionId,
    transcriptIdentity: record.owner.transcriptIdentity,
    sequence: record.sequence,
  }
}

function composerDraftGenerationsEqual(
  left: DefaultChatComposerDraftGeneration,
  right: DefaultChatComposerDraftGeneration,
): boolean {
  return (
    left.databaseLineage === right.databaseLineage &&
    left.writerSessionId === right.writerSessionId &&
    left.transcriptIdentity === right.transcriptIdentity &&
    left.sequence === right.sequence
  )
}

function nextComposerDraftSequence(): number {
  if (nextSequence >= Number.MAX_SAFE_INTEGER) nextSequence = 0
  nextSequence += 1
  return nextSequence
}

function serializedByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function removeAllComposerDraftStorageRecords(): void {
  const storage = globalThis.sessionStorage
  if (!storage) return
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index)
      if (key?.startsWith(COMPOSER_DRAFT_STORAGE_PREFIX)) storage.removeItem(key)
    }
  } catch {
    reportComposerDraftStorageFailure()
  }
}

function reportComposerDraftStorageFailure(): void {
  if (storageFailureReported) return
  storageFailureReported = true
  for (const listener of storageFailureListeners) listener()
}

function cloneComposerDraft(draft: DefaultChatComposerDraft): DefaultChatComposerDraft {
  return {
    messageInput: draft.messageInput,
    messageInputTranslate: draft.messageInputTranslate,
    fileInput: [...draft.fileInput],
    draftText: draft.draftText,
    btwText: draft.btwText,
  }
}

function composerDraftsEqual(left: DefaultChatComposerDraft, right: DefaultChatComposerDraft): boolean {
  return (
    left.messageInput === right.messageInput &&
    left.messageInputTranslate === right.messageInputTranslate &&
    left.draftText === right.draftText &&
    left.btwText === right.btwText &&
    left.fileInput.length === right.fileInput.length &&
    left.fileInput.every((assetId, index) => assetId === right.fileInput[index])
  )
}
