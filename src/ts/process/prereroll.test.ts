import { afterEach, describe, expect, it } from 'vitest'
import {
  addRerolls,
  clearPrererolls,
  getPrererollBufferSize,
  PREREROLL_BUFFER_LIMIT,
  Prereroll,
  PreUnreroll,
} from './prereroll'

afterEach(() => {
  clearPrererolls()
})

describe('prereroll bounded candidate buffer', () => {
  it('advances and retreats through retained preroll candidates', () => {
    addRerolls('gen-1', ['base', 'alt-1', 'alt-2'])

    expect(Prereroll('gen-1')).toBe('alt-1')
    expect(Prereroll('gen-1')).toBe('alt-2')
    expect(PreUnreroll('gen-1')).toBe('alt-1')
    expect(PreUnreroll('gen-1')).toBe('base')
  })

  it('returns null for underflow, missing ids, and evicted ids', () => {
    addRerolls('gen-1', ['base', 'alt-1'])

    expect(PreUnreroll('gen-1')).toBeNull()
    expect(Prereroll('missing')).toBeNull()

    for (let index = 0; index <= PREREROLL_BUFFER_LIMIT; index += 1) {
      addRerolls(`evict-${index}`, [`base-${index}`, `alt-${index}`])
    }

    expect(getPrererollBufferSize()).toBeLessThanOrEqual(PREREROLL_BUFFER_LIMIT)
    expect(Prereroll('gen-1')).toBeNull()
    expect(Prereroll('evict-0')).toBeNull()
    expect(Prereroll(`evict-${PREREROLL_BUFFER_LIMIT}`)).toBe(`alt-${PREREROLL_BUFFER_LIMIT}`)
  })

  it('evicts least-recently-used entries deterministically', () => {
    for (let index = 0; index < PREREROLL_BUFFER_LIMIT; index += 1) {
      addRerolls(`gen-${index}`, [`base-${index}`, `alt-${index}`])
    }

    expect(Prereroll('gen-0')).toBe('alt-0')
    addRerolls('gen-new', ['base-new', 'alt-new'])

    expect(getPrererollBufferSize()).toBe(PREREROLL_BUFFER_LIMIT)
    expect(Prereroll('gen-1')).toBeNull()
    expect(PreUnreroll('gen-0')).toBe('base-0')
    expect(Prereroll('gen-new')).toBe('alt-new')
  })

  it('clearPrererolls drops all retained generation ids', () => {
    addRerolls('gen-1', ['base', 'alt-1'])
    addRerolls('gen-2', ['base', 'alt-2'])

    clearPrererolls()

    expect(getPrererollBufferSize()).toBe(0)
    expect(Prereroll('gen-1')).toBeNull()
    expect(Prereroll('gen-2')).toBeNull()
  })

  it('owns addRerolls input arrays', () => {
    const values = ['base', 'alt-1', 'alt-2']

    addRerolls('gen-1', values)
    values[1] = 'mutated'
    values.push('mutated-tail')

    expect(Prereroll('gen-1')).toBe('alt-1')
    expect(Prereroll('gen-1')).toBe('alt-2')
    expect(Prereroll('gen-1')).toBeNull()
  })
})
