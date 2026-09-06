import type { DatabaseSync } from 'node:sqlite'
import { addAsset, upsertInlayCatalogEntry } from './repository.js'

export interface ServerInlayAssetInput {
  bytes: Buffer
  contentType: string
  name?: string
}

/** Persist one generated media result through the server asset + inlay catalog pipeline. */
export function persistServerInlayAsset(db: DatabaseSync, dataDir: string, input: ServerInlayAssetInput): string {
  const added = addAsset(db, dataDir, {
    bytes: input.bytes,
    contentType: input.contentType,
  })
  upsertInlayCatalogEntry(db, {
    assetId: added.entry.id,
    aliases: [],
    name: input.name ?? added.entry.id,
  })
  return added.entry.id
}
