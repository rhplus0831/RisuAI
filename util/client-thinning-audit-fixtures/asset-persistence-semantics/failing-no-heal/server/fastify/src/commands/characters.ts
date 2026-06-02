// AEC6 fixture: character command validation covers the optional audio asset
// refs (vits and gptSoVits).
declare function validateVitsAssetRefs(db: string, value: unknown): void
declare function validateGptSoVitsAssetRefs(db: string, value: unknown): void

export function validateCharacterAssetRefs(
  dataDir: string,
  record: { vits?: unknown; gptSoVitsConfig?: unknown },
): void {
  validateVitsAssetRefs(db, record.vits)
  validateGptSoVitsAssetRefs(db, record.gptSoVitsConfig)
}
