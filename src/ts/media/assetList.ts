export type AssetListEntry = readonly [name: string, assetId: string, ...metadata: unknown[]]

/**
 * Asset ids are content-addressed, so two valid rows can point at the same id.
 * Include the row position without keying on the editable display name.
 */
export function assetListRenderKey(entry: AssetListEntry, index: number): string {
  return `${index}:${entry[1]}`
}
