import { ValidationError } from '../repository.js'

export const RISU_SERVER_DATA_KEY = '__risuServerData'

export interface PortableMemoryLegacySummaryTombstone {
  summaryId: string
  chatId: string
  deletedAt: string
}

export interface RisuServerPortableMetadata {
  version: 1
  memoryLegacySummaryTombstones: PortableMemoryLegacySummaryTombstone[]
}

export function emptyRisuServerPortableMetadata(): RisuServerPortableMetadata {
  return {
    version: 1,
    memoryLegacySummaryTombstones: [],
  }
}

export function validateRisuServerPortableMetadata(value: unknown): RisuServerPortableMetadata {
  if (!isPlainObject(value)) {
    throw new ValidationError(`${RISU_SERVER_DATA_KEY} must be a plain object`)
  }
  if (value.version !== 1) {
    throw new ValidationError(`${RISU_SERVER_DATA_KEY}.version must be 1`)
  }
  if (!Array.isArray(value.memoryLegacySummaryTombstones)) {
    throw new ValidationError(`${RISU_SERVER_DATA_KEY}.memoryLegacySummaryTombstones must be an array`)
  }

  const summaryIds = new Set<string>()
  const memoryLegacySummaryTombstones = value.memoryLegacySummaryTombstones.map((row, index) => {
    if (!isPlainObject(row)) {
      throw new ValidationError(`${RISU_SERVER_DATA_KEY}.memoryLegacySummaryTombstones[${index}] must be an object`)
    }
    const summaryId = readNonEmptyString(row.summaryId, `memoryLegacySummaryTombstones[${index}].summaryId`)
    const chatId = readNonEmptyString(row.chatId, `memoryLegacySummaryTombstones[${index}].chatId`)
    const deletedAt = readNonEmptyString(row.deletedAt, `memoryLegacySummaryTombstones[${index}].deletedAt`)
    if (summaryIds.has(summaryId)) {
      throw new ValidationError(`${RISU_SERVER_DATA_KEY}.memoryLegacySummaryTombstones summaryId values must be unique`)
    }
    summaryIds.add(summaryId)
    return { summaryId, chatId, deletedAt }
  })

  return {
    version: 1,
    memoryLegacySummaryTombstones,
  }
}

function readNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${RISU_SERVER_DATA_KEY}.${field} must be a non-empty string`)
  }
  return value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
