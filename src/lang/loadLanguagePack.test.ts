import { describe, expect, it } from 'vitest'
import { localeRetryUrl } from './loadLanguagePack'

describe('locale chunk retry URLs', () => {
  it('resolves a relative emitted chunk against its owning module in a nested deployment', () => {
    expect(localeRetryUrl('./ko-hash.js', 1, 'https://example.test/nested/assets/entry-hash.js')).toBe(
      'https://example.test/nested/assets/ko-hash.js?localeRetry=1',
    )
  })

  it('preserves existing query parameters and fragments while advancing the retry token', () => {
    const first = localeRetryUrl('./ko.js?existing=1#fragment', 1, 'https://example.test/assets/entry.js')
    expect(first).toBe('https://example.test/assets/ko.js?existing=1&localeRetry=1#fragment')
    expect(localeRetryUrl(first, 2, 'https://example.test/assets/entry.js')).toBe(
      'https://example.test/assets/ko.js?existing=1&localeRetry=2#fragment',
    )
  })
})
