import { describe, expect, it } from 'vitest'
import { isMemoryLimitMessage } from './memoryLimitMarker'

describe('isMemoryLimitMessage', () => {
  it('marks only the matching hydrated row while the setting is enabled', () => {
    expect(isMemoryLimitMessage(true, 'cutoff', 'cutoff')).toBe(true)
    expect(isMemoryLimitMessage(true, 'cutoff', 'newer')).toBe(false)
  })

  it('does not mark matching or orphaned cutoffs while disabled or absent', () => {
    expect(isMemoryLimitMessage(false, 'cutoff', 'cutoff')).toBe(false)
    expect(isMemoryLimitMessage(true, 'orphan', 'visible')).toBe(false)
    expect(isMemoryLimitMessage(true, undefined, 'visible')).toBe(false)
  })
})
