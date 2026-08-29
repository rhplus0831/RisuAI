import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import * as fflate from 'fflate'
import {
  BARDWIKI_CONTEXT_POLICIES,
  BARDWIKI_DOCUMENT_KINDS,
  BARDWIKI_MAX_DOCUMENTS_PER_CHAT,
  BARDWIKI_REVIEW_STATES,
  BardWikiValidationError,
  createBardWikiDocument,
  getBardWikiDocument,
  hashBardWikiDocumentContent,
  listBardWikiDocuments,
  listBardWikiDocumentVersions,
  normalizeBardWikiAliases,
  normalizeBardWikiPath,
  normalizeBardWikiTitle,
  requireBardWikiMarkdown,
  updateBardWikiDocument,
  type BardWikiContextPolicy,
  type BardWikiDocument,
  type BardWikiDocumentKind,
  type BardWikiReviewState,
} from './bardWikiRepository.js'

export const BARDWIKI_VAULT_MAX_COMPRESSED_BYTES = 16 * 1024 * 1024
export const BARDWIKI_VAULT_MAX_EXPANDED_BYTES = 64 * 1024 * 1024
export const BARDWIKI_VAULT_MAX_DOCUMENTS = BARDWIKI_MAX_DOCUMENTS_PER_CHAT

const BARDWIKI_VAULT_FORMAT = 'risu-bardwiki-vault'
const BARDWIKI_VAULT_VERSION = 1
const BARDWIKI_VAULT_MANIFEST = 'manifest.json'
const BARDWIKI_VAULT_MAX_ENTRIES = BARDWIKI_VAULT_MAX_DOCUMENTS + 1
const ZIP_INPUT_CHUNK_BYTES = 4_096
const ZIP_EOCD_SIGNATURE = 0x06054b50
const ZIP_CENTRAL_SIGNATURE = 0x02014b50
const UTF8_FATAL = new TextDecoder('utf-8', { fatal: true })
const ZIP_EPOCH = new Date('1980-01-01T00:00:00.000Z')

export type BardWikiVaultConflictStrategy = 'skip' | 'rename' | 'replace'

export interface BardWikiVaultExpectedTarget {
  documentId: string
  version: number
  contentHash: string
}

export interface BardWikiVaultImportAction {
  sourceDocumentId: string
  targetDocumentId: string
  action: 'create' | 'replace' | 'noop' | 'skip'
  logicalPath: string
  conflict: 'id' | 'path' | 'id_and_path' | 'ambiguous' | null
}

export interface BardWikiVaultImportPlan {
  format: typeof BARDWIKI_VAULT_FORMAT
  version: typeof BARDWIKI_VAULT_VERSION
  strategy: BardWikiVaultConflictStrategy
  creates: number
  replacements: number
  noops: number
  skips: number
  renames: number
  applicable: boolean
  actions: BardWikiVaultImportAction[]
}

interface BardWikiVaultDocumentRecord {
  bardwikiId: string
  kind: BardWikiDocumentKind
  title: string
  logicalPath: string
  aliases: string[]
  contextPolicy: BardWikiContextPolicy
  reviewState: BardWikiReviewState
  version: number
  contentHash: string
  exportPath: string
  provenance?: { receiptId?: string; jobId?: string }
}

interface BardWikiVaultManifest {
  format: typeof BARDWIKI_VAULT_FORMAT
  version: typeof BARDWIKI_VAULT_VERSION
  documents: BardWikiVaultDocumentRecord[]
}

interface DecodedBardWikiVaultDocument extends Omit<BardWikiVaultDocumentRecord, 'provenance'> {
  markdown: string
}

export interface DecodedBardWikiVault {
  manifest: BardWikiVaultManifest
  documents: DecodedBardWikiVaultDocument[]
}

interface PlannedMutation {
  action: BardWikiVaultImportAction
  source: DecodedBardWikiVaultDocument
  target: BardWikiDocument | null
}

/** Build a byte-for-byte deterministic, Obsidian-compatible Markdown vault. */
export function encodeBardWikiVault(db: DatabaseSync, chatId: string): Uint8Array {
  const documents = listBardWikiDocuments(db, chatId)
  const exportPaths = allocateExportPaths(documents)
  const records = documents.map((document): BardWikiVaultDocumentRecord => {
    const version = listBardWikiDocumentVersions(db, document.id, 1)[0]
    const provenance = version
      ? {
          ...(version.receiptId ? { receiptId: version.receiptId } : {}),
          ...(version.jobId ? { jobId: version.jobId } : {}),
        }
      : undefined
    return {
      bardwikiId: document.id,
      kind: document.kind,
      title: document.title,
      logicalPath: document.logicalPath,
      aliases: document.aliases,
      contextPolicy: document.contextPolicy,
      reviewState: document.reviewState,
      version: document.version,
      contentHash: document.contentHash,
      exportPath: exportPaths.get(document.id) as string,
      ...(provenance && Object.keys(provenance).length > 0 ? { provenance } : {}),
    }
  })
  const manifest: BardWikiVaultManifest = {
    format: BARDWIKI_VAULT_FORMAT,
    version: BARDWIKI_VAULT_VERSION,
    documents: records,
  }
  const entries: fflate.Zippable = {}
  const encoder = new TextEncoder()
  for (const record of [...records].sort((a, b) => a.exportPath.localeCompare(b.exportPath, 'en'))) {
    const document = documents.find(({ id }) => id === record.bardwikiId) as BardWikiDocument
    const { exportPath: _exportPath, ...frontmatter } = record
    entries[record.exportPath] = encoder.encode(`---\n${JSON.stringify(frontmatter)}\n---\n${document.markdown}`)
  }
  entries[BARDWIKI_VAULT_MANIFEST] = encoder.encode(`${JSON.stringify(manifest)}\n`)
  const rawBytes = Object.values(entries).reduce((total, entry) => {
    if (!(entry instanceof Uint8Array)) throw new Error('Unexpected BardWiki vault entry shape')
    return total + entry.byteLength
  }, 0)
  if (rawBytes > BARDWIKI_VAULT_MAX_COMPRESSED_BYTES) {
    throw vaultError('bardwiki_limit_exceeded', 'BardWiki vault exceeds the archive-size limit')
  }
  const archive = fflate.zipSync(sortZippable(entries), { level: 0, mtime: ZIP_EPOCH })
  if (archive.byteLength > BARDWIKI_VAULT_MAX_COMPRESSED_BYTES) {
    throw vaultError('bardwiki_limit_exceeded', 'BardWiki vault exceeds the archive-size limit')
  }
  return archive
}

/** Decode and validate the entire archive before callers start a mutation. */
export function decodeBardWikiVault(archive: Uint8Array): DecodedBardWikiVault {
  if (archive.byteLength > BARDWIKI_VAULT_MAX_COMPRESSED_BYTES) {
    throw vaultError('bardwiki_limit_exceeded', 'BardWiki vault exceeds the compressed-size limit')
  }
  const centralEntries = inspectZipCentralDirectory(archive)
  const files = unzipBounded(archive)
  if (files.size !== centralEntries.length) throw vaultError('bardwiki_invalid_vault', 'Vault ZIP entry count mismatch')
  const manifestBytes = files.get(BARDWIKI_VAULT_MANIFEST)
  if (!manifestBytes) throw vaultError('bardwiki_invalid_vault', 'Vault manifest.json is missing')
  const manifest = readManifest(decodeUtf8(manifestBytes, BARDWIKI_VAULT_MANIFEST))
  if (manifest.documents.length > BARDWIKI_VAULT_MAX_DOCUMENTS) {
    throw vaultError('bardwiki_limit_exceeded', 'BardWiki vault document limit exceeded')
  }
  const declaredPaths = new Set<string>()
  const declaredIds = new Set<string>()
  const declaredLogicalPaths = new Set<string>()
  const documents = manifest.documents.map((record) => {
    if (declaredPaths.has(record.exportPath) || declaredIds.has(record.bardwikiId)) {
      throw vaultError('bardwiki_invalid_vault', 'Vault manifest contains duplicate document identities')
    }
    declaredPaths.add(record.exportPath)
    declaredIds.add(record.bardwikiId)
    const normalizedLogicalPath = normalizeBardWikiPath(record.logicalPath).normalizedPath
    if (declaredLogicalPaths.has(normalizedLogicalPath)) {
      throw vaultError('bardwiki_invalid_vault', 'Vault manifest contains duplicate logical paths')
    }
    declaredLogicalPaths.add(normalizedLogicalPath)
    const file = files.get(record.exportPath)
    if (!file) throw vaultError('bardwiki_invalid_vault', `Vault document is missing: ${record.exportPath}`)
    const { frontmatter, markdown } = decodeMarkdownFile(decodeUtf8(file, record.exportPath))
    const normalized = readDocumentRecord(
      { ...requireObject(frontmatter, 'frontmatter'), exportPath: record.exportPath },
      'frontmatter',
    )
    if (JSON.stringify(normalized) !== JSON.stringify(record)) {
      throw vaultError('bardwiki_invalid_vault', `Vault frontmatter does not match manifest: ${record.exportPath}`)
    }
    const normalizedMarkdown = requireBardWikiMarkdown(markdown)
    const actualHash = hashBardWikiDocumentContent({ ...normalized, markdown: normalizedMarkdown })
    if (actualHash !== record.contentHash) {
      throw vaultError('bardwiki_invalid_vault', `Vault document hash mismatch: ${record.exportPath}`)
    }
    return { ...record, markdown: normalizedMarkdown }
  })
  for (const name of files.keys()) {
    if (name !== BARDWIKI_VAULT_MANIFEST && !declaredPaths.has(name)) {
      throw vaultError('bardwiki_invalid_vault', `Vault contains an undeclared file: ${name}`)
    }
  }
  return { manifest, documents }
}

export function planBardWikiVaultImport(
  db: DatabaseSync,
  chatId: string,
  vault: DecodedBardWikiVault,
  strategy: BardWikiVaultConflictStrategy,
  expectedTargets: readonly BardWikiVaultExpectedTarget[] = [],
): BardWikiVaultImportPlan {
  return buildImportPlan(db, chatId, vault, strategy, expectedTargets).plan
}

export function applyBardWikiVaultImport(
  db: DatabaseSync,
  chatId: string,
  vault: DecodedBardWikiVault,
  strategy: BardWikiVaultConflictStrategy,
  expectedTargets: readonly BardWikiVaultExpectedTarget[],
  commandRevision: number,
): BardWikiVaultImportPlan {
  const built = buildImportPlan(db, chatId, vault, strategy, expectedTargets)
  if (!built.plan.applicable) throw vaultError('bardwiki_import_conflict', 'BardWiki vault has unresolved conflicts')
  for (const mutation of built.mutations) {
    if (mutation.action.action === 'create') {
      createBardWikiDocument(db, {
        id: mutation.action.targetDocumentId,
        chatId,
        ...pickWritableFields(mutation.source, mutation.action.logicalPath),
        actor: 'user',
        reason: 'import',
        commandRevision,
      })
    } else if (mutation.action.action === 'replace' && mutation.target) {
      updateBardWikiDocument(db, chatId, mutation.target.id, {
        expectedVersion: mutation.target.version,
        expectedContentHash: mutation.target.contentHash,
        ...pickWritableFields(mutation.source, mutation.action.logicalPath),
        actor: 'user',
        reason: 'import',
        commandRevision,
      })
    }
  }
  return built.plan
}

function buildImportPlan(
  db: DatabaseSync,
  chatId: string,
  vault: DecodedBardWikiVault,
  strategy: BardWikiVaultConflictStrategy,
  expectedTargets: readonly BardWikiVaultExpectedTarget[],
): { plan: BardWikiVaultImportPlan; mutations: PlannedMutation[] } {
  const allDocuments = listBardWikiDocuments(db, chatId, { includeDeleted: true })
  const liveDocuments = allDocuments.filter(({ deletedAt }) => deletedAt === null)
  const byId = new Map(allDocuments.map((document) => [document.id, document]))
  const byPath = new Map(liveDocuments.map((document) => [document.normalizedPath, document]))
  const foreignIds = new Set(
    (
      db.prepare('SELECT id FROM bardwiki_documents WHERE chat_id <> ? ORDER BY id').all(chatId) as Array<{
        id: string
      }>
    ).map(({ id }) => id),
  )
  const fences = new Map(expectedTargets.map((target) => [target.documentId, target]))
  const reservedIds = new Set(allDocuments.map(({ id }) => id))
  const reservedPaths = new Set(liveDocuments.map(({ normalizedPath }) => normalizedPath))
  const mutations: PlannedMutation[] = []
  let renames = 0
  let applicable = true

  for (const source of vault.documents) {
    const idTarget = byId.get(source.bardwikiId) ?? null
    const pathTarget = byPath.get(normalizeBardWikiPath(source.logicalPath).normalizedPath) ?? null
    if (foreignIds.has(source.bardwikiId)) {
      if (strategy === 'rename') {
        const renamed = allocateImportedIdentity(source, new Set([...reservedIds, ...foreignIds]), reservedPaths)
        reservedIds.add(renamed.id)
        reservedPaths.add(normalizeBardWikiPath(renamed.logicalPath).normalizedPath)
        renames += 1
        mutations.push({
          source,
          target: null,
          action: importAction(source, renamed.id, 'create', renamed.logicalPath, pathTarget ? 'ambiguous' : 'id'),
        })
      } else {
        if (strategy === 'replace') applicable = false
        mutations.push({
          source,
          target: pathTarget,
          action: importAction(source, pathTarget?.id ?? source.bardwikiId, 'skip', source.logicalPath, 'ambiguous'),
        })
      }
      continue
    }
    if (idTarget?.deletedAt === null && idTarget.contentHash === source.contentHash && pathTarget?.id === idTarget.id) {
      mutations.push({
        source,
        target: idTarget,
        action: importAction(source, idTarget.id, 'noop', source.logicalPath, null),
      })
      continue
    }
    if (!idTarget && !pathTarget) {
      reservedIds.add(source.bardwikiId)
      reservedPaths.add(normalizeBardWikiPath(source.logicalPath).normalizedPath)
      mutations.push({
        source,
        target: null,
        action: importAction(source, source.bardwikiId, 'create', source.logicalPath, null),
      })
      continue
    }
    const conflict = conflictKind(idTarget, pathTarget)
    if (strategy === 'skip') {
      mutations.push({
        source,
        target: idTarget ?? pathTarget,
        action: importAction(
          source,
          (idTarget ?? pathTarget)?.id ?? source.bardwikiId,
          'skip',
          source.logicalPath,
          conflict,
        ),
      })
      continue
    }
    if (strategy === 'rename') {
      const renamed = allocateImportedIdentity(source, reservedIds, reservedPaths)
      reservedIds.add(renamed.id)
      reservedPaths.add(normalizeBardWikiPath(renamed.logicalPath).normalizedPath)
      renames += 1
      mutations.push({
        source,
        target: null,
        action: importAction(source, renamed.id, 'create', renamed.logicalPath, conflict),
      })
      continue
    }
    const target = idTarget ?? pathTarget
    const unambiguous =
      target && (!idTarget || !pathTarget || idTarget.id === pathTarget.id) && target.deletedAt === null
    const fence = target ? fences.get(target.id) : undefined
    const fenceMatches =
      unambiguous &&
      fence?.version === target.version &&
      fence.contentHash === target.contentHash &&
      fence.documentId === target.id
    if (!target || !fenceMatches) applicable = false
    mutations.push({
      source,
      target: target ?? null,
      action: importAction(
        source,
        target?.id ?? source.bardwikiId,
        target && fenceMatches ? 'replace' : 'skip',
        source.logicalPath,
        unambiguous ? conflict : 'ambiguous',
      ),
    })
  }

  const actions = mutations.map(({ action }) => action)
  const creates = actions.filter(({ action }) => action === 'create').length
  if (liveDocuments.length + creates > BARDWIKI_MAX_DOCUMENTS_PER_CHAT) {
    throw vaultError('bardwiki_limit_exceeded', 'BardWiki document limit exceeded')
  }
  return {
    plan: {
      format: BARDWIKI_VAULT_FORMAT,
      version: BARDWIKI_VAULT_VERSION,
      strategy,
      creates,
      replacements: actions.filter(({ action }) => action === 'replace').length,
      noops: actions.filter(({ action }) => action === 'noop').length,
      skips: actions.filter(({ action }) => action === 'skip').length,
      renames,
      applicable,
      actions,
    },
    mutations,
  }
}

function pickWritableFields(source: DecodedBardWikiVaultDocument, logicalPath: string) {
  return {
    kind: source.kind,
    title: source.title,
    logicalPath,
    aliases: source.aliases,
    contextPolicy: source.contextPolicy,
    reviewState: source.reviewState,
    markdown: source.markdown,
  }
}

function importAction(
  source: DecodedBardWikiVaultDocument,
  targetDocumentId: string,
  action: BardWikiVaultImportAction['action'],
  logicalPath: string,
  conflict: BardWikiVaultImportAction['conflict'],
): BardWikiVaultImportAction {
  return { sourceDocumentId: source.bardwikiId, targetDocumentId, action, logicalPath, conflict }
}

function conflictKind(
  idTarget: BardWikiDocument | null,
  pathTarget: BardWikiDocument | null,
): BardWikiVaultImportAction['conflict'] {
  if (idTarget && pathTarget) return idTarget.id === pathTarget.id ? 'id_and_path' : 'ambiguous'
  return idTarget ? 'id' : 'path'
}

function allocateImportedIdentity(
  source: DecodedBardWikiVaultDocument,
  reservedIds: ReadonlySet<string>,
  reservedPaths: ReadonlySet<string>,
): { id: string; logicalPath: string } {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const suffix = createHash('sha256')
      .update(`${source.bardwikiId}\0${source.contentHash}\0${attempt}`)
      .digest('hex')
      .slice(0, 8)
    const id = `${source.bardwikiId.slice(0, 191)}~${suffix}`
    let logicalPath = withPathSuffix(source.logicalPath, suffix)
    try {
      normalizeBardWikiPath(logicalPath)
    } catch {
      logicalPath = `Imported/${suffix}`
    }
    if (!reservedIds.has(id) && !reservedPaths.has(normalizeBardWikiPath(logicalPath).normalizedPath)) {
      return { id, logicalPath }
    }
  }
  throw vaultError('bardwiki_import_conflict', 'Could not allocate a conflict-free BardWiki identity')
}

function allocateExportPaths(documents: readonly BardWikiDocument[]): Map<string, string> {
  const paths = new Map<string, string>()
  const used = new Set<string>()
  for (const document of documents) {
    const base = document.logicalPath.toLowerCase().endsWith('.md')
      ? document.logicalPath
      : `${document.logicalPath}.md`
    let candidate = base
    if (used.has(candidate.toLowerCase())) candidate = withPathSuffix(base, document.id.slice(0, 8))
    let attempt = 0
    while (used.has(candidate.toLowerCase())) {
      candidate = withPathSuffix(
        base,
        createHash('sha256').update(`${document.id}\0${attempt}`).digest('hex').slice(0, 8),
      )
      attempt += 1
    }
    assertSafeArchivePath(candidate)
    used.add(candidate.toLowerCase())
    paths.set(document.id, candidate)
  }
  return paths
}

function withPathSuffix(logicalPath: string, suffix: string): string {
  const slash = logicalPath.lastIndexOf('/')
  const directory = slash >= 0 ? logicalPath.slice(0, slash + 1) : ''
  const filename = slash >= 0 ? logicalPath.slice(slash + 1) : logicalPath
  const dot = filename.toLowerCase().endsWith('.md') ? filename.length - 3 : filename.length
  return `${directory}${filename.slice(0, dot)}~${suffix}${filename.slice(dot)}`
}

function sortZippable(entries: fflate.Zippable): fflate.Zippable {
  return Object.fromEntries(Object.entries(entries).sort(([left], [right]) => left.localeCompare(right, 'en')))
}

function inspectZipCentralDirectory(archive: Uint8Array): string[] {
  const buffer = Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength)
  let eocd = -1
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
      eocd = offset
      break
    }
  }
  if (eocd < 0 || eocd + 22 > buffer.length) throw vaultError('bardwiki_invalid_vault', 'Malformed vault ZIP')
  const disk = buffer.readUInt16LE(eocd + 4)
  const centralDisk = buffer.readUInt16LE(eocd + 6)
  const diskEntries = buffer.readUInt16LE(eocd + 8)
  const entryCount = buffer.readUInt16LE(eocd + 10)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  const commentLength = buffer.readUInt16LE(eocd + 20)
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== entryCount ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    entryCount > BARDWIKI_VAULT_MAX_ENTRIES ||
    eocd + 22 + commentLength !== buffer.length ||
    centralOffset + centralSize > eocd
  ) {
    throw vaultError('bardwiki_invalid_vault', 'Unsupported vault ZIP structure')
  }
  let offset = centralOffset
  let expandedBytes = 0
  const names: string[] = []
  const normalizedNames = new Set<string>()
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE) {
      throw vaultError('bardwiki_invalid_vault', 'Malformed vault ZIP directory')
    }
    const madeBy = buffer.readUInt16LE(offset + 4)
    const flags = buffer.readUInt16LE(offset + 8)
    const compression = buffer.readUInt16LE(offset + 10)
    const expanded = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const entryCommentLength = buffer.readUInt16LE(offset + 32)
    const externalAttributes = buffer.readUInt32LE(offset + 38)
    const end = offset + 46 + nameLength + extraLength + entryCommentLength
    if (end > buffer.length || (flags & 1) !== 0 || (compression !== 0 && compression !== 8)) {
      throw vaultError('bardwiki_invalid_vault', 'Unsupported vault ZIP entry')
    }
    const unixMode = (externalAttributes >>> 16) & 0xf000
    if (madeBy >>> 8 === 3 && unixMode === 0xa000) {
      throw vaultError('bardwiki_invalid_vault', 'Vault ZIP symlinks are not allowed')
    }
    const name = decodeUtf8(buffer.subarray(offset + 46, offset + 46 + nameLength), 'ZIP entry name')
    assertSafeArchivePath(name)
    const normalizedName = name.normalize('NFC').toLowerCase()
    if (normalizedNames.has(normalizedName)) throw vaultError('bardwiki_invalid_vault', 'Duplicate vault ZIP entry')
    normalizedNames.add(normalizedName)
    names.push(name)
    expandedBytes += expanded
    if (expandedBytes > BARDWIKI_VAULT_MAX_EXPANDED_BYTES) {
      throw vaultError('bardwiki_limit_exceeded', 'BardWiki vault exceeds the expanded-size limit')
    }
    offset = end
  }
  if (offset !== centralOffset + centralSize)
    throw vaultError('bardwiki_invalid_vault', 'Malformed vault ZIP directory')
  return names
}

function unzipBounded(archive: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  let totalExpanded = 0
  let failure: unknown
  const unzip = new fflate.Unzip()
  unzip.register(fflate.UnzipInflate)
  unzip.onfile = (file) => {
    const chunks: Uint8Array[] = []
    let size = 0
    file.ondata = (error, chunk, final) => {
      if (failure) return
      if (error) {
        failure = error
        return
      }
      if (chunk.length > 0) {
        totalExpanded += chunk.length
        size += chunk.length
        if (totalExpanded > BARDWIKI_VAULT_MAX_EXPANDED_BYTES) {
          failure = vaultError('bardwiki_limit_exceeded', 'BardWiki vault exceeds the expanded-size limit')
          return
        }
        chunks.push(chunk)
      }
      if (final) files.set(file.name, concatenate(chunks, size))
    }
    file.start()
  }
  try {
    for (let offset = 0; offset < archive.length && !failure; offset += ZIP_INPUT_CHUNK_BYTES) {
      unzip.push(archive.subarray(offset, Math.min(offset + ZIP_INPUT_CHUNK_BYTES, archive.length)), false)
    }
    if (!failure) unzip.push(new Uint8Array(0), true)
  } catch (error) {
    failure = error
  }
  if (failure) {
    if (failure instanceof BardWikiValidationError) throw failure
    throw vaultError('bardwiki_invalid_vault', 'Malformed vault ZIP')
  }
  return files
}

function concatenate(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function readManifest(text: string): BardWikiVaultManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw vaultError('bardwiki_invalid_vault', 'Vault manifest.json is not valid JSON')
  }
  const object = requireObject(parsed, 'manifest')
  if (
    object.format !== BARDWIKI_VAULT_FORMAT ||
    object.version !== BARDWIKI_VAULT_VERSION ||
    !Array.isArray(object.documents)
  ) {
    throw vaultError('bardwiki_invalid_vault', 'Unsupported BardWiki vault manifest')
  }
  rejectFields(object, ['format', 'version', 'documents'], 'manifest')
  return {
    format: BARDWIKI_VAULT_FORMAT,
    version: BARDWIKI_VAULT_VERSION,
    documents: object.documents.map((record) => readDocumentRecord(record, 'manifest document')),
  }
}

function readDocumentRecord(value: unknown, label: string): BardWikiVaultDocumentRecord {
  const object = requireObject(value, label)
  rejectFields(
    object,
    [
      'bardwikiId',
      'kind',
      'title',
      'logicalPath',
      'aliases',
      'contextPolicy',
      'reviewState',
      'version',
      'contentHash',
      'exportPath',
      'provenance',
    ],
    label,
  )
  const bardwikiId = readId(object.bardwikiId)
  if (!bardwikiId) throw vaultError('bardwiki_invalid_vault', `${label} has an invalid BardWiki id`)
  if (typeof object.kind !== 'string' || !BARDWIKI_DOCUMENT_KINDS.includes(object.kind as BardWikiDocumentKind)) {
    throw vaultError('bardwiki_invalid_vault', `${label} has an invalid kind`)
  }
  if (!Array.isArray(object.aliases) || !object.aliases.every((alias) => typeof alias === 'string')) {
    throw vaultError('bardwiki_invalid_vault', `${label} has invalid aliases`)
  }
  if (
    typeof object.contextPolicy !== 'string' ||
    !BARDWIKI_CONTEXT_POLICIES.includes(object.contextPolicy as BardWikiContextPolicy) ||
    typeof object.reviewState !== 'string' ||
    !BARDWIKI_REVIEW_STATES.includes(object.reviewState as BardWikiReviewState)
  ) {
    throw vaultError('bardwiki_invalid_vault', `${label} has invalid policy metadata`)
  }
  if (!Number.isSafeInteger(object.version) || (object.version as number) < 1) {
    throw vaultError('bardwiki_invalid_vault', `${label} has an invalid version`)
  }
  if (typeof object.contentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(object.contentHash)) {
    throw vaultError('bardwiki_invalid_vault', `${label} has an invalid content hash`)
  }
  if (typeof object.exportPath !== 'string') throw vaultError('bardwiki_invalid_vault', `${label} has no export path`)
  assertSafeArchivePath(object.exportPath)
  if (!object.exportPath.toLowerCase().endsWith('.md')) {
    throw vaultError('bardwiki_invalid_vault', `${label} export path must be Markdown`)
  }
  const provenance = readProvenance(object.provenance)
  return {
    bardwikiId,
    kind: object.kind as BardWikiDocumentKind,
    title: normalizeBardWikiTitle(object.title as string),
    logicalPath: normalizeBardWikiPath(object.logicalPath as string).logicalPath,
    aliases: normalizeBardWikiAliases(object.aliases),
    contextPolicy: object.contextPolicy as BardWikiContextPolicy,
    reviewState: object.reviewState as BardWikiReviewState,
    version: object.version as number,
    contentHash: object.contentHash,
    exportPath: object.exportPath,
    ...(provenance ? { provenance } : {}),
  }
}

function readProvenance(value: unknown): BardWikiVaultDocumentRecord['provenance'] {
  if (value === undefined) return undefined
  const object = requireObject(value, 'provenance')
  rejectFields(object, ['receiptId', 'jobId'], 'provenance')
  const receiptId = object.receiptId === undefined ? undefined : readId(object.receiptId)
  const jobId = object.jobId === undefined ? undefined : readId(object.jobId)
  if (object.receiptId !== undefined && !receiptId)
    throw vaultError('bardwiki_invalid_vault', 'Invalid receipt provenance')
  if (object.jobId !== undefined && !jobId) throw vaultError('bardwiki_invalid_vault', 'Invalid job provenance')
  return { ...(receiptId ? { receiptId } : {}), ...(jobId ? { jobId } : {}) }
}

function decodeMarkdownFile(text: string): { frontmatter: unknown; markdown: string } {
  if (!text.startsWith('---\n')) throw vaultError('bardwiki_invalid_vault', 'Vault Markdown frontmatter is missing')
  const end = text.indexOf('\n---\n', 4)
  if (end < 0) throw vaultError('bardwiki_invalid_vault', 'Vault Markdown frontmatter is malformed')
  try {
    return { frontmatter: JSON.parse(text.slice(4, end)), markdown: text.slice(end + 5) }
  } catch {
    throw vaultError('bardwiki_invalid_vault', 'Vault Markdown frontmatter is not valid YAML JSON')
  }
}

function assertSafeArchivePath(name: string): void {
  const normalized = name.normalize('NFC')
  const parts = normalized.split('/')
  if (
    name.length === 0 ||
    Buffer.byteLength(name, 'utf8') > 1_024 ||
    name !== normalized ||
    name.startsWith('/') ||
    name.includes('\\') ||
    /[\u0000-\u001f\u007f]/u.test(name) ||
    parts.some((part) => part.length === 0 || part === '.' || part === '..') ||
    name.endsWith('/') ||
    (name !== BARDWIKI_VAULT_MANIFEST && !name.toLowerCase().endsWith('.md'))
  ) {
    throw vaultError('bardwiki_invalid_vault', 'Vault contains an unsafe archive path')
  }
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return UTF8_FATAL.decode(bytes)
  } catch {
    throw vaultError('bardwiki_invalid_vault', `${label} is not valid UTF-8`)
  }
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw vaultError('bardwiki_invalid_vault', `${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function rejectFields(object: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const extra = Object.keys(object).find((key) => !allowed.includes(key))
  if (extra) throw vaultError('bardwiki_invalid_vault', `${label} has an unsupported field: ${extra}`)
}

function readId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value)
    ? value
    : null
}

function vaultError(code: string, message: string): BardWikiValidationError {
  return new BardWikiValidationError(code, message)
}
