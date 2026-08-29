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
 * Read the real runtime bootstrap plus the message-free database projection
 * composed from the named settings, collections, and character resources.
 * The production bootstrap JSON is left untouched; callers must explicitly use
 * `resourceDatabase` when asserting the composed resource state.
 */
export async function injectComposedResourceDatabase(app: FastifyInstance, options: InjectOptions) {
  if (options.method !== 'GET' || options.url !== '/api/v1/bootstrap') {
    throw new Error('Composed resource reads require GET /api/v1/bootstrap')
  }

  const response = await app.inject(options)
  const resourceDatabase =
    response.statusCode === 200
      ? await readResourceDatabaseFromInject(app.inject.bind(app), options.headers, response.json<RuntimeBootstrap>())
      : null
  // `inject().json()` was historically untyped in these broad integration
  // suites. Preserve that test ergonomics while keeping the wire body and the
  // explicit composed projection as separate values.
  return Object.assign(response, { resourceDatabase: resourceDatabase as any })
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
