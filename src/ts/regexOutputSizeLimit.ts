export const DEFAULT_REGEX_OUTPUT_SIZE_LIMIT_MIB = 16
export const MIN_REGEX_OUTPUT_SIZE_LIMIT_MIB = 1
export const MAX_REGEX_OUTPUT_SIZE_LIMIT_MIB = 64

const MIB_IN_CODE_UNITS = 1024 * 1024

export function normalizeRegexOutputSizeLimitMiB(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_REGEX_OUTPUT_SIZE_LIMIT_MIB
  }
  return Math.max(MIN_REGEX_OUTPUT_SIZE_LIMIT_MIB, Math.min(MAX_REGEX_OUTPUT_SIZE_LIMIT_MIB, Math.trunc(value)))
}

export function regexOutputSizeLimitCodeUnits(value: unknown): number {
  return normalizeRegexOutputSizeLimitMiB(value) * MIB_IN_CODE_UNITS
}
