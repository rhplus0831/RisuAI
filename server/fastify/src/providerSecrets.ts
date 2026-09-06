import { ValidationError } from './repository.js'
import {
  MASKED_PROVIDER_SECRET,
  PROVIDER_SECRET_PATHS,
  PROVIDER_SECRET_PATH_WILDCARD,
  maskRegisteredProviderSecretsInPlace,
  type ProviderSecretPathSegment,
} from '@risuai/shared-core/provider-secret-mask'

export { MASKED_PROVIDER_SECRET }

export const MASKED_PROVIDER_SECRET_ARRAY_ROW_REJECTED =
  'Masked provider secret placeholder cannot be resolved for an array row without stable identity'

type PathSegment = ProviderSecretPathSegment

const ARRAY_ROW_IDENTITY_KEYS: Record<string, string> = {
  authRefreshes: 'url',
  botPresets: 'id',
  characters: 'chaId',
  customModels: 'id',
  modelPresets: 'id',
  providerCredentials: 'id',
}

export function maskProviderSecrets<T>(database: T): T {
  if (!isRecord(database)) return database
  return maskProviderSecretsInPlace(cloneJsonValue(database))
}

/**
 * In-place variant of {@link maskProviderSecrets} for a caller that OWNS the
 * object — a freshly parsed/built value nothing else references (the SQLite
 * loaders' results always are). Applies the same secret paths but skips the
 * whole-object JSON round-trip clone. Never pass a caller-shared
 * object: the argument is mutated.
 */
export function maskProviderSecretsInPlace<T>(database: T): T {
  return maskRegisteredProviderSecretsInPlace(database)
}

export function resolveMaskedProviderSecretPlaceholders(
  database: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const resolved = cloneJsonValue(patch)
  if (!isRecord(database)) return resolved

  for (const path of PROVIDER_SECRET_PATHS) {
    resolvePath(database, resolved, path)
  }
  return resolved
}

function resolvePath(source: unknown, target: unknown, path: readonly PathSegment[], arrayKey?: string): void {
  if (path.length === 0) return
  const [segment, ...rest] = path

  if (segment === PROVIDER_SECRET_PATH_WILDCARD) {
    if (Array.isArray(target)) {
      resolveArrayWildcard(source, target, rest, arrayKey)
      return
    }
    if (isRecord(target)) {
      for (const key of Object.keys(target)) {
        if (rest.length === 0) {
          if (target[key] === MASKED_PROVIDER_SECRET && isRecord(source) && key in source) {
            target[key] = cloneJsonValue(source[key])
          }
        } else {
          resolvePath(isRecord(source) ? source[key] : undefined, target[key], rest)
        }
      }
    }
    return
  }

  if (!isRecord(target) || !(segment in target)) return
  if (rest.length === 0) {
    if (target[segment] === MASKED_PROVIDER_SECRET && isRecord(source) && segment in source) {
      target[segment] = cloneJsonValue(source[segment])
    }
    return
  }
  resolvePath(isRecord(source) ? source[segment] : undefined, target[segment], rest, segment)
}

function resolveArrayWildcard(
  source: unknown,
  target: unknown[],
  rest: readonly PathSegment[],
  arrayKey?: string,
): void {
  if (!target.some((row) => hasMaskedPlaceholderAtPath(row, rest))) return

  const identityKey = arrayKey ? ARRAY_ROW_IDENTITY_KEYS[arrayKey] : undefined
  if (!identityKey || !Array.isArray(source)) {
    throw new ValidationError(MASKED_PROVIDER_SECRET_ARRAY_ROW_REJECTED)
  }

  const sourceRows = buildUniqueRowIdentityMap(source, identityKey, arrayKey)
  const seenTargetIds = new Set<string>()

  for (const row of target) {
    if (!hasMaskedPlaceholderAtPath(row, rest)) continue
    const rowId = readRowIdentity(row, identityKey, arrayKey)
    if (seenTargetIds.has(rowId)) {
      throw new ValidationError(`Duplicate ${arrayKey ?? 'array'} row identity: ${rowId}`)
    }
    seenTargetIds.add(rowId)

    const sourceRow = sourceRows.get(rowId)
    if (!sourceRow) {
      throw new ValidationError(`Cannot resolve masked provider secret for unknown ${arrayKey} row: ${rowId}`)
    }
    resolvePath(sourceRow, row, rest)
  }
}

function buildUniqueRowIdentityMap(rows: unknown[], identityKey: string, arrayKey?: string): Map<string, unknown> {
  const byId = new Map<string, unknown>()
  const duplicateIds = new Set<string>()
  for (const row of rows) {
    if (!isRecord(row)) continue
    const id = row[identityKey]
    if (typeof id !== 'string' || id.length === 0) continue
    if (byId.has(id)) {
      duplicateIds.add(id)
      continue
    }
    byId.set(id, row)
  }

  if (duplicateIds.size > 0) {
    throw new ValidationError(`Duplicate ${arrayKey ?? 'array'} row identity: ${Array.from(duplicateIds).join(', ')}`)
  }
  return byId
}

function readRowIdentity(row: unknown, identityKey: string, arrayKey?: string): string {
  if (!isRecord(row) || typeof row[identityKey] !== 'string' || row[identityKey].length === 0) {
    throw new ValidationError(
      `Cannot resolve masked provider secret for ${arrayKey ?? 'array'} row without ${identityKey}`,
    )
  }
  return row[identityKey]
}

function hasMaskedPlaceholderAtPath(target: unknown, path: readonly PathSegment[]): boolean {
  if (path.length === 0) return target === MASKED_PROVIDER_SECRET
  const [segment, ...rest] = path

  if (segment === PROVIDER_SECRET_PATH_WILDCARD) {
    if (Array.isArray(target)) {
      return target.some((value) => hasMaskedPlaceholderAtPath(value, rest))
    }
    if (isRecord(target)) {
      return Object.values(target).some((value) => hasMaskedPlaceholderAtPath(value, rest))
    }
    return false
  }

  if (!isRecord(target) || !(segment in target)) return false
  return hasMaskedPlaceholderAtPath(target[segment], rest)
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
