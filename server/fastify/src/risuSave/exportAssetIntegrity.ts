import { createHash } from 'node:crypto'
import fs from 'node:fs'
import type { PersistedAsset } from '../repository.js'
import { ValidationError } from '../repository.js'

type ExportAssetIdentity = Pick<PersistedAsset, 'id' | 'ext' | 'size'>

export interface ExportAssetIntegrityVerifier {
  update(chunk: Uint8Array): void
  finish(): void
}

/**
 * Verify a content-addressed asset before any export response bytes are sent.
 * Missing files remain a reportable omission; present files with stale or
 * corrupt metadata fail closed instead of producing an archive that its own
 * importer will reject.
 */
export async function verifyExportAssetFile(asset: ExportAssetIdentity, diskPath: string): Promise<boolean> {
  let file: fs.promises.FileHandle
  try {
    file = await fs.promises.open(diskPath, 'r')
  } catch (err) {
    if (isMissingAssetOpenError(err)) return false
    throw err
  }

  let readStream: fs.ReadStream | null = null
  const verifier = createExportAssetIntegrityVerifier(asset)
  try {
    readStream = file.createReadStream({ autoClose: false })
    for await (const chunk of readStream) {
      verifier.update(chunk)
    }
    verifier.finish()
    return true
  } finally {
    readStream?.destroy()
    await file.close().catch(() => {})
  }
}

/** Verify the exact bytes written after the preflight, closing the mutation race. */
export function createExportAssetIntegrityVerifier(asset: ExportAssetIdentity): ExportAssetIntegrityVerifier {
  const hash = createHash('sha256')
  let size = 0
  let finished = false

  return {
    update(chunk) {
      if (finished) throw new Error('Export asset integrity verifier is finished')
      hash.update(chunk)
      size += chunk.byteLength
    },
    finish() {
      if (finished) throw new Error('Export asset integrity verifier is finished')
      finished = true
      const actualId = hash.digest('hex')
      const label = `${asset.id}.${asset.ext}`
      if (actualId !== asset.id) {
        throw new ValidationError(`Export asset ${label} failed its content hash check`)
      }
      if (size !== asset.size) {
        throw new ValidationError(`Export asset ${label} has ${size} bytes but its metadata declares ${asset.size}`)
      }
    },
  }
}

function isMissingAssetOpenError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}
