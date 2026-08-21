import { describe, expect, it, vi } from 'vitest'

import { normalizeReportedClientContext, readBrowserClientContext } from './clientContext'

describe('reported browser client context', () => {
  it('normalizes bounded language and screen-dimension values', () => {
    expect(
      normalizeReportedClientContext({ browserLanguage: ' ko-KR ', screenWidth: 777.4, screenHeight: 555.6 }),
    ).toEqual({
      browserLanguage: 'ko-KR',
      screenWidth: 777,
      screenHeight: 556,
    })
    expect(
      normalizeReportedClientContext({
        browserLanguage: '<script>',
        screenWidth: Number.NaN,
        screenHeight: Number.POSITIVE_INFINITY,
      }),
    ).toBeUndefined()
    expect(normalizeReportedClientContext({ screenWidth: 1_000_000, screenHeight: 1_000_000 })).toEqual({
      screenWidth: 100_000,
      screenHeight: 100_000,
    })
    expect(normalizeReportedClientContext({ screenHeight: 0 })).toBeUndefined()
    expect(normalizeReportedClientContext({ screenHeight: -1 })).toBeUndefined()
  })

  it('captures the current browser snapshot without throwing on guarded host getters', () => {
    const language = vi.spyOn(navigator, 'language', 'get').mockReturnValue('vi-VN')
    const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(640)
    const height = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(480)
    try {
      expect(readBrowserClientContext()).toEqual({ browserLanguage: 'vi-VN', screenWidth: 640, screenHeight: 480 })
    } finally {
      language.mockRestore()
      width.mockRestore()
      height.mockRestore()
    }
  })

  it('does not throw when a screen-dimension getter throws', () => {
    const height = vi.spyOn(window, 'innerHeight', 'get').mockImplementation(() => {
      throw new Error('blocked')
    })
    try {
      expect(() => readBrowserClientContext()).not.toThrow()
    } finally {
      height.mockRestore()
    }
  })
})
