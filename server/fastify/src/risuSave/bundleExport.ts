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

const RISU_PATH = 'database.risu'
const MANIFEST_PATH = 'manifest.json'
const ASSET_PREFIX = 'assets'
const ZIP_MTIME = new Date('1980-01-01T00:00:00.000Z')
const EMPTY_CHUNK = new Uint8Array()

export function buildRepositoryRisuSaveBundleExport(
  input: RisuSaveBundleExportInput,
): RisuSaveBundleExport {
  const report = buildRisuSaveAssetReport(input.persisted.database, input.persisted.assets)
  const assetsById = new Map(input.persisted.assets.map((asset) => [asset.id, asset]))
  const includedAssets: RisuSaveBundleAssetEntry[] = []
  const missingFiles: RisuSaveBundleMissingFileEntry[] = []
  const assetEntries: Array<{ bundlePath: string; diskPath: string }> = []

  for (const reference of report.referenced) {
    const asset = assetsById.get(reference.id)
    if (!asset) continue
    const bundlePath = `${ASSET_PREFIX}/${asset.id}.${asset.ext}`
    const diskPath = assetPath(input.dataDir, asset)
    if (!fs.existsSync(diskPath)) {
      missingFiles.push({ ...asset, path: bundlePath })
      continue
    }
    assetEntries.push({ bundlePath, diskPath })
    includedAssets.push({ ...asset, path: bundlePath })
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
  void writeBundleZipStream(stream, input.risuBytes, manifest, assetEntries)

  return {
    stream,
    manifest,
  }
}

async function writeBundleZipStream(
  stream: PassThrough,
  risuBytes: Uint8Array,
  manifest: RisuSaveBundleManifest,
  assetEntries: Array<{ bundlePath: string; diskPath: string }>,
): Promise<void> {
  let outputReady: Promise<void> = Promise.resolve()
  const zip = new fflate.Zip((err, chunk, final) => {
    if (err) {
      stream.destroy(err)
      return
    }
    if (chunk.length > 0 && !stream.write(chunk)) {
      outputReady = once(stream, 'drain').then(() => undefined)
    }
    if (final) stream.end()
  })

  try {
    await addBufferEntry(zip, () => outputReady, RISU_PATH, risuBytes)
    for (const entry of assetEntries) {
      await addFileEntry(zip, () => outputReady, entry.bundlePath, entry.diskPath)
    }
    await addBufferEntry(
      zip,
      () => outputReady,
      MANIFEST_PATH,
      Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
    )
    zip.end()
  } catch (err) {
    zip.terminate()
    stream.destroy(err instanceof Error ? err : new Error('Failed to build .risu bundle export'))
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
): Promise<void> {
  const entry = new fflate.ZipPassThrough(filename)
  entry.mtime = ZIP_MTIME
  zip.add(entry)
  for await (const chunk of fs.createReadStream(diskPath)) {
    entry.push(chunk, false)
    await readOutputReady()
  }
  entry.push(EMPTY_CHUNK, true)
  await readOutputReady()
}
