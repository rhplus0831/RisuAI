import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REGEX_OUTPUT_SIZE_LIMIT_MIB,
  MAX_REGEX_OUTPUT_SIZE_LIMIT_MIB,
  MIN_REGEX_OUTPUT_SIZE_LIMIT_MIB,
  normalizeRegexOutputSizeLimitMiB,
  regexOutputSizeLimitCodeUnits,
} from './regexOutputSizeLimit.js'

const MIB_IN_CODE_UNITS = 1024 * 1024

function normalizeRegexOutputSizeLimitMiBBeforeExtraction(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_REGEX_OUTPUT_SIZE_LIMIT_MIB
  }
  return Math.max(MIN_REGEX_OUTPUT_SIZE_LIMIT_MIB, Math.min(MAX_REGEX_OUTPUT_SIZE_LIMIT_MIB, Math.trunc(value)))
}

describe('regex output-size normalization', () => {
  it('preserves the default and bounds', () => {
    expect(DEFAULT_REGEX_OUTPUT_SIZE_LIMIT_MIB).toBe(16)
    expect(MIN_REGEX_OUTPUT_SIZE_LIMIT_MIB).toBe(1)
    expect(MAX_REGEX_OUTPUT_SIZE_LIMIT_MIB).toBe(64)
  })

  it.each([
    [undefined, 16],
    [null, 16],
    [true, 16],
    ['', 16],
    ['32', 16],
    [Number.NaN, 16],
    [Infinity, 16],
    [-Infinity, 16],
    [-4, 1],
    [0, 1],
    [1, 1],
    [8.9, 8],
    [-0.9, 1],
    [32, 32],
    [64, 64],
    [64.9, 64],
    [128, 64],
  ])('preserves the pre-extraction result for %o', (input, expected) => {
    expect(normalizeRegexOutputSizeLimitMiBBeforeExtraction(input)).toBe(expected)
    expect(normalizeRegexOutputSizeLimitMiB(input)).toBe(expected)
    expect(regexOutputSizeLimitCodeUnits(input)).toBe(expected * MIB_IN_CODE_UNITS)
  })
})
