import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { EntityNotFoundError, ValidationError } from '../repository.js'
import { validateOptionalServerAssetRef } from './assets.js'

type JsonRecord = Record<string, unknown>

export interface PersonaRecord extends JsonRecord {
  id: string
  name?: string
  icon?: string
  personaPrompt?: string
  note?: string
  largePortrait?: boolean
}

export function ensureDatabaseObject(database: unknown): JsonRecord {
  if (!database || typeof database !== 'object' || Array.isArray(database)) {
    throw new ValidationError('database must be an object before persona commands can run')
  }
  return database as JsonRecord
}

export function ensurePersonaCollection(database: JsonRecord): PersonaRecord[] {
  if (!Array.isArray(database.personas)) {
    database.personas = []
  }

  const seen = new Set<string>()
  const personas = (database.personas as unknown[]).map((raw) => {
    const persona = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as JsonRecord) : {}
    const rawId = typeof persona.id === 'string' && persona.id.trim() ? persona.id : randomUUID()
    const id = seen.has(rawId) ? randomUUID() : rawId
    seen.add(id)
    persona.id = id
    return repairPersonaRecord(persona)
  })
  database.personas = personas

  if (!Number.isInteger(database.selectedPersona as number)) {
    database.selectedPersona = personas.length > 0 ? 0 : -1
  }
  if ((database.selectedPersona as number) >= personas.length) {
    database.selectedPersona = personas.length > 0 ? personas.length - 1 : -1
  }
  if ((database.selectedPersona as number) < -1) {
    database.selectedPersona = personas.length > 0 ? 0 : -1
  }

  return personas
}

export function normalizePersonaCollection(database: unknown): void {
  if (!database || typeof database !== 'object' || Array.isArray(database)) return
  ensurePersonaCollection(database as JsonRecord)
}

export function createPersonaRecord(
  input: unknown,
  options: { assetDb?: DatabaseSync } = {},
): PersonaRecord {
  const persona = readJsonObject(input, 'persona') as PersonaRecord
  persona.id = readPersonaId(persona.id, 'persona.id')
  validatePersonaRecord(persona, 'persona', options)
  return persona
}

function repairPersonaRecord(
  input: unknown,
  options: { assetDb?: DatabaseSync } = {},
): PersonaRecord {
  const persona = readJsonObject(input, 'persona') as PersonaRecord
  persona.id = typeof persona.id === 'string' && persona.id.trim() ? persona.id : randomUUID()
  validatePersonaRecord(persona, 'persona', options)
  return persona
}

export function readPersonaPatch(
  input: unknown,
  options: { assetDb?: DatabaseSync } = {},
): JsonRecord {
  const patch = readJsonObject(input, 'patch')
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('patch must include at least one persona field')
  }
  validatePersonaRecord(patch, 'patch', options)
  return patch
}

export function readPersonaId(value: unknown, label = 'personaId'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${label} must be a non-empty string`)
  }
  return value
}

export function readOptionalBoolean(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${label} must be a boolean`)
  }
  return value
}

export function readJsonObject(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object`)
  }
  validateJsonValue(label, value)
  return value as JsonRecord
}

export function findPersonaIndex(personas: readonly PersonaRecord[], personaId: string): number {
  return personas.findIndex((persona) => persona.id === personaId)
}

export function requirePersonaIndex(personas: readonly PersonaRecord[], personaId: string): number {
  const index = findPersonaIndex(personas, personaId)
  if (index === -1) {
    throw new EntityNotFoundError(`Persona not found: ${personaId}`)
  }
  return index
}

export function selectedPersonaId(
  database: JsonRecord,
  personas: readonly PersonaRecord[],
): string | null {
  const index = Number.isInteger(database.selectedPersona as number)
    ? (database.selectedPersona as number)
    : -1
  return personas[index]?.id ?? null
}

export function saveSelectedPersonaSnapshot(database: JsonRecord, personas: PersonaRecord[]): void {
  const index = Number.isInteger(database.selectedPersona as number)
    ? (database.selectedPersona as number)
    : -1
  if (index < 0 || index >= personas.length) return

  personas[index] = {
    ...personas[index],
    name: stringValue(database.username),
    icon: stringValue(database.userIcon),
    personaPrompt: stringValue(database.personaPrompt),
    note: stringValue(database.userNote),
  }
}

export function mirrorLegacyProfile(database: JsonRecord, persona: PersonaRecord): void {
  database.username = stringValue(persona.name)
  database.userIcon = stringValue(persona.icon)
  database.personaPrompt = stringValue(persona.personaPrompt)
  database.userNote = stringValue(persona.note)
}

export function validateFullPersonaIdList(
  personas: readonly PersonaRecord[],
  personaIds: readonly unknown[],
): asserts personaIds is string[] {
  const existing = new Set(personas.map((persona) => persona.id))
  const seen = new Set<string>()
  if (personaIds.length !== personas.length) {
    throw new ValidationError('personaIds must include every existing persona id')
  }
  for (const id of personaIds) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new ValidationError('personaIds must contain non-empty strings')
    }
    if (seen.has(id)) {
      throw new ValidationError(`Duplicate persona id: ${id}`)
    }
    if (!existing.has(id)) {
      throw new ValidationError(`Unknown persona id: ${id}`)
    }
    seen.add(id)
  }
}

function validatePersonaRecord(
  record: JsonRecord,
  label: string,
  options: { assetDb?: DatabaseSync } = {},
): void {
  if ('id' in record && (typeof record.id !== 'string' || record.id.trim() === '')) {
    throw new ValidationError(`${label}.id must be a non-empty string`)
  }
  for (const key of ['name', 'icon', 'personaPrompt', 'note']) {
    if (key in record && typeof record[key] !== 'string') {
      throw new ValidationError(`${label}.${key} must be a string`)
    }
  }
  if ('largePortrait' in record && typeof record.largePortrait !== 'boolean') {
    throw new ValidationError(`${label}.largePortrait must be a boolean`)
  }
  if (options.assetDb && 'icon' in record) {
    validateOptionalServerAssetRef(options.assetDb, record.icon, `${label}.icon`)
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function validateJsonValue(label: string, value: unknown): void {
  try {
    JSON.stringify(value)
  } catch {
    throw new ValidationError(`${label} must be JSON-serializable`)
  }
  if (value === undefined) {
    throw new ValidationError(`${label} must be JSON-serializable`)
  }
}
