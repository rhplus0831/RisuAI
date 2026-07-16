import { describe, expect, it } from 'vitest'
import { isTrustedLoginMessageOrigin } from './loginMessageOrigin'

describe('isTrustedLoginMessageOrigin', () => {
  const appOrigin = 'https://app.example'

  it.each(['https://sv.risuai.xyz', 'https://nightly.sv.risuai.xyz', 'http://127.0.0.1', 'http://127.0.0.1:6418'])(
    'accepts the intended callback origin %s',
    (origin) => {
      expect(isTrustedLoginMessageOrigin(origin, appOrigin)).toBe(true)
    },
  )

  it('accepts the application own origin', () => {
    expect(isTrustedLoginMessageOrigin(appOrigin, appOrigin)).toBe(true)
  })

  it('does not trust an opaque origin just because the application origin is also opaque', () => {
    expect(isTrustedLoginMessageOrigin('null', 'null')).toBe(false)
  })

  it.each([
    'https://sv.risuai.xyz.attacker.example',
    'https://nightly.sv.risuai.xyz.attacker.example',
    'https://sv.risuai.xyz:444',
    'http://127.0.0.1.attacker.example',
    'http://127.0.0.10',
    'not-an-origin',
    'null',
  ])('rejects a lookalike or invalid origin %s', (origin) => {
    expect(isTrustedLoginMessageOrigin(origin, appOrigin)).toBe(false)
  })
})
