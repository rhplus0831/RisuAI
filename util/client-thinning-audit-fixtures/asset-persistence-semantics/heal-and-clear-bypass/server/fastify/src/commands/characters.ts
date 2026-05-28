// AEC6 fixture: character command validation covers the optional audio asset
// refs (vits and gptSoVits).
declare function validateVitsAssetRefs(dataDir: string, value: unknown): void
declare function validateGptSoVitsAssetRefs(dataDir: string, value: unknown): void

export function validateCharacterAssetRefs(
  dataDir: string,
  record: { vits?: unknown; gptSoVitsConfig?: unknown },
): void {
  validateVitsAssetRefs(dataDir, record.vits)
  validateGptSoVitsAssetRefs(dataDir, record.gptSoVitsConfig)
}
