import { type PersistedAsset, loadPersisted, isValidAssetId } from '../repository.js'

type JsonRecord = Record<string, unknown>

export interface RisuSaveAssetReference {
  id: string
  paths: string[]
}

export interface RisuSaveAssetReport {
  referencedCount: number
  missingCount: number
  orphanedCount: number
  referenced: RisuSaveAssetReference[]
  missing: RisuSaveAssetReference[]
  orphaned: PersistedAsset[]
}

export function buildRepositoryRisuSaveAssetReport(dataDir: string): RisuSaveAssetReport {
  const persisted = loadPersisted(dataDir)
  return buildRisuSaveAssetReport(persisted.database, persisted.assets)
}

export function buildRisuSaveAssetReport(
  database: unknown,
  assets: readonly PersistedAsset[],
): RisuSaveAssetReport {
  const references = collectRisuSaveAssetReferences(database)
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

function collectRisuSaveAssetReferences(database: unknown): RisuSaveAssetReference[] {
  const found = new Map<string, Set<string>>()
  const root = readRecord(database)
  if (!root) return []

  addReference(found, root.userIcon, 'database.userIcon')
  addReference(found, root.customBackground, 'database.customBackground')

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
    addTupleReferences(found, record.emotionImages, `${prefix}.emotionImages`)
    addTupleReferences(found, record.additionalAssets, `${prefix}.additionalAssets`)
    addCcAssetReferences(found, record.ccAssets, `${prefix}.ccAssets`)
    addVitsReferences(found, record.vits, `${prefix}.vits.files`)
    addReferenceList(found, record.prebuiltAssetExclude, `${prefix}.prebuiltAssetExclude`)
    addGptSoVitsReference(found, record.gptSoVitsConfig, `${prefix}.gptSoVitsConfig`)
  })

  return [...found.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, paths]) => ({ id, paths: [...paths].sort() }))
}

function addTupleReferences(found: Map<string, Set<string>>, value: unknown, label: string): void {
  readArray(value).forEach((entry, index) => {
    if (!Array.isArray(entry)) return
    addReference(found, entry[1], `${label}[${index}][1]`)
  })
}

function addCcAssetReferences(
  found: Map<string, Set<string>>,
  value: unknown,
  label: string,
): void {
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

function addGptSoVitsReference(
  found: Map<string, Set<string>>,
  value: unknown,
  label: string,
): void {
  const record = readRecord(value)
  const refAudio = readRecord(record?.ref_audio_data)
  if (!refAudio) return
  addReference(found, refAudio.assetId, `${label}.ref_audio_data.assetId`)
}

function addReference(found: Map<string, Set<string>>, value: unknown, path: string): void {
  if (typeof value !== 'string' || !isValidAssetId(value)) return
  const paths = found.get(value) ?? new Set<string>()
  paths.add(path)
  found.set(value, paths)
}

function readRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
