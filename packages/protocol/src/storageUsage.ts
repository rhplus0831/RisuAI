import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const STORAGE_USAGE_ENDPOINT = '/api/v1/storage-usage'
export const STORAGE_USAGE_CATEGORIES = ['database', 'journal', 'assets', 'backups', 'legacy', 'logs', 'other'] as const

const bytes = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
export const StorageUsageResponseSchema = Type.Object({
  measuredAt: Type.Integer({ minimum: 0, maximum: 8_640_000_000_000_000 }),
  totalBytes: bytes,
  categories: Type.Object({
    database: bytes,
    journal: bytes,
    assets: bytes,
    backups: bytes,
    legacy: bytes,
    logs: bytes,
    other: bytes,
  }),
  disk: Type.Union([Type.Object({ totalBytes: bytes, availableBytes: bytes }), Type.Null()]),
  partial: Type.Boolean(),
})

export type StorageUsageResponse = Static<typeof StorageUsageResponseSchema>
export type StorageUsageCategory = (typeof STORAGE_USAGE_CATEGORIES)[number]

export function isStorageUsageResponse(value: unknown): value is StorageUsageResponse {
  return (
    Value.Check(StorageUsageResponseSchema, value) &&
    STORAGE_USAGE_CATEGORIES.reduce((sum, key) => sum + value.categories[key], 0) === value.totalBytes &&
    (value.disk === null || value.disk.availableBytes <= value.disk.totalBytes)
  )
}
