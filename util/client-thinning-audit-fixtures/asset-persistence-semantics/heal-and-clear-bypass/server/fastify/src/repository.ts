// AEC6 fixture: addAsset heals a missing blob when the asset metadata already
// exists (the file is rewritten only when it is absent).
import fs from 'node:fs'

declare function assetPath(dataDir: string, id: string): string

interface AddAssetArgs {
  bytes: Uint8Array
  id: string
}

export function addAsset(dataDir: string, existing: string, args: AddAssetArgs): void {
  const file = assetPath(dataDir, existing)
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, args.bytes)
  }
}
