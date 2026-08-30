import { describe, expect, it } from 'vitest'
import { normalizeReportedClientContext } from '@risuai/protocol/client-context'

describe('reported client-context protocol', () => {
  it('trims languages and rounds finite positive dimensions', () => {
    expect(
      normalizeReportedClientContext({ browserLanguage: ' ko-KR ', screenWidth: 777.4, screenHeight: 555.6 }),
    ).toEqual({
      browserLanguage: 'ko-KR',
      screenWidth: 777,
      screenHeight: 556,
    })
  })

  it('retains partial valid contexts and ignores unknown fields', () => {
    expect(normalizeReportedClientContext({ browserLanguage: 'en-US', screenWidth: Number.NaN, future: true })).toEqual(
      {
        browserLanguage: 'en-US',
        screenWidth: undefined,
        screenHeight: undefined,
      },
    )
    expect(normalizeReportedClientContext({ future: true, screenHeight: 480 })).toEqual({
      browserLanguage: undefined,
      screenWidth: undefined,
      screenHeight: 480,
    })
  })

  it.each([undefined, null, false, 'en-US', [], {}, { screenHeight: 0 }, { screenHeight: -1 }])(
    'normalizes an invalid or empty value to undefined',
    (value) => {
      expect(normalizeReportedClientContext(value)).toBeUndefined()
    },
  )

  it.each(['<script>', 'en_US', 'x'.repeat(129), ''])('rejects the invalid browser language %j', (browserLanguage) => {
    expect(normalizeReportedClientContext({ browserLanguage })).toBeUndefined()
  })

  it('rejects non-finite dimensions and clamps large dimensions', () => {
    expect(
      normalizeReportedClientContext({ screenWidth: Number.NaN, screenHeight: Number.POSITIVE_INFINITY }),
    ).toBeUndefined()
    expect(normalizeReportedClientContext({ screenWidth: 1_000_000, screenHeight: 1_000_000 })).toEqual({
      browserLanguage: undefined,
      screenWidth: 100_000,
      screenHeight: 100_000,
    })
  })
})
