import { randomUUID } from 'node:crypto'
import { EntityNotFoundError, ValidationError } from '../repository.js'
import {
  type CharacterRecord,
  ensureCharacterCollection,
  readCharacterId,
  readJsonObject,
} from './characters.js'
import {
  ensureModuleCollection,
  readModuleId,
  requireModule,
  type ModuleRecord,
} from './lorebooks.js'

type JsonRecord = Record<string, unknown>

export interface ScriptDefinitionRecord extends JsonRecord {
  id: string
}

export interface TriggerDefinitionRecord extends JsonRecord {
  id: string
}

export function normalizeScriptDefinitionDatabase(database: unknown): JsonRecord {
  const target = readJsonObject(database, 'database')
  ensureAllScriptDefinitionCollections(target)
  return target
}

export function normalizeScriptDefinitionCollection(database: unknown): void {
  if (!database || typeof database !== 'object' || Array.isArray(database)) return
  ensureAllScriptDefinitionCollections(database as JsonRecord)
}

export function ensureAllScriptDefinitionCollections(database: JsonRecord): void {
  if (Array.isArray(database.characters)) {
    for (const rawCharacter of database.characters) {
      if (!rawCharacter || typeof rawCharacter !== 'object' || Array.isArray(rawCharacter)) {
        continue
      }
      const character = rawCharacter as CharacterRecord
      const label =
        typeof character.chaId === 'string' && character.chaId.trim()
          ? `character ${character.chaId}`
          : 'character'
      if (Array.isArray(character.customscript)) {
        character.customscript = ensureScriptDefinitions(
          character.customscript,
          `${label}.customscript`,
        )
      }
      if (Array.isArray(character.triggerscript)) {
        character.triggerscript = ensureTriggerDefinitions(
          character.triggerscript,
          `${label}.triggerscript`,
        )
      }
    }
  }

  if (Array.isArray(database.modules)) {
    for (const rawModule of database.modules) {
      if (!rawModule || typeof rawModule !== 'object' || Array.isArray(rawModule)) {
        continue
      }
      const module = rawModule as ModuleRecord
      const label =
        typeof module.id === 'string' && module.id.trim() ? `module ${module.id}` : 'module'
      if (Array.isArray(module.regex)) {
        module.regex = ensureScriptDefinitions(module.regex, `${label}.regex`)
      }
      if (Array.isArray(module.trigger)) {
        module.trigger = ensureTriggerDefinitions(module.trigger, `${label}.trigger`)
      }
    }
  }
}

export function readCharacterScriptParent(
  database: JsonRecord,
  characterId: unknown,
): CharacterRecord {
  const id = readCharacterId(characterId)
  const character = ensureCharacterCollection(database).find((candidate) => candidate.chaId === id)
  if (!character) {
    throw new EntityNotFoundError(`Character not found: ${id}`)
  }
  return character
}

export function readModuleScriptParent(database: JsonRecord, moduleId: unknown): ModuleRecord {
  return requireModule(ensureModuleCollection(database), readModuleId(moduleId))
}

export function readScriptDefinitions(input: unknown, label = 'scripts'): ScriptDefinitionRecord[] {
  if (!Array.isArray(input)) {
    throw new ValidationError(`${label} must be an array`)
  }
  return ensureScriptDefinitions(input, label)
}

export function readTriggerDefinitions(
  input: unknown,
  label = 'triggers',
): TriggerDefinitionRecord[] {
  if (!Array.isArray(input)) {
    throw new ValidationError(`${label} must be an array`)
  }
  return ensureTriggerDefinitions(input, label)
}

function ensureScriptDefinitions(input: unknown[], label: string): ScriptDefinitionRecord[] {
  return ensureDefinitionRecords(input, label, 'script') as ScriptDefinitionRecord[]
}

function ensureTriggerDefinitions(input: unknown[], label: string): TriggerDefinitionRecord[] {
  return ensureDefinitionRecords(input, label, 'trigger') as TriggerDefinitionRecord[]
}

function ensureDefinitionRecords(
  input: unknown[],
  label: string,
  kind: 'script' | 'trigger',
): JsonRecord[] {
  const seen = new Set<string>()
  return input.map((raw, index) => {
    const record = readJsonObject(raw, `${label}[${index}]`)
    const id = typeof record.id === 'string' && record.id.trim() ? record.id : randomUUID()
    const normalizedId = seen.has(id) ? randomUUID() : id
    record.id = normalizedId
    seen.add(normalizedId)
    validateDefinitionRecord(record, `${label}[${index}]`, kind)
    return record
  })
}

function validateDefinitionRecord(
  record: JsonRecord,
  label: string,
  kind: 'script' | 'trigger',
): void {
  if (kind === 'script') {
    for (const key of ['comment', 'in', 'out', 'type']) {
      if (key in record && typeof record[key] !== 'string') {
        throw new ValidationError(`${label}.${key} must be a string`)
      }
    }
    if ('flag' in record && record.flag !== undefined && typeof record.flag !== 'string') {
      throw new ValidationError(`${label}.flag must be a string`)
    }
    if (
      'ableFlag' in record &&
      record.ableFlag !== undefined &&
      typeof record.ableFlag !== 'boolean'
    ) {
      throw new ValidationError(`${label}.ableFlag must be a boolean`)
    }
    return
  }

  if ('comment' in record && typeof record.comment !== 'string') {
    throw new ValidationError(`${label}.comment must be a string`)
  }
  if ('type' in record && typeof record.type !== 'string') {
    throw new ValidationError(`${label}.type must be a string`)
  }
  if ('conditions' in record && !Array.isArray(record.conditions)) {
    throw new ValidationError(`${label}.conditions must be an array`)
  }
  if ('effect' in record && !Array.isArray(record.effect)) {
    throw new ValidationError(`${label}.effect must be an array`)
  }
}
