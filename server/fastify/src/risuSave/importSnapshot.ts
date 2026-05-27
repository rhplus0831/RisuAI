import {
  type RisuSaveUnsupportedReferenceKind,
  RisuSaveBlockType,
  decodeRisuSaveBlockEnvelope,
} from './blockCodec.js'
import {
  type RisuSaveEnvelopeKind,
  classifyRisuSaveEnvelope,
  decodeLegacyRisuSaveEnvelope,
} from './legacyEnvelopeCodec.js'
import { ValidationError } from '../repository.js'
import { normalizePresetCollection } from '../commands/presets.js'
import { normalizePromptTemplateCollection } from '../commands/prompts.js'
import { normalizePersonaCollection } from '../commands/personas.js'
import { normalizeTranslatorPresetCollection } from '../commands/translatorPresets.js'
import { normalizeLoadoutCollection } from '../commands/loadouts.js'
import { normalizeAllChatMessages } from '../commands/messages.js'
import { ensureModuleRecords, ensureEnabledModules } from '../commands/modules.js'
import { ensurePluginRecords } from '../commands/plugins.js'
import { ensurePluginCustomStorage } from '../commands/pluginStorage.js'
import { ensureGlobalLorebookCollection, ensureAllChildLorebooks } from '../commands/lorebooks.js'
import { normalizeScriptDefinitionCollection } from '../commands/scriptDefinitions.js'

type JsonRecord = Record<string, unknown>

export interface RisuSaveImportUnsupportedReference {
  name: string
  type: RisuSaveBlockType.REMOTE
  kind: RisuSaveUnsupportedReferenceKind
}

export interface RisuSaveImportSnapshot {
  envelope: RisuSaveEnvelopeKind
  database: JsonRecord
  unsupportedReferences: RisuSaveImportUnsupportedReference[]
}

export function decodeRisuSaveImportSnapshot(data: Uint8Array): RisuSaveImportSnapshot {
  const envelope = classifyRisuSaveEnvelope(data)
  if (
    envelope === 'legacy-raw' ||
    envelope === 'legacy-compressed' ||
    envelope === 'legacy-stream'
  ) {
    return {
      envelope,
      database: normalizeImportDatabase(
        decodeEnvelopeAsValidation(() => decodeLegacyRisuSaveEnvelope(data)),
      ),
      unsupportedReferences: [],
    }
  }

  if (envelope !== 'risusave-blocks') {
    throw new ValidationError(`Unsupported .risu envelope: ${envelope}`)
  }

  const decoded = decodeEnvelopeAsValidation(() => decodeRisuSaveBlockEnvelope(data))
  return {
    envelope,
    database: normalizeImportDatabase(assembleBlockDatabase(decoded.blocks)),
    unsupportedReferences: decoded.unsupportedReferences,
  }
}

/**
 * The low-level envelope decoders throw plain Errors for malformed structures
 * (truncated headers, bad gzip, unparsable directory JSON). Uploaded saves are
 * untrusted input, so surface those as ValidationError (400) rather than
 * letting them bubble up as internal 500s. ValidationErrors pass through.
 */
function decodeEnvelopeAsValidation<T>(decode: () => T): T {
  try {
    return decode()
  } catch (err) {
    if (err instanceof ValidationError) throw err
    throw new ValidationError(
      err instanceof Error ? err.message : 'Malformed .risu save envelope',
    )
  }
}

export function normalizeRisuSaveImportDatabase(database: unknown): JsonRecord {
  return normalizeImportDatabase(database)
}

function assembleBlockDatabase(
  blocks: ReturnType<typeof decodeRisuSaveBlockEnvelope>['blocks'],
): JsonRecord {
  const database: JsonRecord = {}
  let sawRoot = false

  for (const block of blocks) {
    if (block.unsupportedReference) continue
    if (block.content === null) {
      throw new ValidationError(`RISUSAVE block ${block.name} has no content`)
    }

    const parsed = parseBlockJson(block.name, block.content)
    switch (block.type) {
      case RisuSaveBlockType.ROOT:
        sawRoot = true
        Object.assign(database, omitDirectory(readJsonObject(parsed, `${block.name} block`)))
        break
      case RisuSaveBlockType.CHARACTER_WITH_CHAT:
      case RisuSaveBlockType.CHARACTER_WITHOUT_CHAT:
        database.characters ??= []
        if (!Array.isArray(database.characters)) {
          throw new ValidationError('characters must be an array')
        }
        database.characters.push(readJsonObject(parsed, `${block.name} block`))
        break
      case RisuSaveBlockType.CHAT:
        throw new ValidationError(`Standalone chat blocks are not supported yet: ${block.name}`)
      case RisuSaveBlockType.BOTPRESET:
        database.botPresets = readJsonArray(parsed, `${block.name} block`)
        break
      case RisuSaveBlockType.MODULES:
        database.modules = readJsonArray(parsed, `${block.name} block`)
        break
      case RisuSaveBlockType.PLUGINS:
        database.plugins = readJsonArray(parsed, `${block.name} block`)
        break
      case RisuSaveBlockType.LOADOUTS:
        database.loadouts = readJsonArray(parsed, `${block.name} block`)
        break
      case RisuSaveBlockType.PLUGIN_STORAGE:
        database.pluginCustomStorage = readJsonObject(parsed, `${block.name} block`)
        break
      case RisuSaveBlockType.CONFIG:
        readJsonObject(parsed, `${block.name} block`)
        break
      case RisuSaveBlockType.ROOT_COMPONENT: {
        const component = readJsonObject(parsed, `${block.name} block`)
        if (typeof component.key !== 'string' || component.key.trim() === '') {
          throw new ValidationError(`${block.name} block key must be a non-empty string`)
        }
        database[component.key] = cloneJson(component.data)
        break
      }
      case RisuSaveBlockType.REMOTE:
        break
      default:
        throw new ValidationError(`Unsupported RISUSAVE block type ${block.type} for ${block.name}`)
    }
  }

  if (!sawRoot) {
    throw new ValidationError('RISUSAVE block save must include a root block')
  }

  return database
}

function normalizeImportDatabase(database: unknown): JsonRecord {
  const target = readJsonObject(cloneJson(database), 'database')
  normalizeAllChatMessages(target)

  if (hasAnyKey(target, ['botPresets', 'botPresetsId'])) {
    normalizePresetCollection(target)
  }
  normalizePromptTemplateCollection(target)
  if (hasAnyKey(target, ['personas', 'selectedPersona', 'username', 'userIcon', 'personaPrompt'])) {
    normalizePersonaCollection(target)
  }
  if (
    hasAnyKey(target, [
      'translatorPresets',
      'translatorPresetId',
      'translatorPrompt',
      'translatorMaxResponse',
    ])
  ) {
    normalizeTranslatorPresetCollection(target)
  }
  if (hasAnyKey(target, ['loadouts', 'lastLoadedLoadoutName'])) {
    normalizeLoadoutCollection(target)
  }
  if (hasAnyKey(target, ['modules', 'enabledModules'])) {
    ensureModuleRecords(target)
    ensureEnabledModules(target)
  }
  if (hasAnyKey(target, ['plugins', 'currentPluginProvider'])) {
    ensurePluginRecords(target)
    if (typeof target.currentPluginProvider !== 'string') target.currentPluginProvider = ''
  }
  if ('pluginCustomStorage' in target) {
    ensurePluginCustomStorage(target)
  }
  if ('loreBook' in target) {
    ensureGlobalLorebookCollection(target)
  }
  ensureAllChildLorebooks(target)
  normalizeScriptDefinitionCollection(target)

  return target
}

function parseBlockJson(name: string, content: string): unknown {
  try {
    return JSON.parse(content)
  } catch {
    throw new ValidationError(`RISUSAVE block ${name} must contain valid JSON`)
  }
}

function readJsonObject(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object`)
  }
  validateJsonValue(label, value)
  return value as JsonRecord
}

function readJsonArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${label} must be an array`)
  }
  validateJsonValue(label, value)
  return value
}

function omitDirectory(root: JsonRecord): JsonRecord {
  const next: JsonRecord = {}
  for (const [key, value] of Object.entries(root)) {
    if (key === '__directory') continue
    next[key] = value
  }
  return next
}

function hasAnyKey(record: JsonRecord, keys: readonly string[]): boolean {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(record, key))
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function validateJsonValue(label: string, value: unknown): void {
  if (value === undefined) {
    throw new ValidationError(`${label} must be JSON-serializable`)
  }
  try {
    JSON.stringify(value)
  } catch {
    throw new ValidationError(`${label} must be JSON-serializable`)
  }
}
