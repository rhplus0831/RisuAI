// AEC6 fixture: addAsset delegates to addAssets, but addAssets no longer heals
// a missing blob when asset metadata already exists.
import fs from 'node:fs'

declare function assetPath(dataDir: string, id: string): string

interface AddAssetArgs {
  bytes: Uint8Array
  id: string
}

interface AddAssetResult {
  id: string
}

export function addAsset(db: unknown, dataDir: string, args: AddAssetArgs): AddAssetResult {
  return addAssets(db, dataDir, [args])[0]
}

export function addAssets(_db: unknown, dataDir: string, assets: readonly AddAssetArgs[]): AddAssetResult[] {
  const results: AddAssetResult[] = []
  for (const asset of assets) {
    const existing = asset.id
    // Anti-pattern: drops the missing-blob existence guard, so it no longer
    // heals a missing blob for existing asset metadata.
    const file = assetPath(dataDir, existing)
    fs.writeFileSync(file, asset.bytes)
    results.push({ id: existing })
  }
  return results
}
