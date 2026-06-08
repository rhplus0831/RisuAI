import fs from 'node:fs'
import { once } from 'node:events'
import { PassThrough } from 'node:stream'
import { type Persisted, type PersistedAsset, ValidationError, assetPath } from '../repository.js'
import {
  type RisuSaveAssetReference,
  buildRisuSaveAssetReport,
  summarizeRisuSaveAssetReport,
} from './assetReferences.js'

export interface RisuLocalBackupAssetEntry extends PersistedAsset {
  name: string
}

export interface RisuLocalBackupMissingFileEntry extends PersistedAsset {
  name: string
}

export interface RisuLocalBackupManifest {
  version: 1
  database: {
    record: string
    envelope: string
  }
  assetReport: ReturnType<typeof summarizeRisuSaveAssetReport>
  includedAssets: RisuLocalBackupAssetEntry[]
  missingReferences: RisuSaveAssetReference[]
  missingFiles: RisuLocalBackupMissingFileEntry[]
  orphanedAssets: PersistedAsset[]
}

export interface RisuLocalBackupExportInput {
  dataDir: string
  persisted: Persisted
  databaseBytes: Uint8Array
  envelope: string
}

export interface RisuLocalBackupExport {
  stream: PassThrough
  manifest: RisuLocalBackupManifest
}

interface RisuLocalBackupAssetCandidate {
  asset: PersistedAsset
  recordName: string
  diskPath: string
}

const DATABASE_RECORD = 'database.risudat'
const UINT32_MAX = 0xffffffff
const EMPTY_CHUNK = new Uint8Array()
const textEncoder = new TextEncoder()

export function buildRepositoryRisuLocalBackupExport(
  input: RisuLocalBackupExportInput,
): RisuLocalBackupExport {
  const report = buildRisuSaveAssetReport(input.persisted.database, input.persisted.assets)
  const assetsById = new Map(input.persisted.assets.map((asset) => [asset.id, asset]))
  const includedAssets: RisuLocalBackupAssetEntry[] = []
  const missingFiles: RisuLocalBackupMissingFileEntry[] = []
  const assetCandidates: RisuLocalBackupAssetCandidate[] = []

  for (const reference of report.referenced) {
    const asset = assetsById.get(reference.id)
    if (!asset) continue
    const recordName = `${asset.id}.${asset.ext}`
    const diskPath = assetPath(input.dataDir, asset)
    assetCandidates.push({ asset, recordName, diskPath })
  }

  const manifest: RisuLocalBackupManifest = {
    version: 1,
    database: {
      record: DATABASE_RECORD,
      envelope: input.envelope,
    },
    assetReport: summarizeRisuSaveAssetReport(report),
    includedAssets,
    missingReferences: report.missing,
    missingFiles,
    orphanedAssets: report.orphaned,
  }

  const stream = new PassThrough()
  void writeLocalBackupStream(stream, input.databaseBytes, manifest, assetCandidates)

  return { stream, manifest }
}

async function writeLocalBackupStream(
  stream: PassThrough,
  databaseBytes: Uint8Array,
  manifest: RisuLocalBackupManifest,
  assetCandidates: RisuLocalBackupAssetCandidate[],
): Promise<void> {
  let terminal: Error | null = null
  const closeOrError = new Promise<Error>((resolve) => {
    stream.once('error', (err) => resolve(err))
    stream.once('close', () =>
      resolve(new Error('local backup export output closed before completion')),
    )
  }).then((err) => {
    terminal = err
    return err
  })

  const writeBytes = async (bytes: Uint8Array): Promise<void> => {
    if (terminal) throw terminal
    if (bytes.byteLength === 0) return
    if (!stream.write(bytes)) {
      await Promise.race([
        once(stream, 'drain').then(
          () => undefined,
          () => undefined,
        ),
        closeOrError.then((err) => {
          throw err
        }),
      ])
    }
  }

  try {
    for (const candidate of assetCandidates) {
      const included = await addFileRecord(writeBytes, candidate.recordName, candidate.diskPath)
      if (included) {
        manifest.includedAssets.push({ ...candidate.asset, name: candidate.recordName })
      } else {
        manifest.missingFiles.push({ ...candidate.asset, name: candidate.recordName })
      }
    }
    await addBufferRecord(writeBytes, DATABASE_RECORD, databaseBytes)
    stream.end()
  } catch (err) {
    if (!stream.destroyed) {
      stream.destroy(err instanceof Error ? err : new Error('Failed to build local backup export'))
    }
  }
}

async function addBufferRecord(
  writeBytes: (bytes: Uint8Array) => Promise<void>,
  name: string,
  bytes: Uint8Array,
): Promise<void> {
  await writeRecordHeader(writeBytes, name, bytes.byteLength)
  await writeBytes(bytes)
}

async function addFileRecord(
  writeBytes: (bytes: Uint8Array) => Promise<void>,
  name: string,
  diskPath: string,
): Promise<boolean> {
  let file: fs.promises.FileHandle
  try {
    file = await fs.promises.open(diskPath, 'r')
  } catch (err) {
    if (isMissingAssetOpenError(err)) return false
    throw err
  }

  let stat: fs.Stats
  try {
    stat = await file.stat()
  } catch (err) {
    await file.close().catch(() => {})
    throw err
  }
  assertUint32Length(stat.size, `legacy local backup record ${name}`)
  let readStream: fs.ReadStream | null = null
  try {
    await writeRecordHeader(writeBytes, name, stat.size)
    readStream = file.createReadStream()
    for await (const chunk of readStream) {
      await writeBytes(chunk)
    }
    await writeBytes(EMPTY_CHUNK)
    return true
  } catch (err) {
    if (readStream) readStream.destroy()
    else await file.close().catch(() => {})
    throw err
  }
}

async function writeRecordHeader(
  writeBytes: (bytes: Uint8Array) => Promise<void>,
  name: string,
  dataLength: number,
): Promise<void> {
  const encodedName = textEncoder.encode(basename(name))
  assertUint32Length(encodedName.byteLength, `legacy local backup record name ${name}`)
  assertUint32Length(dataLength, `legacy local backup record ${name}`)
  await writeBytes(uint32le(encodedName.byteLength))
  await writeBytes(encodedName)
  await writeBytes(uint32le(dataLength))
}

function basename(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

function uint32le(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(4)
  buffer.writeUInt32LE(value, 0)
  return buffer
}

function assertUint32Length(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new ValidationError(`${label} is too large for the legacy .bin format`)
  }
}

function isMissingAssetOpenError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}
