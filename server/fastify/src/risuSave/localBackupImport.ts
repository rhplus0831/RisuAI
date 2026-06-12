import fs from 'node:fs'
import { createHash } from 'node:crypto'
import * as fflate from 'fflate'
import { CONTENT_TYPE_EXTENSIONS, ValidationError, isValidAssetId } from '../repository.js'

const ZIP_MAGIC = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]) // "PK\x03\x04"
const MANIFEST_PATH = 'manifest.json'
const ASSET_PREFIX = 'assets/'
const RISU_SUFFIX = '.risu'
const LEGACY_DATABASE_RECORD = 'database.risudat'
const DEFAULT_ASSET_BATCH_BYTES = 48 * 1024 * 1024

export type LocalBackupFormat = 'risu-bundle-zip' | 'legacy-local-backup'

export interface LocalBackupAssetUpload {
  contentType: string
  bytes: Buffer
}

export interface DecodeLocalBackupOptions {
  /** Reject once the cumulative expanded (uncompressed) payload exceeds this. */
  maxExpandedBytes?: number
  /** Flush registered assets once a batch reaches this many raw bytes. */
  assetBatchBytes?: number
  /**
   * Persist a batch of decoded assets. Invoked synchronously as the archive
   * streams so peak memory stays bounded to roughly one batch plus the largest
   * single entry. SQLite writes are synchronous, so this can register directly.
   */
  registerAssets: (assets: LocalBackupAssetUpload[]) => void
}

export interface DecodedLocalBackup {
  format: LocalBackupFormat
  /** The embedded database bytes (`database.risu` / `database.risudat`). */
  databaseBytes: Uint8Array
  registeredAssetCount: number
}

// Extension -> content-type, derived from the canonical content-type table. Used
// to classify asset entries by filename without trusting a manifest. Media-only
// helpers below avoid mis-registering legacy cold-storage `.json` records.
const extensionContentType = buildExtensionContentTypeMap()
function buildExtensionContentTypeMap(): Map<string, string> {
  const map = new Map<string, string>()
  for (const [contentType, ext] of Object.entries(CONTENT_TYPE_EXTENSIONS)) {
    if (!map.has(ext)) map.set(ext, contentType)
  }
  return map
}

function isMediaContentType(contentType: string): boolean {
  return (
    contentType.startsWith('image/') ||
    contentType.startsWith('audio/') ||
    contentType.startsWith('video/') ||
    contentType.startsWith('font/')
  )
}

function startsWith(data: Uint8Array, prefix: Uint8Array): boolean {
  if (data.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i += 1) {
    if (data[i] !== prefix[i]) return false
  }
  return true
}

/**
 * Sniff the on-disk format of an uploaded device backup. Zip bundles start with
 * the local-file-header magic; anything else is treated as the original app's
 * `LocalWriter` `.bin` blob (which has no fixed magic).
 */
export function sniffLocalBackupFormat(head: Uint8Array): LocalBackupFormat {
  return startsWith(head, ZIP_MAGIC) ? 'risu-bundle-zip' : 'legacy-local-backup'
}

/**
 * Decode a device backup file (a `.risu.zip` bundle or a legacy `.bin`) with
 * bounded memory. Assets are registered through `registerAssets` as they
 * stream; the database bytes are returned for the caller to decode and apply.
 */
export async function decodeLocalBackup(
  filePath: string,
  options: DecodeLocalBackupOptions,
): Promise<DecodedLocalBackup> {
  const format = sniffLocalBackupFormat(readHead(filePath, ZIP_MAGIC.length))
  return format === 'risu-bundle-zip' ? decodeBundleZip(filePath, options) : decodeLegacyLocalBackup(filePath, options)
}

function readHead(filePath: string, length: number): Uint8Array {
  const fd = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const read = fs.readSync(fd, buffer, 0, length, 0)
    return buffer.subarray(0, read)
  } finally {
    fs.closeSync(fd)
  }
}

/** Accumulates assets and flushes them to `registerAssets` at a byte budget. */
class AssetBatcher {
  private pending: LocalBackupAssetUpload[] = []
  private pendingBytes = 0
  count = 0

  constructor(
    private readonly register: (assets: LocalBackupAssetUpload[]) => void,
    private readonly batchBytes: number,
  ) {}

  add(asset: LocalBackupAssetUpload): void {
    this.pending.push(asset)
    this.pendingBytes += asset.bytes.length
    this.count += 1
    if (this.pendingBytes >= this.batchBytes) this.flush()
  }

  flush(): void {
    if (this.pending.length === 0) return
    const batch = this.pending
    this.pending = []
    this.pendingBytes = 0
    this.register(batch)
  }
}

class ExpandedSizeTracker {
  private total = 0
  constructor(private readonly max: number | undefined) {}
  add(byteLength: number): void {
    this.total += byteLength
    if (this.max !== undefined && Number.isFinite(this.max) && this.total > this.max) {
      throw new ValidationError('Expanded local backup exceeds size limit')
    }
  }
}

function decodeBundleZip(filePath: string, options: DecodeLocalBackupOptions): Promise<DecodedLocalBackup> {
  const batcher = new AssetBatcher(options.registerAssets, options.assetBatchBytes ?? DEFAULT_ASSET_BATCH_BYTES)
  const sizeTracker = new ExpandedSizeTracker(options.maxExpandedBytes)
  let databaseBytes: Uint8Array | undefined
  let manifestBytes: Uint8Array | undefined

  return new Promise<DecodedLocalBackup>((resolve, reject) => {
    let settled = false
    const stream = fs.createReadStream(filePath)
    const fail = (err: unknown): void => {
      if (settled) return
      settled = true
      stream.destroy()
      reject(asValidationError(err, 'Malformed .risu bundle archive'))
    }

    const handleEntry = (name: string, bytes: Uint8Array): void => {
      if (name === MANIFEST_PATH) {
        manifestBytes = bytes
        return
      }
      if (name.startsWith(ASSET_PREFIX)) {
        batcher.add(decodeBundleAsset(name, bytes))
        return
      }
      if (name.endsWith(RISU_SUFFIX)) {
        databaseBytes = bytes
      }
      // Any other entry (directories, unexpected files) is ignored.
    }

    const unzip = new fflate.Unzip()
    unzip.register(fflate.UnzipInflate)
    unzip.onfile = (file) => {
      const chunks: Uint8Array[] = []
      file.ondata = (err, chunk, final) => {
        if (settled) return
        if (err) return fail(err)
        if (chunk && chunk.length > 0) {
          try {
            sizeTracker.add(chunk.length)
          } catch (sizeErr) {
            return fail(sizeErr)
          }
          chunks.push(chunk)
        }
        if (final) {
          try {
            handleEntry(file.name, concatChunks(chunks))
          } catch (entryErr) {
            return fail(entryErr)
          }
        }
      }
      file.start()
    }

    stream.on('data', (chunk: Buffer | string) => {
      if (settled) return
      try {
        unzip.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk, false)
      } catch (err) {
        fail(err)
      }
    })
    stream.on('error', fail)
    stream.on('end', () => {
      if (settled) return
      try {
        unzip.push(new Uint8Array(0), true)
        if (settled) return
        assertValidBundleManifest(manifestBytes)
        if (!databaseBytes) {
          throw new ValidationError('.risu bundle is missing its database.risu file')
        }
        batcher.flush()
        settled = true
        resolve({
          format: 'risu-bundle-zip',
          databaseBytes,
          registeredAssetCount: batcher.count,
        })
      } catch (err) {
        fail(err)
      }
    })
  })
}

function decodeBundleAsset(name: string, bytes: Uint8Array): LocalBackupAssetUpload {
  const rest = name.slice(ASSET_PREFIX.length)
  const dot = rest.lastIndexOf('.')
  const id = dot >= 0 ? rest.slice(0, dot) : rest
  const ext = dot >= 0 ? rest.slice(dot + 1).toLowerCase() : ''
  const contentType = extensionContentType.get(ext)
  if (!contentType) {
    throw new ValidationError(`.risu bundle asset has an unsupported extension: ${name}`)
  }
  if (!isValidAssetId(id)) {
    throw new ValidationError(`.risu bundle asset id is not a sha256 hex string: ${name}`)
  }
  const buffer = Buffer.from(bytes)
  const digest = createHash('sha256').update(buffer).digest('hex')
  if (digest !== id) {
    throw new ValidationError(`.risu bundle asset ${name} failed its content hash check`)
  }
  return { contentType, bytes: buffer }
}

function assertValidBundleManifest(manifestBytes: Uint8Array | undefined): void {
  if (!manifestBytes) {
    throw new ValidationError('.risu bundle is missing manifest.json')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(manifestBytes).toString('utf8'))
  } catch {
    throw new ValidationError('.risu bundle manifest.json is not valid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ValidationError('.risu bundle manifest.json must be an object')
  }
  if ((parsed as { version?: unknown }).version !== 1) {
    throw new ValidationError('.risu bundle manifest version must be 1')
  }
}

/**
 * Decode the original app's `LocalWriter` `.bin` blob: a sequence of
 * `[u32-LE nameLen][name][u32-LE dataLen][data]` records. The database record is
 * `database.risudat` (a legacy compressed `.risu`); media records are
 * content-addressed by the same sha256 scheme Fastify uses, so they register
 * without any reference remapping. Cold-storage and other non-media records are
 * skipped (they are browser-local concepts with no server equivalent).
 */
async function decodeLegacyLocalBackup(
  filePath: string,
  options: DecodeLocalBackupOptions,
): Promise<DecodedLocalBackup> {
  const batcher = new AssetBatcher(options.registerAssets, options.assetBatchBytes ?? DEFAULT_ASSET_BATCH_BYTES)
  const sizeTracker = new ExpandedSizeTracker(options.maxExpandedBytes)
  let databaseBytes: Uint8Array | undefined

  const fd = fs.openSync(filePath, 'r')
  try {
    const size = fs.fstatSync(fd).size
    let pos = 0
    const readChunk = (length: number, label: string): Buffer => {
      if (length < 0 || pos + length > size) {
        throw new ValidationError(`Truncated legacy backup record (${label})`)
      }
      const buffer = Buffer.alloc(length)
      let offset = 0
      while (offset < length) {
        const read = fs.readSync(fd, buffer, offset, length - offset, pos + offset)
        if (read <= 0) throw new ValidationError(`Truncated legacy backup record (${label})`)
        offset += read
      }
      pos += length
      return buffer
    }

    while (pos < size) {
      const nameLength = readChunk(4, 'name length').readUInt32LE(0)
      const name = readChunk(nameLength, 'name').toString('utf8')
      const dataLength = readChunk(4, 'data length').readUInt32LE(0)
      sizeTracker.add(dataLength)
      const data = readChunk(dataLength, 'data')

      if (name === LEGACY_DATABASE_RECORD) {
        databaseBytes = data
        continue
      }
      const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : ''
      const contentType = extensionContentType.get(ext)
      if (contentType && isMediaContentType(contentType)) {
        batcher.add({ contentType, bytes: data })
      }
      // Non-media records (e.g. cold-storage `*.json`) have no server analogue.
    }
  } finally {
    fs.closeSync(fd)
  }

  if (!databaseBytes) {
    throw new ValidationError('Legacy backup is missing its database.risudat record')
  }
  batcher.flush()
  return { format: 'legacy-local-backup', databaseBytes, registeredAssetCount: batcher.count }
}

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0]
  let total = 0
  for (const chunk of chunks) total += chunk.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function asValidationError(err: unknown, fallback: string): ValidationError {
  if (err instanceof ValidationError) return err
  return new ValidationError(err instanceof Error ? err.message : fallback)
}
