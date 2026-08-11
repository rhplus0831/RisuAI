import { describe, expect, it, vi } from 'vitest'

import { normalizeReportedClientContext, readBrowserClientContext } from './clientContext'

describe('reported browser client context', () => {
  it('normalizes bounded language and screen-width values', () => {
    expect(normalizeReportedClientContext({ browserLanguage: ' ko-KR ', screenWidth: 777.4 })).toEqual({
      browserLanguage: 'ko-KR',
      screenWidth: 777,
    })
    expect(normalizeReportedClientContext({ browserLanguage: '<script>', screenWidth: Number.NaN })).toBeUndefined()
    expect(normalizeReportedClientContext({ screenWidth: 1_000_000 })).toEqual({ screenWidth: 100_000 })
  })

  it('captures the current browser snapshot without throwing on guarded host getters', () => {
    const language = vi.spyOn(navigator, 'language', 'get').mockReturnValue('vi-VN')
    const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(640)
    try {
      expect(readBrowserClientContext()).toEqual({ browserLanguage: 'vi-VN', screenWidth: 640 })
    } finally {
      language.mockRestore()
      width.mockRestore()
    }
  })
})
