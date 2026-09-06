import {
  STORAGE_USAGE_ENDPOINT,
  isStorageUsageResponse,
  type StorageUsageResponse,
} from '@risuai/protocol/storage-usage'
import { getNodeServerProxyAuth } from '../storage/fastifyStorage'

export async function fetchStorageUsage(signal?: AbortSignal): Promise<StorageUsageResponse> {
  const auth = await getNodeServerProxyAuth()
  const response = await fetch(STORAGE_USAGE_ENDPOINT, {
    signal,
    cache: 'no-store',
    headers: { 'risu-auth': auth },
  })
  if (!response.ok) throw new Error('storage-usage-unavailable')
  const result: unknown = await response.json()
  if (!isStorageUsageResponse(result)) throw new Error('invalid-storage-usage')
  return result
}
