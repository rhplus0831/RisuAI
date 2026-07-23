import type { DatabaseSync } from 'node:sqlite'
import { RisuSaveBlockType, encodeRisuSaveBlockEnvelope } from './blockCodec.js'
import { type LegacyRisuSaveEnvelopeKind, encodeLegacyRisuSaveEnvelope } from './legacyEnvelopeCodec.js'
import { normalizeRisuSaveSnapshotDatabase } from './importSnapshot.js'
import { type Persisted, ValidationError, loadPersistedWithMessages } from '../repository.js'
import { listLegacySummaryTombstones } from '../memoryLegacyImport.js'
import {
  RISU_SERVER_DATA_KEY,
  emptyRisuServerPortableMetadata,
  type RisuServerPortableMetadata,
} from './portableMetadata.js'

type JsonRecord = Record<string, unknown>

export interface RisuSaveExportSnapshot {
  database: JsonRecord
  portableMetadata: RisuServerPortableMetadata
}

export interface RisuSaveBlockExportOptions {
  compression?: boolean
}

const BLOCK_RESOURCE_KEYS = new Set([
  'characters',
  'botPresets',
  'modules',
  'loadouts',
  'plugins',
  'pluginCustomStorage',
  '__directory',
])

export function buildRepositoryRisuSaveExportSnapshot(db: DatabaseSync, dataDir: string): RisuSaveExportSnapshot {
  // Messages live in SQLite; hydrate them back so exported
  // CHARACTER_WITH_CHAT blocks carry the full chat history.
  const persisted = loadPersistedWithMessages(db, dataDir)
  return buildRisuSaveExportSnapshotFromPersisted(persisted, {
    version: 1,
    memoryLegacySummaryTombstones: listLegacySummaryTombstones(db),
  })
}

export function buildRisuSaveExportSnapshotFromPersisted(
  persisted: Persisted,
  portableMetadata: RisuServerPortableMetadata = emptyRisuServerPortableMetadata(),
): RisuSaveExportSnapshot {
  if (persisted.database === null || persisted.database === undefined) {
    throw new ValidationError('database payload missing')
  }
  return {
    database: normalizeRisuSaveSnapshotDatabase(persisted.database),
    portableMetadata,
  }
}

export function encodeRepositoryRisuSaveLegacyExport(
  db: DatabaseSync,
  dataDir: string,
  kind: LegacyRisuSaveEnvelopeKind = 'legacy-compressed',
): Uint8Array {
  return encodeRisuSaveLegacyExportSnapshot(buildRepositoryRisuSaveExportSnapshot(db, dataDir), kind)
}

export function encodeRepositoryRisuSaveBlockExport(
  db: DatabaseSync,
  dataDir: string,
  options: RisuSaveBlockExportOptions = {},
): Uint8Array {
  return encodeRisuSaveBlockExportSnapshot(buildRepositoryRisuSaveExportSnapshot(db, dataDir), options)
}

export function encodeRisuSaveLegacyExportSnapshot(
  snapshot: RisuSaveExportSnapshot,
  kind: LegacyRisuSaveEnvelopeKind = 'legacy-compressed',
): Uint8Array {
  return encodeLegacyRisuSaveEnvelope(buildPortableDatabase(snapshot), kind)
}

export function encodeRisuSaveBlockExportSnapshot(
  snapshot: RisuSaveExportSnapshot,
  options: RisuSaveBlockExportOptions = {},
): Uint8Array {
  return encodeRisuSaveBlockEnvelope(buildRisuSaveExportBlocks(buildPortableDatabase(snapshot), options))
}

function buildPortableDatabase(snapshot: RisuSaveExportSnapshot): JsonRecord {
  return {
    ...snapshot.database,
    [RISU_SERVER_DATA_KEY]: {
      version: snapshot.portableMetadata.version,
      memoryLegacySummaryTombstones: snapshot.portableMetadata.memoryLegacySummaryTombstones.map((row) => ({ ...row })),
    },
  }
}

export function buildRisuSaveExportBlocks(
  database: JsonRecord,
  options: RisuSaveBlockExportOptions = {},
): Parameters<typeof encodeRisuSaveBlockEnvelope>[0] {
  const compression = options.compression ?? false
  const blocks: Parameters<typeof encodeRisuSaveBlockEnvelope>[0] = []
  const directory: string[] = []

  addResourceBlock(blocks, directory, {
    name: 'preset',
    type: RisuSaveBlockType.BOTPRESET,
    value: readJsonArray(database.botPresets, 'database.botPresets'),
    compression,
  })
  addResourceBlock(blocks, directory, {
    name: 'modules',
    type: RisuSaveBlockType.MODULES,
    value: readJsonArray(database.modules, 'database.modules'),
    compression,
  })
  addResourceBlock(blocks, directory, {
    name: 'loadouts',
    type: RisuSaveBlockType.LOADOUTS,
    value: readJsonArray(database.loadouts, 'database.loadouts'),
    compression,
  })
  addResourceBlock(blocks, directory, {
    name: 'plugins',
    type: RisuSaveBlockType.PLUGINS,
    value: readJsonArray(database.plugins, 'database.plugins'),
    compression,
  })
  addResourceBlock(blocks, directory, {
    name: 'pluginStorage',
    type: RisuSaveBlockType.PLUGIN_STORAGE,
    value: readJsonObject(database.pluginCustomStorage, 'database.pluginCustomStorage'),
    compression,
  })

  for (const character of readJsonArray(database.characters, 'database.characters')) {
    const record = readJsonObject(character, 'database.characters[]')
    const name = readBlockName(record.chaId, 'character.chaId')
    addResourceBlock(blocks, directory, {
      name,
      type: RisuSaveBlockType.CHARACTER_WITH_CHAT,
      value: record,
      compression,
    })
  }

  addResourceBlock(blocks, directory, {
    name: 'config',
    type: RisuSaveBlockType.CONFIG,
    value: { version: 1 },
    compression,
  })

  return [
    {
      name: 'root',
      type: RisuSaveBlockType.ROOT,
      data: JSON.stringify({ ...rootDatabaseFields(database), __directory: directory }),
      compression,
    },
    ...blocks,
  ]
}

function addResourceBlock(
  blocks: Parameters<typeof encodeRisuSaveBlockEnvelope>[0],
  directory: string[],
  block: {
    name: string
    type: RisuSaveBlockType
    value: unknown
    compression: boolean
  },
): void {
  blocks.push({
    name: block.name,
    type: block.type,
    data: JSON.stringify(block.value),
    compression: block.compression,
  })
  directory.push(block.name)
}

function rootDatabaseFields(database: JsonRecord): JsonRecord {
  const root: JsonRecord = {}
  for (const [key, value] of Object.entries(database)) {
    if (!BLOCK_RESOURCE_KEYS.has(key)) {
      root[key] = value
    }
  }
  return root
}

function readJsonObject(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object`)
  }
  return value as JsonRecord
}

function readJsonArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${label} must be an array`)
  }
  return value
}

function readBlockName(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${label} must be a non-empty string`)
  }
  return value
}
