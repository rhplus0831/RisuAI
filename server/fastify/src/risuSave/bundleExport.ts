import fs from 'node:fs'
import * as fflate from 'fflate'
import {
  type PersistedAsset,
  assetPath,
  loadPersisted,
} from '../repository.js'
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
  risuBytes: Uint8Array
  envelope: string
  compression: boolean
}

export interface RisuSaveBundleExport {
  bytes: Uint8Array
  manifest: RisuSaveBundleManifest
}

const RISU_PATH = 'database.risu'
const MANIFEST_PATH = 'manifest.json'
const ASSET_PREFIX = 'assets'

export function buildRepositoryRisuSaveBundleExport(
  input: RisuSaveBundleExportInput,
): RisuSaveBundleExport {
  const persisted = loadPersisted(input.dataDir)
  const report = buildRisuSaveAssetReport(persisted.database, persisted.assets)
  const assetsById = new Map(persisted.assets.map((asset) => [asset.id, asset]))
  const files: fflate.Zippable = {
    [RISU_PATH]: input.risuBytes,
  }
  const includedAssets: RisuSaveBundleAssetEntry[] = []
  const missingFiles: RisuSaveBundleMissingFileEntry[] = []

  for (const reference of report.referenced) {
    const asset = assetsById.get(reference.id)
    if (!asset) continue
    const bundlePath = `${ASSET_PREFIX}/${asset.id}.${asset.ext}`
    const diskPath = assetPath(input.dataDir, asset)
    if (!fs.existsSync(diskPath)) {
      missingFiles.push({ ...asset, path: bundlePath })
      continue
    }
    files[bundlePath] = fs.readFileSync(diskPath)
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

  files[MANIFEST_PATH] = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')

  return {
    bytes: fflate.zipSync(files, { level: 0, mtime: new Date('1980-01-01T00:00:00.000Z') }),
    manifest,
  }
}
