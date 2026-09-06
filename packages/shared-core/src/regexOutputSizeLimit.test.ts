import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REGEX_OUTPUT_SIZE_LIMIT_MIB,
  MAX_REGEX_OUTPUT_SIZE_LIMIT_MIB,
  MIN_REGEX_OUTPUT_SIZE_LIMIT_MIB,
  normalizeRegexOutputSizeLimitMiB,
  regexOutputSizeLimitCodeUnits,
} from './regexOutputSizeLimit.js'

const MIB_IN_CODE_UNITS = 1024 * 1024

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
  ])('normalizes %o to the expected value', (input, expected) => {
    expect(normalizeRegexOutputSizeLimitMiB(input)).toBe(expected)
    expect(regexOutputSizeLimitCodeUnits(input)).toBe(expected * MIB_IN_CODE_UNITS)
  })
})
