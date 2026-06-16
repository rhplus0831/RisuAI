import { CHARACTER_PATCH_EXCLUDED_KEYS } from '../characterCommands'
import { CHAT_PATCH_ALLOWED_KEYS } from '../chatCommands'

const JSON_UNDEFINED_SNAPSHOT = '__undefined__'
const SUPPORTED_CHAT_REPLACEMENT_KEYS = new Set(['message', 'scriptstate'])

export function changedUnsupportedCharacterFields(previous: unknown, current: unknown): string[] {
  return changedUnsupportedTopLevelFields(previous, current, CHARACTER_PATCH_EXCLUDED_KEYS)
}

export function changedUnsupportedChatFields(previous: unknown, current: unknown): string[] {
  const supported = new Set([...CHAT_PATCH_ALLOWED_KEYS, ...SUPPORTED_CHAT_REPLACEMENT_KEYS])
  const previousRecord = toRecord(previous)
  const currentRecord = toRecord(current)
  const keys = orderedKeys(previousRecord, currentRecord)
  const fields = keys.filter(
    (key) => !supported.has(key) && snapshotJson(previousRecord[key]) !== snapshotJson(currentRecord[key]),
  )
  fields.push(...changedUnsupportedChatScriptstateFields(previousRecord.scriptstate, currentRecord.scriptstate))
  return fields
}

export function assertNoUnsupportedCharacterChanges(previous: unknown, current: unknown, apiName: string): void {
  const fields = changedUnsupportedCharacterFields(previous, current)
  if (fields.length > 0) {
    throw new Error(unsupportedFieldsMessage(apiName, 'character', fields))
  }
}

export function assertNoUnsupportedChatChanges(previous: unknown, current: unknown, apiName: string): void {
  const fields = changedUnsupportedChatFields(previous, current)
  if (fields.length > 0) {
    throw new Error(unsupportedFieldsMessage(apiName, 'chat', fields))
  }
}

function changedUnsupportedTopLevelFields(
  previous: unknown,
  current: unknown,
  unsupported: ReadonlySet<string>,
): string[] {
  const previousRecord = toRecord(previous)
  const currentRecord = toRecord(current)
  const keys = orderedKeys(previousRecord, currentRecord)
  return keys.filter(
    (key) => unsupported.has(key) && snapshotJson(previousRecord[key]) !== snapshotJson(currentRecord[key]),
  )
}

function unsupportedFieldsMessage(apiName: string, resource: string, fields: string[]): string {
  return `${apiName} cannot update unsupported ${resource} fields in server-backed mode: ${fields.join(', ')}`
}

function orderedKeys(previous: Record<string, unknown>, current: Record<string, unknown>): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const record of [previous, current]) {
    for (const key of Object.keys(record)) {
      if (seen.has(key)) continue
      seen.add(key)
      keys.push(key)
    }
  }
  return keys
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function changedUnsupportedChatScriptstateFields(previous: unknown, current: unknown): string[] {
  if (snapshotJson(previous) === snapshotJson(current)) return []
  if (current !== undefined && !isPlainRecord(current)) return ['scriptstate']

  const previousState = toRecord(previous)
  const currentState = toRecord(current)
  const keys = orderedKeys(previousState, currentState)
  const fields: string[] = []
  for (const key of keys) {
    const currentHasKey = hasOwn(currentState, key)
    if (!currentHasKey) {
      if (key.length === 0) fields.push(formatScriptstateField(key))
      continue
    }
    if (snapshotJson(previousState[key]) === snapshotJson(currentState[key])) continue
    if (key.length === 0 || !isSupportedScriptstateValue(currentState[key])) {
      fields.push(formatScriptstateField(key))
    }
  }
  return fields
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isSupportedScriptstateValue(value: unknown): boolean {
  return (
    typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
  )
}

function formatScriptstateField(key: string): string {
  return key.length === 0 ? 'scriptstate.<empty>' : `scriptstate.${key}`
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? JSON_UNDEFINED_SNAPSHOT : snapshot
}
