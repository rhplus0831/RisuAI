import fs from 'node:fs'
import { once } from 'node:events'
import { PassThrough } from 'node:stream'
import * as fflate from 'fflate'
import { type Persisted, type PersistedAsset, assetPath } from '../repository.js'
import {
  type RisuSaveAssetReference,
  buildRisuSaveAssetReport,
  summarizeRisuSaveAssetReport,
} from './assetReferences.js'

export interface RisuSaveBundleAssetEntry extends PersistedAsset {
  path: string
}

export interface RisuSaveBundleMissingFileEntry extends PersistedAsset {
  path: string
}

export interface RisuSaveBundleManifest {
  version: 1
  risu: {
    path: string
    envelope: string
    compression: boolean
  }
  assetReport: ReturnType<typeof summarizeRisuSaveAssetReport>
  includedAssets: RisuSaveBundleAssetEntry[]
  missingReferences: RisuSaveAssetReference[]
  missingFiles: RisuSaveBundleMissingFileEntry[]
  orphanedAssets: PersistedAsset[]
}

export interface RisuSaveBundleExportInput {
  dataDir: string
  persisted: Persisted
  risuBytes: Uint8Array
  envelope: string
  compression: boolean
}

export interface RisuSaveBundleExport {
  stream: PassThrough
  manifest: RisuSaveBundleManifest
}

interface RisuSaveBundleAssetCandidate {
  asset: PersistedAsset
  bundlePath: string
  diskPath: string
}

const RISU_PATH = 'database.risu'
const MANIFEST_PATH = 'manifest.json'
const ASSET_PREFIX = 'assets'
const ZIP_MTIME = new Date('1980-01-01T00:00:00.000Z')
const EMPTY_CHUNK = new Uint8Array()

export function buildRepositoryRisuSaveBundleExport(input: RisuSaveBundleExportInput): RisuSaveBundleExport {
  const report = buildRisuSaveAssetReport(input.persisted.database, input.persisted.assets)
  const assetsById = new Map(input.persisted.assets.map((asset) => [asset.id, asset]))
  const includedAssets: RisuSaveBundleAssetEntry[] = []
  const missingFiles: RisuSaveBundleMissingFileEntry[] = []
  const assetCandidates: RisuSaveBundleAssetCandidate[] = []

  for (const reference of report.referenced) {
    const asset = assetsById.get(reference.id)
    if (!asset) continue
    const bundlePath = `${ASSET_PREFIX}/${asset.id}.${asset.ext}`
    const diskPath = assetPath(input.dataDir, asset)
    assetCandidates.push({ asset, bundlePath, diskPath })
  }

  const manifest: RisuSaveBundleManifest = {
    version: 1,
    risu: {
      path: RISU_PATH,
      envelope: input.envelope,
      compression: input.compression,
    },
    assetReport: summarizeRisuSaveAssetReport(report),
    includedAssets,
    missingReferences: report.missing,
    missingFiles,
    orphanedAssets: report.orphaned,
  }

  const stream = new PassThrough()
  void writeBundleZipStream(stream, input.risuBytes, manifest, assetCandidates)

  return {
    stream,
    manifest,
  }
}

async function writeBundleZipStream(
  stream: PassThrough,
  risuBytes: Uint8Array,
  manifest: RisuSaveBundleManifest,
  assetCandidates: RisuSaveBundleAssetCandidate[],
): Promise<void> {
  // Audit M11: an aborted download destroys the reply stream with a clean
  // 'close' (no 'error'), which a bare `once(stream, 'drain')` never observes —
  // the entry loop would park forever, leaking the in-flight asset FD and the
  // Zip state. Track terminal stream state and make every backpressure wait
  // race against it; throwing unwinds the `for await` (destroying the read
  // stream via its async-iterator return) into the terminate/destroy catch.
  let terminal: Error | null = null
  const closeOrError = new Promise<Error>((resolve) => {
    stream.once('error', (err) => resolve(err))
    stream.once('close', () => resolve(new Error('bundle export output closed before completion')))
  }).then((err) => {
    terminal = err
    return err
  })

  let outputReady: Promise<void> = Promise.resolve()
  const zip = new fflate.Zip((err, chunk, final) => {
    if (err) {
      stream.destroy(err)
      return
    }
    // Drop output once the consumer is gone — writing to a destroyed stream
    // would raise a second, unobserved 'error'.
    if (terminal || stream.destroyed) return
    if (chunk.length > 0 && !stream.write(chunk)) {
      // Swallow rejection: a destroyed stream signals through `closeOrError`;
      // an unobserved replaced waiter must not become an unhandled rejection.
      outputReady = once(stream, 'drain').then(
        () => undefined,
        () => undefined,
      )
    }
    if (final) stream.end()
  })

  const readOutputReady = async (): Promise<void> => {
    if (terminal) throw terminal
    await Promise.race([
      outputReady,
      closeOrError.then((err) => {
        throw err
      }),
    ])
  }

  try {
    await addBufferEntry(zip, readOutputReady, RISU_PATH, risuBytes)
    for (const candidate of assetCandidates) {
      const included = await addFileEntry(zip, readOutputReady, candidate.bundlePath, candidate.diskPath)
      if (included) {
        manifest.includedAssets.push({ ...candidate.asset, path: candidate.bundlePath })
      } else {
        manifest.missingFiles.push({ ...candidate.asset, path: candidate.bundlePath })
      }
    }
    await addBufferEntry(zip, readOutputReady, MANIFEST_PATH, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'))
    zip.end()
  } catch (err) {
    zip.terminate()
    if (!stream.destroyed) {
      stream.destroy(err instanceof Error ? err : new Error('Failed to build .risu bundle export'))
    }
  }
}

async function addBufferEntry(
  zip: fflate.Zip,
  readOutputReady: () => Promise<void>,
  filename: string,
  bytes: Uint8Array,
): Promise<void> {
  const entry = new fflate.ZipPassThrough(filename)
  entry.mtime = ZIP_MTIME
  zip.add(entry)
  entry.push(bytes, true)
  await readOutputReady()
}

async function addFileEntry(
  zip: fflate.Zip,
  readOutputReady: () => Promise<void>,
  filename: string,
  diskPath: string,
): Promise<boolean> {
  let file: fs.promises.FileHandle
  try {
    file = await fs.promises.open(diskPath, 'r')
  } catch (err) {
    if (isMissingAssetOpenError(err)) return false
    throw err
  }

  const entry = new fflate.ZipPassThrough(filename)
  entry.mtime = ZIP_MTIME
  let readStream: fs.ReadStream | null = null
  try {
    zip.add(entry)
    readStream = file.createReadStream()
    for await (const chunk of readStream) {
      entry.push(chunk, false)
      await readOutputReady()
    }
    entry.push(EMPTY_CHUNK, true)
    await readOutputReady()
    return true
  } catch (err) {
    if (readStream) readStream.destroy()
    else await file.close().catch(() => {})
    throw err
  }
}

function isMissingAssetOpenError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}
