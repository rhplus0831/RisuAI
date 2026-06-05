import { beforeEach, describe, expect, it } from 'vitest'
// Initialize the shared stores before importing the script cache helpers.
import '../stores.svelte'
import { getCompiledRegex, resetScriptCache } from './scripts'

describe('compiled regex memoization (Phase 7)', () => {
  beforeEach(() => {
    resetScriptCache()
  })

  it('returns the same RegExp instance for the same source and flags', () => {
    const first = getCompiledRegex('foo\\d+', 'g')
    const second = getCompiledRegex('foo\\d+', 'g')
    expect(second).toBe(first)
  })

  it('returns distinct instances for a different source or flags', () => {
    const base = getCompiledRegex('foo', 'g')
    expect(getCompiledRegex('bar', 'g')).not.toBe(base)
    expect(getCompiledRegex('foo', 'gi')).not.toBe(base)
  })

  it('resets lastIndex on every retrieval so a cached global regex behaves freshly', () => {
    const reg = getCompiledRegex('a', 'g')
    expect(reg.test('aaa')).toBe(true)
    // a global `.test` advances lastIndex, which would leak into the next call
    expect(reg.lastIndex).toBeGreaterThan(0)

    const reused = getCompiledRegex('a', 'g')
    expect(reused).toBe(reg)
    expect(reused.lastIndex).toBe(0)
  })

  it('a reused global regex matches identically across repeated retrievals', () => {
    const data = 'a1 a2 a3'
    const firstPass = data.replace(getCompiledRegex('a(\\d)', 'g'), '[$1]')
    const secondPass = data.replace(getCompiledRegex('a(\\d)', 'g'), '[$1]')
    const fresh = data.replace(new RegExp('a(\\d)', 'g'), '[$1]')
    expect(firstPass).toBe(fresh)
    expect(secondPass).toBe(fresh)
  })

  it('resetScriptCache clears the compiled regex cache', () => {
    const before = getCompiledRegex('z', 'g')
    resetScriptCache()
    expect(getCompiledRegex('z', 'g')).not.toBe(before)
  })
})
