import type { FastifyInstance } from 'fastify'
import { STORAGE_USAGE_ENDPOINT, type StorageUsageResponse } from '@risuai/protocol/storage-usage'
import type { AuthState } from '../auth.js'
import { requireAuth } from '../http.js'
import { measureStorageUsage } from '../storageUsage.js'
import { storageUsageRateLimit } from '../routeRateLimits.js'

export function registerStorageUsageRoutes(app: FastifyInstance, authState: AuthState, dataDir: string): void {
  let pending: Promise<StorageUsageResponse> | undefined
  const controller = new AbortController()
  app.addHook('preClose', async () => {
    controller.abort()
  })
  app.addHook('onClose', async () => {
    await pending?.catch(() => {})
  })
  app.get(STORAGE_USAGE_ENDPOINT, { config: { rateLimit: storageUsageRateLimit } }, async (req, reply) => {
    reply.header('cache-control', 'no-store')
    if (!(await requireAuth(authState, req, reply))) return
    // Coalesce simultaneous readers. Completed results are never cached.
    pending ??= measureStorageUsage(dataDir, controller.signal).finally(() => {
      pending = undefined
    })
    return pending
  })
}
