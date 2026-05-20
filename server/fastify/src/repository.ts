import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { bumpRevision, getSchemaState } from './db.js'

export const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'weba',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

export const SUPPORTED_ASSET_CONTENT_TYPES = Object.keys(CONTENT_TYPE_EXTENSIONS)

const SHA256_RE = /^[a-f0-9]{64}$/

export function isValidAssetId(id: string): boolean {
  return SHA256_RE.test(id)
}

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

export function assetsDir(dataDir: string): string {
  return path.join(dataDir, 'assets')
}

export function assetPath(dataDir: string, entry: PersistedAsset): string {
  return path.join(assetsDir(dataDir), `${entry.id}.${entry.ext}`)
}

export function assetById(dataDir: string, id: string): PersistedAsset | null {
  if (!isValidAssetId(id)) return null
  const persisted = loadPersisted(dataDir)
  return persisted.assets.find((a) => a.id === id) ?? null
}

export interface AddAssetResult {
  entry: PersistedAsset
  created: boolean
  revision: number
}

export function addAsset(
  db: DatabaseSync,
  dataDir: string,
  args: { bytes: Buffer; contentType: string },
): AddAssetResult {
  const ext = CONTENT_TYPE_EXTENSIONS[args.contentType]
  if (!ext) {
    throw new ValidationError(`Unsupported content-type: ${args.contentType}`)
  }
  const sha256 = createHash('sha256').update(args.bytes).digest('hex')
  const persisted = loadPersisted(dataDir)
  const existing = persisted.assets.find((a) => a.id === sha256)
  if (existing) {
    return { entry: existing, created: false, revision: getSchemaState(db).revision }
  }
  fs.mkdirSync(assetsDir(dataDir), { recursive: true })
  const file = path.join(assetsDir(dataDir), `${sha256}.${ext}`)
  fs.writeFileSync(file, args.bytes)
  const entry: PersistedAsset = {
    id: sha256,
    ext,
    size: args.bytes.length,
    contentType: args.contentType,
  }
  writePersisted(dataDir, { ...persisted, assets: [...persisted.assets, entry] })
  const revision = bumpRevision(db)
  return { entry, created: true, revision }
}

export function missingAssetIds(dataDir: string, ids: string[]): string[] {
  const persisted = loadPersisted(dataDir)
  const present = new Set(persisted.assets.map((a) => a.id))
  return ids.filter((id) => !present.has(id))
}
