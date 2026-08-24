import type { FastifyInstance, InjectOptions } from 'fastify'

type JsonRecord = Record<string, unknown>

export interface RuntimeBootstrap extends JsonRecord {
  initialized: boolean
  revision: number
}

interface ResourceEnvelope extends JsonRecord {
  revision: number
}

type ResourceDatabase = JsonRecord | null

/**
 * Legacy server tests used bootstrap as a convenient read-after-write API. Keep
 * those assertions API-backed while the suites are migrated: this adapter adds
 * a synthetic, message-free database to successful bootstrap responses by
 * composing the three public resource reads.
 *
 * Production bootstrap remains runtime-only. Install this adapter only on a
 * test-local Fastify instance.
 */
export function installResourceDatabaseBootstrapAdapter(app: FastifyInstance): void {
  const inject = app.inject.bind(app)

  app.inject = (async (options: InjectOptions) => {
    const response = await inject(options)
    if (options.method !== 'GET' || options.url !== '/api/v1/bootstrap' || response.statusCode !== 200) {
      return response
    }

    const runtime = response.json<RuntimeBootstrap>()
    const database = await readResourceDatabaseFromInject(inject, options.headers, runtime)
    const adaptedBody = { ...runtime, database }

    return new Proxy(response, {
      get(target, property, receiver) {
        if (property === 'json') return () => adaptedBody
        return Reflect.get(target, property, receiver)
      },
    })
  }) as FastifyInstance['inject']
}

export async function readResourceDatabaseFromFetch(
  baseUrl: string,
  headers: HeadersInit,
  runtime: RuntimeBootstrap,
): Promise<ResourceDatabase> {
  if (!runtime.initialized) return null

  return readConsistentResourceDatabase(async (url) => {
    const response = await fetch(`${baseUrl}${url}`, { headers })
    if (!response.ok) {
      throw new Error(`Resource test read ${url} failed with status ${response.status}`)
    }
    return (await response.json()) as ResourceEnvelope
  })
}

async function readResourceDatabaseFromInject(
  inject: FastifyInstance['inject'],
  headers: InjectOptions['headers'],
  runtime: RuntimeBootstrap,
): Promise<ResourceDatabase> {
  if (!runtime.initialized) return null

  return readConsistentResourceDatabase(async (url) => {
    const response = await inject({ method: 'GET', url, headers })
    if (response.statusCode !== 200) {
      throw new Error(`Resource test read ${url} failed with status ${response.statusCode}: ${response.body}`)
    }
    return response.json<ResourceEnvelope>()
  })
}

async function readConsistentResourceDatabase(read: (url: string) => Promise<ResourceEnvelope>): Promise<JsonRecord> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [settings, collections, characters] = await Promise.all([
      read('/api/v1/settings'),
      read('/api/v1/collections'),
      read('/api/v1/characters/aggregate'),
    ])

    if (settings.revision !== collections.revision || settings.revision !== characters.revision) continue

    return {
      ...asRecord(settings.settings, 'settings'),
      ...asRecord(collections.collections, 'collections'),
      characters: asArray(characters.characters, 'characters'),
      characterOrder: asArray(characters.characterOrder, 'characterOrder'),
      currentChar: characters.currentChar,
    }
  }

  throw new Error('Resource test reads did not converge on one revision')
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Resource test read returned an invalid ${label} object`)
  }
  return value as JsonRecord
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Resource test read returned an invalid ${label} array`)
  return value
}
