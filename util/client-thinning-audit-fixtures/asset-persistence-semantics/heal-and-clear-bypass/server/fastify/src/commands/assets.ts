// AEC6 fixture: optional server asset refs preserve documented clear values
// ('', '-', and null) and otherwise validate the asset id.
export const CLEARABLE_ASSET_VALUES = ['', '-']

export function validateOptionalServerAssetRef(dataDir: string, value: unknown, label: string): void {
  if (value === null) return
  if (typeof value === 'string' && CLEARABLE_ASSET_VALUES.includes(value)) return
  if (typeof value !== 'string') {
    throw new Error(`Invalid asset ref for ${label}`)
  }
  void dataDir
}
