import type { DatabaseSync } from 'node:sqlite'
import { ValidationError, assetById, isValidAssetId } from '../repository.js'

type JsonRecord = Record<string, unknown>

const CLEARABLE_ASSET_VALUES = new Set(['', '-'])

export function validateOptionalServerAssetRef(
  db: DatabaseSync,
  value: unknown,
  label: string,
): void {
  if (value === undefined || value === null) return
  if (typeof value !== 'string') {
    throw new ValidationError(`${label} must be a server asset id`)
  }
  if (CLEARABLE_ASSET_VALUES.has(value)) return
  validateServerAssetId(db, value, label)
}

export function validateServerAssetId(db: DatabaseSync, value: string, label: string): void {
  if (!isValidAssetId(value)) {
    throw new ValidationError(`${label} must be a server asset id`)
  }
  if (!assetById(db, value)) {
    throw new ValidationError(`${label} references a missing server asset`)
  }
}

export function validateAssetTriples(db: DatabaseSync, value: unknown, label: string): void {
  if (value === undefined || value === null) return
  if (!Array.isArray(value)) {
    throw new ValidationError(`${label} must be an array`)
  }
  value.forEach((entry, index) => {
    if (!Array.isArray(entry) || entry.length < 2) {
      throw new ValidationError(`${label}[${index}] must be an asset tuple`)
    }
    if (typeof entry[0] !== 'string') {
      throw new ValidationError(`${label}[${index}][0] must be a string`)
    }
    validateServerAssetId(db, entry[1], `${label}[${index}][1]`)
    if (entry.length > 2 && typeof entry[2] !== 'string') {
      throw new ValidationError(`${label}[${index}][2] must be a string`)
    }
  })
}

export function validateEmotionImageRefs(db: DatabaseSync, value: unknown, label: string): void {
  if (value === undefined || value === null) return
  if (!Array.isArray(value)) {
    throw new ValidationError(`${label} must be an array`)
  }
  value.forEach((entry, index) => {
    if (!Array.isArray(entry) || entry.length < 2) {
      throw new ValidationError(`${label}[${index}] must be an emotion tuple`)
    }
    if (typeof entry[0] !== 'string') {
      throw new ValidationError(`${label}[${index}][0] must be a string`)
    }
    validateServerAssetId(db, entry[1], `${label}[${index}][1]`)
  })
}

export function validateCcAssetRefs(db: DatabaseSync, value: unknown, label: string): void {
  if (value === undefined || value === null) return
  if (!Array.isArray(value)) {
    throw new ValidationError(`${label} must be an array`)
  }
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ValidationError(`${label}[${index}] must be an object`)
    }
    const record = entry as JsonRecord
    for (const key of ['type', 'uri', 'name', 'ext']) {
      if (key in record && typeof record[key] !== 'string') {
        throw new ValidationError(`${label}[${index}].${key} must be a string`)
      }
    }
    validateServerAssetId(db, record.uri as string, `${label}[${index}].uri`)
  })
}

export function validateAssetIdList(db: DatabaseSync, value: unknown, label: string): void {
  if (value === undefined || value === null) return
  if (!Array.isArray(value)) {
    throw new ValidationError(`${label} must be an array`)
  }
  value.forEach((entry, index) => {
    validateServerAssetId(db, entry as string, `${label}[${index}]`)
  })
}
