export interface ExpandedSizeLimitOptions {
  maxExpandedBytes?: number
}

export function assertExpandedSizeWithinLimit(
  byteLength: number,
  options: ExpandedSizeLimitOptions | undefined,
  label = 'Expanded .risu payload',
): void {
  const maxExpandedBytes = options?.maxExpandedBytes
  if (
    maxExpandedBytes !== undefined &&
    Number.isFinite(maxExpandedBytes) &&
    byteLength > maxExpandedBytes
  ) {
    throw new Error(`${label} exceeds size limit`)
  }
}
