import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { ActiveWriterState } from '../activeWriter.js'
import { registerActiveWriterSession } from '../activeWriter.js'
import type { AuthState } from '../auth.js'
import type { GenerationJobRegistry } from '../generationJobs.js'
import { requireAuth } from '../http.js'
import { getSchemaState } from '../db.js'
import {
  loadBootstrapProjectionDatabaseWithBodyCache,
  type BootstrapBodyCacheManifest,
  type BootstrapBodyCachePayload,
} from '../repository.js'
import { maskProviderSecretsInPlace } from '../providerSecrets.js'
import { emitProtocolMetric, jsonPayloadBytes } from '../protocolMetrics.js'

export const ASSET_BASE_URL = '/api/v1/assets'
export const BODY_CACHE_MANIFEST_HEADER = 'x-risu-body-cache-manifest'

export function registerBootstrapRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  authState: AuthState,
  dataDir: string,
  activeWriterState?: ActiveWriterState,
  generationJobs?: GenerationJobRegistry,
): void {
  app.get('/api/v1/bootstrap', { exposeHeadRoute: false }, async (req, reply) => {
    if (!(await requireAuth(authState, req, reply))) return
    if (activeWriterState) {
      registerActiveWriterSession(activeWriterState, req)
    }
    const { version, revision } = getSchemaState(db)
    // Ship chat stubs (metadata, no message[]); the client hydrates messages via
    // the projection endpoint when a chat opens.
    const { database, bodyCache } = loadBootstrapProjectionDatabaseWithBodyCache(
      db,
      dataDir,
      parseBodyCacheManifestHeader(req.headers[BODY_CACHE_MANIFEST_HEADER]),
    )
    maskBootstrapBodyCacheInPlace(bodyCache)
    const response = {
      revision,
      schemaVersion: version,
      // In-place mask `loadBootstrapProjectionDatabase` freshly builds this
      // object and nothing else references it, so the response skips the
      // whole-stubbed-DB JSON round-trip clone the copying mask pays.
      database: maskProviderSecretsInPlace(database),
      assetBaseUrl: ASSET_BASE_URL,
      // Transient running generations so a returning client, even after a full
      // reload, can discover and reattach. Server-memory only.
      activeGenerationJobs: generationJobs?.activeJobs() ?? [],
      bodyCache,
    }
    // Thunk `jsonPayloadBytes` re-serializes the whole bootstrap
    // payload, so the fields must only be built after the metrics-enabled guard.
    emitProtocolMetric(
      'bootstrap_projection',
      () => ({
        revision,
        payloadBytes: jsonPayloadBytes(response),
        activeGenerationJobCount: response.activeGenerationJobs.length,
      }),
      req.log,
    )
    return response
  })
}

function parseBodyCacheManifestHeader(raw: unknown): BootstrapBodyCacheManifest | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || value.trim() === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeURIComponent(value))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const epoch = record.epoch
  if (!Number.isInteger(epoch) || (epoch as number) < 1) return null
  return {
    epoch: epoch as number,
    modules: parseRevisionManifest(record.modules),
    plugins: parseRevisionManifest(record.plugins),
  }
}

function parseRevisionManifest(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [id, revision] of Object.entries(value as Record<string, unknown>)) {
    if (typeof id === 'string' && id.trim() !== '' && Number.isInteger(revision) && (revision as number) >= 0) {
      out[id] = revision as number
    }
  }
  return out
}

function maskBootstrapBodyCacheInPlace(bodyCache: BootstrapBodyCachePayload): void {
  for (const entry of [...bodyCache.modules, ...bodyCache.plugins]) {
    if (entry.body && typeof entry.body === 'object' && !Array.isArray(entry.body)) {
      maskProviderSecretsInPlace(entry.body)
    }
  }
}
