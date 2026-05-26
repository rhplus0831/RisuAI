import { RisuSaveBlockType, encodeRisuSaveBlockEnvelope } from './blockCodec.js'
import {
  type LegacyRisuSaveEnvelopeKind,
  encodeLegacyRisuSaveEnvelope,
} from './legacyEnvelopeCodec.js'
import { normalizeRisuSaveImportDatabase } from './importSnapshot.js'
import { ValidationError, loadPersisted } from '../repository.js'

type JsonRecord = Record<string, unknown>

export interface RisuSaveExportSnapshot {
  database: JsonRecord
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

export function buildRepositoryRisuSaveExportSnapshot(dataDir: string): RisuSaveExportSnapshot {
  const persisted = loadPersisted(dataDir)
  if (persisted.database === null || persisted.database === undefined) {
    throw new ValidationError('database payload missing')
  }
  return {
    database: normalizeRisuSaveImportDatabase(persisted.database),
  }
}

export function encodeRepositoryRisuSaveLegacyExport(
  dataDir: string,
  kind: LegacyRisuSaveEnvelopeKind = 'legacy-compressed',
): Uint8Array {
  return encodeLegacyRisuSaveEnvelope(buildRepositoryRisuSaveExportSnapshot(dataDir).database, kind)
}

export function encodeRepositoryRisuSaveBlockExport(
  dataDir: string,
  options: RisuSaveBlockExportOptions = {},
): Uint8Array {
  const { database } = buildRepositoryRisuSaveExportSnapshot(dataDir)
  return encodeRisuSaveBlockEnvelope(buildRisuSaveExportBlocks(database, options))
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
