import fs from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import * as fflate from 'fflate'
import { CONTENT_TYPE_EXTENSIONS, ValidationError, isValidAssetId } from '../repository.js'

const ZIP_MAGIC = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]) // "PK\x03\x04"
const MANIFEST_PATH = 'manifest.json'
const ASSET_PREFIX = 'assets/'
const RISU_SUFFIX = '.risu'
const BUNDLE_DATABASE_PATH = 'database.risu'
const LEGACY_DATABASE_RECORD = 'database.risudat'
export const LOCAL_BACKUP_ZIP_MAX_ENTRIES = 10_000
export const LOCAL_BACKUP_ZIP_MAX_NAME_BYTES = 1_024
// fflate emits at most once per compressed input push, but a highly compressed
// push can still expand to a multi-megabyte Uint8Array owned by fflate. Keeping
// pushes small bounds that library-owned transient; this importer neither
// copies nor retains asset output chunks after synchronously writing them.
const LOCAL_BACKUP_ZIP_INPUT_CHUNK_BYTES = 4_096

export type LocalBackupFormat = 'risu-bundle-zip' | 'legacy-local-backup'

interface LocalBackupAssetUpload {
  contentType: string
  id?: string
}

export interface DecodeLocalBackupOptions {
  /** Reject once the cumulative expanded (uncompressed) payload exceeds this. */
  maxExpandedBytes?: number
  /** Reject an embedded database before buffering more than this many bytes. */
  maxDatabaseBytes?: number
  /** Stop post-upload decode/staging when the requesting client goes away. */
  signal?: AbortSignal
}

export interface LocalBackupStagedAsset {
  id: string
  ext: string
  size: number
  contentType: string
  filePath: string
}

export interface DecodedLocalBackup {
  format: LocalBackupFormat
  /** The embedded database bytes (`database.risu` / `database.risudat`). */
  databaseBytes: Uint8Array
  includedAssetCount: number
  stagedAssets: LocalBackupStagedAsset[]
  /** Original-Risu database path -> canonical sha256 id for legacy records. */
  assetReferenceAliases: ReadonlyMap<string, string>
}

// Extension -> content-type, derived from the canonical content-type table. Used
// to classify asset entries by filename without trusting a manifest. Original
// backups may also contain unrelated/cold-storage JSON records, so non-media
// records are accepted only when their filename carries a sha256 asset id.
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
 * bounded memory. Assets are staged into sibling temp files as they stream; the
 * database bytes are returned for the caller to decode before anything touches
 * live repository assets.
 */
export async function decodeLocalBackup(
  filePath: string,
  options: DecodeLocalBackupOptions,
): Promise<DecodedLocalBackup> {
  throwIfLocalBackupAborted(options.signal)
  const format = sniffLocalBackupFormat(readHead(filePath, ZIP_MAGIC.length))
  return format === 'risu-bundle-zip' ? decodeBundleZip(filePath, options) : decodeLegacyLocalBackup(filePath, options)
}

function localBackupAbortError(): Error {
  const error = new Error('Local backup import aborted')
  error.name = 'AbortError'
  return error
}

function throwIfLocalBackupAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw localBackupAbortError()
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

class AssetStager {
  private stageDir: string | null = null
  private nextFile = 0
  private readonly activeWriters = new Set<LocalBackupAssetWriter>()
  readonly assets: LocalBackupStagedAsset[] = []

  constructor(private readonly uploadPath: string) {}

  get count(): number {
    return this.assets.length
  }

  begin(asset: LocalBackupAssetUpload): LocalBackupAssetWriter {
    const ext = CONTENT_TYPE_EXTENSIONS[asset.contentType]
    if (!ext) {
      throw new ValidationError(`Unsupported content-type: ${asset.contentType}`)
    }
    const partPath = path.join(this.dir(), `${this.nextFile}.part`)
    this.nextFile += 1
    const fd = fs.openSync(partPath, 'wx')
    const hash = createHash('sha256')
    let size = 0
    let closed = false

    const close = (): void => {
      if (closed) return
      closed = true
      fs.closeSync(fd)
    }

    let writer: LocalBackupAssetWriter
    writer = {
      write: (chunk) => {
        if (closed) throw new Error('Local backup asset writer is closed')
        hash.update(chunk)
        let offset = 0
        while (offset < chunk.length) {
          const written = fs.writeSync(fd, chunk, offset, chunk.length - offset)
          if (written <= 0) throw new Error('Could not stage local backup asset')
          offset += written
        }
        size += chunk.length
      },
      finish: () => {
        close()
        try {
          const id = hash.digest('hex')
          if (asset.id !== undefined && asset.id !== id) {
            throw new ValidationError(`.risu bundle asset ${asset.id} failed its content hash check`)
          }
          if (!isValidAssetId(id)) {
            throw new ValidationError('Local backup asset id is not a sha256 hex string')
          }
          const filePath = path.join(this.dir(), `${this.assets.length}-${id}.${ext}`)
          fs.renameSync(partPath, filePath)
          const staged = { id, ext, size, contentType: asset.contentType, filePath }
          this.assets.push(staged)
          this.activeWriters.delete(writer)
          return staged
        } catch (err) {
          this.activeWriters.delete(writer)
          fs.rmSync(partPath, { force: true })
          throw err
        }
      },
      abort: () => {
        close()
        this.activeWriters.delete(writer)
      },
    }
    this.activeWriters.add(writer)
    return writer
  }

  cleanup(): void {
    for (const writer of [...this.activeWriters]) writer.abort()
    if (this.stageDir) {
      fs.rmSync(this.stageDir, { recursive: true, force: true })
      this.stageDir = null
    }
  }

  private dir(): string {
    if (!this.stageDir) {
      this.stageDir = fs.mkdtempSync(path.join(path.dirname(this.uploadPath), 'assets-stage-'))
    }
    return this.stageDir
  }
}

interface LocalBackupAssetWriter {
  write(chunk: Uint8Array): void
  finish(): LocalBackupStagedAsset
  abort(): void
}

class ByteLimitTracker {
  private total = 0

  constructor(
    private readonly max: number | undefined,
    private readonly errorMessage: string,
  ) {}

  add(byteLength: number): void {
    this.total += byteLength
    if (this.max !== undefined && Number.isFinite(this.max) && this.total > this.max) {
      throw new ValidationError(this.errorMessage)
    }
  }
}

function decodeBundleZip(filePath: string, options: DecodeLocalBackupOptions): Promise<DecodedLocalBackup> {
  const stager = new AssetStager(filePath)
  const sizeTracker = new ExpandedSizeTracker(options.maxExpandedBytes)
  let databaseBytes: Uint8Array | undefined
  let manifestBytes: Uint8Array | undefined
  let entryCount = 0
  const entryNames = new Set<string>()

  return new Promise<DecodedLocalBackup>((resolve, reject) => {
    let settled = false
    const stream = fs.createReadStream(filePath, { highWaterMark: LOCAL_BACKUP_ZIP_INPUT_CHUNK_BYTES })
    const onAbort = (): void => fail(localBackupAbortError())
    const fail = (err: unknown): void => {
      if (settled) return
      settled = true
      stream.destroy()
      stager.cleanup()
      options.signal?.removeEventListener('abort', onAbort)
      reject(asValidationError(err, 'Malformed .risu bundle archive'))
    }

    const handleBufferedEntry = (name: string, bytes: Uint8Array): void => {
      if (name === MANIFEST_PATH) {
        manifestBytes = bytes
        return
      }
      if (name === BUNDLE_DATABASE_PATH) {
        databaseBytes = bytes
        return
      }
      if (name.endsWith(RISU_SUFFIX)) {
        throw new ValidationError(`.risu bundle database entry must be named ${BUNDLE_DATABASE_PATH}`)
      }
      // Non-asset, non-manifest, non-.risu entries are ignored; malformed asset
      // entries are rejected by `decodeBundleAsset` before their payload starts.
    }

    const unzip = new fflate.Unzip()
    unzip.register(fflate.UnzipInflate)
    unzip.onfile = (file) => {
      entryCount += 1
      if (entryCount > LOCAL_BACKUP_ZIP_MAX_ENTRIES) {
        return fail(new ValidationError(`.risu bundle exceeds ${LOCAL_BACKUP_ZIP_MAX_ENTRIES} entries`))
      }
      if (Buffer.byteLength(file.name, 'utf8') > LOCAL_BACKUP_ZIP_MAX_NAME_BYTES) {
        return fail(new ValidationError(`.risu bundle entry name exceeds ${LOCAL_BACKUP_ZIP_MAX_NAME_BYTES} bytes`))
      }
      if (entryNames.has(file.name)) {
        return fail(new ValidationError(`.risu bundle contains a duplicate entry: ${file.name}`))
      }
      entryNames.add(file.name)
      // These two control records are intentionally buffered for the existing
      // JSON/envelope decoders. Asset and unrelated entry chunks are never
      // retained here; database buffering has its own pre-materialization cap.
      const chunks: Uint8Array[] | null = file.name === MANIFEST_PATH || file.name === BUNDLE_DATABASE_PATH ? [] : null
      const databaseSizeTracker =
        file.name === BUNDLE_DATABASE_PATH
          ? new ByteLimitTracker(options.maxDatabaseBytes, 'Local backup database exceeds size limit')
          : null
      let assetWriter: LocalBackupAssetWriter | null = null
      let deferredEntryError: unknown
      if (file.name.startsWith(ASSET_PREFIX)) {
        try {
          assetWriter = stager.begin(decodeBundleAsset(file.name))
        } catch (err) {
          // Keep the prior error precedence: cumulative expanded-size and ZIP
          // integrity failures are observed while consuming the entry before a
          // malformed asset name/extension is reported at its end.
          deferredEntryError = err
        }
      }
      file.ondata = (err, chunk, final) => {
        if (settled) return
        if (options.signal?.aborted) return fail(localBackupAbortError())
        if (err) return fail(err)
        if (chunk && chunk.length > 0) {
          try {
            sizeTracker.add(chunk.length)
            databaseSizeTracker?.add(chunk.length)
            assetWriter?.write(chunk)
          } catch (sizeErr) {
            return fail(sizeErr)
          }
          chunks?.push(chunk)
        }
        if (final) {
          try {
            if (deferredEntryError) throw deferredEntryError
            if (assetWriter) assetWriter.finish()
            else if (chunks) handleBufferedEntry(file.name, concatChunks(chunks))
            else handleBufferedEntry(file.name, new Uint8Array(0))
          } catch (entryErr) {
            return fail(entryErr)
          }
        }
      }
      file.start()
    }

    stream.on('data', (chunk: Buffer | string) => {
      if (settled) return
      if (options.signal?.aborted) return fail(localBackupAbortError())
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
        settled = true
        options.signal?.removeEventListener('abort', onAbort)
        resolve({
          format: 'risu-bundle-zip',
          databaseBytes,
          includedAssetCount: stager.count,
          stagedAssets: stager.assets,
          assetReferenceAliases: new Map(),
        })
      } catch (err) {
        fail(err)
      }
    })
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted) onAbort()
  })
}

function decodeBundleAsset(name: string): LocalBackupAssetUpload {
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
  return { contentType, id }
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
 * `database.risudat` (a legacy compressed `.risu`). Recognized media records
 * are staged as before; hash-named records also retain every supported Fastify
 * asset type (including ONNX, CSS, and signature JSON). Unrelated non-media
 * records are skipped because they are browser-local concepts with no server
 * equivalent.
 */
async function decodeLegacyLocalBackup(
  filePath: string,
  options: DecodeLocalBackupOptions,
): Promise<DecodedLocalBackup> {
  const stager = new AssetStager(filePath)
  const sizeTracker = new ExpandedSizeTracker(options.maxExpandedBytes)
  const assetReferenceAliases = new Map<string, string>()
  let databaseBytes: Uint8Array | undefined

  const file = await fs.promises.open(filePath, 'r')
  try {
    const size = (await file.stat()).size
    let pos = 0
    const assertReadable = (length: number, label: string): void => {
      if (length < 0 || pos + length > size) {
        throw new ValidationError(`Truncated legacy backup record (${label})`)
      }
    }
    const readChunk = async (length: number, label: string): Promise<Buffer> => {
      assertReadable(length, label)
      const buffer = Buffer.alloc(length)
      let offset = 0
      while (offset < length) {
        const { bytesRead } = await file.read(buffer, offset, length - offset, pos + offset)
        if (bytesRead <= 0) throw new ValidationError(`Truncated legacy backup record (${label})`)
        throwIfLocalBackupAborted(options.signal)
        offset += bytesRead
      }
      pos += length
      return buffer
    }
    const consumeRecord = async (
      length: number,
      label: string,
      consume?: (chunk: Uint8Array) => void,
    ): Promise<void> => {
      assertReadable(length, label)
      if (!consume) {
        pos += length
        return
      }
      const buffer = Buffer.allocUnsafe(Math.min(length, 64 * 1024))
      let remaining = length
      while (remaining > 0) {
        throwIfLocalBackupAborted(options.signal)
        const wanted = Math.min(buffer.length, remaining)
        const { bytesRead } = await file.read(buffer, 0, wanted, pos)
        if (bytesRead <= 0) throw new ValidationError(`Truncated legacy backup record (${label})`)
        throwIfLocalBackupAborted(options.signal)
        consume(buffer.subarray(0, bytesRead))
        pos += bytesRead
        remaining -= bytesRead
      }
    }

    while (pos < size) {
      throwIfLocalBackupAborted(options.signal)
      const nameLength = (await readChunk(4, 'name length')).readUInt32LE(0)
      const name = (await readChunk(nameLength, 'name')).toString('utf8')
      const dataLength = (await readChunk(4, 'data length')).readUInt32LE(0)
      sizeTracker.add(dataLength)

      if (name === LEGACY_DATABASE_RECORD) {
        // The downstream envelope decoder still consumes one contiguous
        // database payload, so reject its declared size before allocating it.
        new ByteLimitTracker(options.maxDatabaseBytes, 'Local backup database exceeds size limit').add(dataLength)
        databaseBytes = await readChunk(dataLength, 'data')
        continue
      }
      const dot = name.lastIndexOf('.')
      const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
      const contentType = extensionContentType.get(ext)
      const namedAssetId = dot >= 0 ? contentAddressedAssetId(name.slice(0, dot)) : undefined
      if (contentType && (isMediaContentType(contentType) || namedAssetId)) {
        const writer = stager.begin({ contentType, id: namedAssetId })
        await consumeRecord(dataLength, 'data', (chunk) => writer.write(chunk))
        const staged = writer.finish()
        // LocalWriter strips the `assets/` prefix from record names while the
        // embedded database retains it. Original Risu normally uses sha256
        // names, but custom/fallback ids (notably UUIDs) are also valid. Keep
        // the exact restored path as an alias for canonicalization after the
        // database envelope is decoded.
        assetReferenceAliases.set(`${ASSET_PREFIX}${name}`, staged.id)
      } else {
        // The record bounds were checked above, so unrelated payload bytes can
        // be skipped by advancing the file position without allocating them.
        await consumeRecord(dataLength, 'data')
      }
      // Unrelated non-media records (e.g. cold-storage `*.json`) have no server analogue.
    }
  } catch (err) {
    stager.cleanup()
    throw err
  } finally {
    await file.close()
  }

  if (!databaseBytes) {
    stager.cleanup()
    throw new ValidationError('Legacy backup is missing its database.risudat record')
  }
  return {
    format: 'legacy-local-backup',
    databaseBytes,
    includedAssetCount: stager.count,
    stagedAssets: stager.assets,
    assetReferenceAliases,
  }
}

function contentAddressedAssetId(name: string): string | undefined {
  const normalized = name.toLowerCase()
  return isValidAssetId(normalized) ? normalized : undefined
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

function asValidationError(err: unknown, fallback: string): Error {
  if (err instanceof Error && err.name === 'AbortError') return err
  if (err instanceof ValidationError) return err
  return new ValidationError(err instanceof Error ? err.message : fallback)
}
