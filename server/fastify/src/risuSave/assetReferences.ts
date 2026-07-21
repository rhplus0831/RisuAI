import type { DatabaseSync } from 'node:sqlite'
import { type PersistedAsset, getAllAssetMetadata, isValidAssetId, loadPersisted } from '../repository.js'

type JsonRecord = Record<string, unknown>

export interface RisuSaveAssetReference {
  id: string
  paths: string[]
}

/** A candidate reference value + its report path label, fed through the same
 *  validation as the walker's own finds. */
export interface RisuSaveAssetReferenceSource {
  value: unknown
  path: string
}

export interface RisuSaveAssetReport {
  referencedCount: number
  missingCount: number
  orphanedCount: number
  referenced: RisuSaveAssetReference[]
  missing: RisuSaveAssetReference[]
  orphaned: PersistedAsset[]
}

const INLAY_TOKEN_RE = /\{\{(inlay|inlayed|inlayeddata)::(.+?)\}\}/g

export function buildRepositoryRisuSaveAssetReport(dataDir: string, db: DatabaseSync): RisuSaveAssetReport {
  // Active and alternate message inlay references come from a column-only
  // `messages.data` scan instead of hydrating every chat's message JSON. The
  // message-free `loadPersisted` projection covers non-message references and
  // supplies the stable chat path labels.
  const persisted = loadPersisted(db, dataDir)
  const assets = getAllAssetMetadata(db)
  return buildRisuSaveAssetReport(persisted.database, assets, collectMessageInlayReferences(db, persisted.database))
}

export function buildRisuSaveAssetReport(
  database: unknown,
  assets: readonly PersistedAsset[],
  extraReferences: readonly RisuSaveAssetReferenceSource[] = [],
): RisuSaveAssetReport {
  const references = collectRisuSaveAssetReferences(database, extraReferences)
  const referencedIds = new Set(references.map((reference) => reference.id))
  const storedIds = new Set(assets.map((asset) => asset.id))

  return {
    referencedCount: references.length,
    missingCount: references.filter((reference) => !storedIds.has(reference.id)).length,
    orphanedCount: assets.filter((asset) => !referencedIds.has(asset.id)).length,
    referenced: references,
    missing: references.filter((reference) => !storedIds.has(reference.id)),
    orphaned: assets.filter((asset) => !referencedIds.has(asset.id)),
  }
}

export function summarizeRisuSaveAssetReport(
  report: RisuSaveAssetReport,
): Pick<RisuSaveAssetReport, 'referencedCount' | 'missingCount' | 'orphanedCount'> {
  return {
    referencedCount: report.referencedCount,
    missingCount: report.missingCount,
    orphanedCount: report.orphanedCount,
  }
}

/**
 * Inlay-token references from the messages table, without hydrating any chat:
 * a column-only scan of `messages.data` in `seq` order, labeled via each chat's
 * position in the projected database. Active paths match the hydrated walker
 * byte-for-byte; durable reroll candidates use the hydration payload's
 * `alternates` label. Rows whose chat is not in the projection are skipped.
 */
export function collectMessageInlayReferences(db: DatabaseSync, database: unknown): RisuSaveAssetReferenceSource[] {
  // chatId → every `database.characters[i].chats[j]` label that carries it
  // (duplicate chat ids across characters hydrate the same rows into each).
  const chatLabels = new Map<string, string[]>()
  const root = readRecord(database)
  readArray(root?.characters).forEach((character, characterIndex) => {
    const record = readRecord(character)
    if (!record) return
    readArray(record.chats).forEach((chat, chatIndex) => {
      const chatId = readRecord(chat)?.id
      if (typeof chatId !== 'string') return
      const labels = chatLabels.get(chatId) ?? []
      labels.push(`database.characters[${characterIndex}].chats[${chatIndex}]`)
      chatLabels.set(chatId, labels)
    })
  })
  if (chatLabels.size === 0) return []

  const rows = db
    .prepare('SELECT chat_id, data, alternate FROM messages ORDER BY chat_id, alternate, seq')
    .all() as Array<{ chat_id: string; data: string; alternate: number }>

  const references: RisuSaveAssetReferenceSource[] = []
  const messageIndexByChat = new Map<string, number>()
  const alternateIndexByChat = new Map<string, number>()
  for (const row of rows) {
    const labels = chatLabels.get(row.chat_id)
    const isAlternate = row.alternate === 1
    const indexByChat = isAlternate ? alternateIndexByChat : messageIndexByChat
    const messageIndex = indexByChat.get(row.chat_id) ?? 0
    indexByChat.set(row.chat_id, messageIndex + 1)
    if (!labels || typeof row.data !== 'string') continue
    for (const reference of collectInlayAssetReferenceSources(
      row.data,
      isAlternate ? `alternates[${messageIndex}].data` : `message[${messageIndex}].data`,
    )) {
      for (const label of labels) {
        references.push({
          value: reference.value,
          path: `${label}.${reference.path}`,
        })
      }
    }
  }
  return references
}

function collectRisuSaveAssetReferences(
  database: unknown,
  extraReferences: readonly RisuSaveAssetReferenceSource[] = [],
): RisuSaveAssetReference[] {
  const found = new Map<string, Set<string>>()
  const root = readRecord(database)
  if (!root) return []

  addReference(found, root.userIcon, 'database.userIcon')
  addReference(found, root.customBackground, 'database.customBackground')

  const naiImgConfig = readRecord(root.NAIImgConfig)
  if (naiImgConfig) {
    addReference(found, naiImgConfig.image, 'database.NAIImgConfig.image')
    addReference(found, naiImgConfig.character_image, 'database.NAIImgConfig.character_image')
  }

  const wavespeedImage = readRecord(root.wavespeedImage)
  if (wavespeedImage) {
    addReference(found, wavespeedImage.reference_image, 'database.wavespeedImage.reference_image')
  }

  readArray(root.personas).forEach((persona, index) => {
    const record = readRecord(persona)
    if (!record) return
    addReference(found, record.icon, `database.personas[${index}].icon`)
  })

  readArray(root.characterOrder).forEach((entry, index) => {
    const record = readRecord(entry)
    if (!record) return
    addReference(found, record.img, `database.characterOrder[${index}].img`)
    addReference(found, record.imgFile, `database.characterOrder[${index}].imgFile`)
  })

  readArray(root.botPresets).forEach((preset, index) => {
    const record = readRecord(preset)
    if (!record) return
    addReference(found, record.image, `database.botPresets[${index}].image`)
  })

  readArray(root.modelPresets).forEach((preset, index) => {
    const record = readRecord(preset)
    if (!record) return
    addReference(found, record.image, `database.modelPresets[${index}].image`)
  })

  readArray(root.promptPresets).forEach((preset, index) => {
    const record = readRecord(preset)
    if (!record) return
    addReference(found, record.image, `database.promptPresets[${index}].image`)
  })

  readArray(root.modules).forEach((module, index) => {
    const record = readRecord(module)
    if (!record) return
    addTupleReferences(found, record.assets, `database.modules[${index}].assets`)
  })

  readArray(root.characters).forEach((character, index) => {
    const record = readRecord(character)
    if (!record) return
    const prefix = `database.characters[${index}]`
    addReference(found, record.image, `${prefix}.image`)
    addReference(found, record.notificationImage, `${prefix}.notificationImage`)
    addTupleReferences(found, record.emotionImages, `${prefix}.emotionImages`)
    addTupleReferences(found, record.additionalAssets, `${prefix}.additionalAssets`)
    addChatInlayReferences(found, record.chats, `${prefix}.chats`)
    addCcAssetReferences(found, record.ccAssets, `${prefix}.ccAssets`)
    addVitsReferences(found, record.vits, `${prefix}.vits.files`)
    addReferenceList(found, record.prebuiltAssetExclude, `${prefix}.prebuiltAssetExclude`)
    addGptSoVitsReference(found, record.gptSoVitsConfig, `${prefix}.gptSoVitsConfig`)
    addCharacterTextInlayReferences(found, record, prefix)
  })

  addReferenceSources(found, collectDeepAssetReferenceSources(root.pluginCustomStorage, 'database.pluginCustomStorage'))

  addReferenceSources(found, extraReferences)

  return [...found.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, paths]) => ({ id, paths: [...paths].sort() }))
}

/**
 * Merge references collected by targeted table scans. These are candidates,
 * so each one still passes the walker's `addReference` id/path validation.
 */
function addReferenceSources(
  found: Map<string, Set<string>>,
  extraReferences: readonly RisuSaveAssetReferenceSource[],
): void {
  for (const extra of extraReferences) {
    addReference(found, extra.value, extra.path)
  }
}

function addChatInlayReferences(found: Map<string, Set<string>>, value: unknown, label: string): void {
  readArray(value).forEach((chat, chatIndex) => {
    const chatRecord = readRecord(chat)
    if (!chatRecord) return
    readArray(chatRecord.message).forEach((message, messageIndex) => {
      const messageRecord = readRecord(message)
      if (typeof messageRecord?.data !== 'string') return
      addReferenceSources(
        found,
        collectInlayAssetReferenceSources(messageRecord.data, `${label}[${chatIndex}].message[${messageIndex}].data`),
      )
    })
  })
}

function addCharacterTextInlayReferences(found: Map<string, Set<string>>, record: JsonRecord, label: string): void {
  // These fields are either rendered directly through ParseMarkdown or can be
  // interpolated by parser callbacks into a rendered greeting/background.
  const textFields = [
    'firstMessage',
    'backgroundHTML',
    'creatorNotes',
    'name',
    'nickname',
    'desc',
    'personality',
    'scenario',
    'exampleMessage',
  ] as const
  for (const field of textFields) {
    addReferenceSources(found, collectInlayAssetReferenceSources(record[field], `${label}.${field}`))
  }
  readArray(record.alternateGreetings).forEach((greeting, index) => {
    addReferenceSources(found, collectInlayAssetReferenceSources(greeting, `${label}.alternateGreetings[${index}]`))
  })
}

/** Extract inlay-token candidates from one known renderable string. Asset-id
 * validation remains centralized in `addReference` when the sources merge. */
export function collectInlayAssetReferenceSources(value: unknown, label: string): RisuSaveAssetReferenceSource[] {
  if (typeof value !== 'string') return []
  return [...value.matchAll(INLAY_TOKEN_RE)].map((match) => ({
    value: match[2],
    path: `${label}.${match[1]}`,
  }))
}

/** Deeply enumerate string candidates in one explicitly arbitrary JSON store.
 * The caller chooses the bounded root; the shared walker still decides which
 * strings are sha256 ids or legacy `assets/<id>.<ext>` references. */
export function collectDeepAssetReferenceSources(value: unknown, label: string): RisuSaveAssetReferenceSource[] {
  const references: RisuSaveAssetReferenceSource[] = []
  const seen = new WeakSet<object>()

  const visit = (candidate: unknown, path: string): void => {
    if (typeof candidate === 'string') {
      references.push({ value: candidate, path })
      return
    }
    if (!candidate || typeof candidate !== 'object') return
    if (seen.has(candidate)) return
    seen.add(candidate)

    if (Array.isArray(candidate)) {
      candidate.forEach((entry, index) => visit(entry, `${path}[${index}]`))
      return
    }
    for (const [key, entry] of Object.entries(candidate as JsonRecord)) {
      visit(entry, `${path}[${JSON.stringify(key)}]`)
    }
  }

  visit(value, label)
  return references
}

function addTupleReferences(found: Map<string, Set<string>>, value: unknown, label: string): void {
  readArray(value).forEach((entry, index) => {
    if (!Array.isArray(entry)) return
    addReference(found, entry[1], `${label}[${index}][1]`)
  })
}

function addCcAssetReferences(found: Map<string, Set<string>>, value: unknown, label: string): void {
  readArray(value).forEach((entry, index) => {
    const record = readRecord(entry)
    if (!record) return
    addReference(found, record.uri, `${label}[${index}].uri`)
  })
}

function addVitsReferences(found: Map<string, Set<string>>, value: unknown, label: string): void {
  const record = readRecord(value)
  const files = readRecord(record?.files)
  if (!files) return
  for (const [key, assetId] of Object.entries(files)) {
    addReference(found, assetId, `${label}.${key}`)
  }
}

function addReferenceList(found: Map<string, Set<string>>, value: unknown, label: string): void {
  readArray(value).forEach((entry, index) => addReference(found, entry, `${label}[${index}]`))
}

function addGptSoVitsReference(found: Map<string, Set<string>>, value: unknown, label: string): void {
  const record = readRecord(value)
  const refAudio = readRecord(record?.ref_audio_data)
  if (!refAudio) return
  addReference(found, refAudio.assetId, `${label}.ref_audio_data.assetId`)
}

function addReference(found: Map<string, Set<string>>, value: unknown, path: string): void {
  if (typeof value !== 'string') return
  const localAssetPath = value.startsWith('assets/') ? /^assets\/([a-f0-9]{64})\.[a-z0-9]+$/i.exec(value) : null
  const id = isValidAssetId(value) ? value : (localAssetPath?.[1] ?? null)
  if (!id) return
  const paths = found.get(id) ?? new Set<string>()
  paths.add(path)
  found.set(id, paths)
}

function readRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
