import { createHash, randomBytes } from 'node:crypto'
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

export const BACKUP_MANIFEST_VERSION = 1

export const BACKUP_ID_RE = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[a-f0-9]{6}$/

export interface BackupManifest {
  _version: number
  id: string
  label: string | null
  createdAt: string
  revision: number
  assetCount: number
}

export function isValidBackupId(id: string): boolean {
  return BACKUP_ID_RE.test(id)
}

export function generateBackupId(now: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const ts =
    `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}`
  const suffix = randomBytes(3).toString('hex')
  return `${ts}-${suffix}`
}

export function backupsDir(dataDir: string): string {
  return path.join(dataDir, 'backups')
}

export function backupDir(dataDir: string, id: string): string {
  return path.join(backupsDir(dataDir), id)
}

export function createBackup(
  db: DatabaseSync,
  dataDir: string,
  label: string | null = null,
): BackupManifest {
  const persisted = loadPersisted(dataDir)
  const { revision } = getSchemaState(db)
  const id = generateBackupId()
  const dir = backupDir(dataDir, id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(persisted))
  const manifest: BackupManifest = {
    _version: BACKUP_MANIFEST_VERSION,
    id,
    label,
    createdAt: new Date().toISOString(),
    revision,
    assetCount: persisted.assets.length,
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest))
  return manifest
}

export function listBackups(dataDir: string): BackupManifest[] {
  const root = backupsDir(dataDir)
  if (!fs.existsSync(root)) return []
  const entries = fs.readdirSync(root)
  const manifests: BackupManifest[] = []
  for (const id of entries) {
    if (!isValidBackupId(id)) continue
    const manifestPath = path.join(root, id, 'manifest.json')
    if (!fs.existsSync(manifestPath)) continue
    const raw = fs.readFileSync(manifestPath, 'utf8')
    const parsed = JSON.parse(raw) as BackupManifest
    manifests.push(parsed)
  }
  manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return manifests
}

export function restoreBackup(
  db: DatabaseSync,
  dataDir: string,
  id: string,
): { revision: number } {
  if (!isValidBackupId(id)) {
    throw new EntityNotFoundError(`Backup not found: ${id}`)
  }
  const snapshot = path.join(backupDir(dataDir, id), 'db.json')
  if (!fs.existsSync(snapshot)) {
    throw new EntityNotFoundError(`Backup not found: ${id}`)
  }
  const live = path.join(dataDir, 'db.json')
  const tmp = `${live}.tmp`
  fs.copyFileSync(snapshot, tmp)
  fs.renameSync(tmp, live)
  const revision = bumpRevision(db)
  return { revision }
}

export function deleteBackup(dataDir: string, id: string): void {
  if (!isValidBackupId(id)) {
    throw new EntityNotFoundError(`Backup not found: ${id}`)
  }
  const dir = backupDir(dataDir, id)
  if (!fs.existsSync(dir)) {
    throw new EntityNotFoundError(`Backup not found: ${id}`)
  }
  fs.rmSync(dir, { recursive: true, force: true })
}
