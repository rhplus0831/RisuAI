// AEC6 fixture: addAsset heals a missing blob when the asset metadata already
// exists (the file is rewritten only when it is absent).
import fs from 'node:fs'

declare function assetPath(dataDir: string, id: string): string

interface AddAssetArgs {
  bytes: Uint8Array
  id: string
}

export function addAsset(dataDir: string, existing: string, args: AddAssetArgs): void {
  // Anti-pattern: drops the missing-blob existence guard, so it no longer heals
  // a missing blob for existing asset metadata (it clobbers unconditionally).
  const file = assetPath(dataDir, existing)
  fs.writeFileSync(file, args.bytes)
}
