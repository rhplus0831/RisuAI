import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { bumpRevision } from './db.js'

export const PERSISTED_VERSION = 1

export interface PersistedAsset {
  id: string
  ext: string
  size: number
  contentType: string
}

export interface Persisted {
  _version: number
  database: unknown | null
  assets: PersistedAsset[]
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class RevisionMismatchError extends Error {
  readonly currentRevision: number
  constructor(currentRevision: number, message = 'Revision mismatch') {
    super(message)
    this.name = 'RevisionMismatchError'
    this.currentRevision = currentRevision
  }
}

export class EntityNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EntityNotFoundError'
  }
}

function dbJsonPath(dataDir: string): string {
  return path.join(dataDir, 'db.json')
}

export function emptyPersisted(): Persisted {
  return { _version: PERSISTED_VERSION, database: null, assets: [] }
}

export function loadPersisted(dataDir: string): Persisted {
  const file = dbJsonPath(dataDir)
  if (!fs.existsSync(file)) {
    return emptyPersisted()
  }
  const raw = fs.readFileSync(file, 'utf8')
  const parsed = JSON.parse(raw) as Partial<Persisted>
  const version = typeof parsed._version === 'number' ? parsed._version : PERSISTED_VERSION
  if (version > PERSISTED_VERSION) {
    throw new Error(`db.json _version ${version} is newer than supported ${PERSISTED_VERSION}`)
  }
  return {
    _version: PERSISTED_VERSION,
    database: parsed.database ?? null,
    assets: Array.isArray(parsed.assets) ? (parsed.assets as PersistedAsset[]) : [],
  }
}

export function writePersisted(dataDir: string, next: Persisted): void {
  fs.mkdirSync(dataDir, { recursive: true })
  const file = dbJsonPath(dataDir)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next))
  fs.renameSync(tmp, file)
}

export function applyImport(
  db: DatabaseSync,
  dataDir: string,
  database: unknown,
): { revision: number } {
  if (database === null || database === undefined) {
    throw new ValidationError('database payload missing')
  }
  const current = loadPersisted(dataDir)
  writePersisted(dataDir, { ...current, database })
  const revision = bumpRevision(db)
  return { revision }
}
