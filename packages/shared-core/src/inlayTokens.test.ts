import { describe, expect, it } from 'vitest'
import { inlayTokenRegex } from './inlayTokens.js'

const INLAY_TOKEN_REGEX_BEFORE_EXTRACTION = /{{(inlay|inlayed|inlayeddata)::(.+?)}}/g

describe('inlay token matching', () => {
  it('preserves the exact matcher source and flags', () => {
    expect(inlayTokenRegex.source).toBe(INLAY_TOKEN_REGEX_BEFORE_EXTRACTION.source)
    expect(inlayTokenRegex.flags).toBe(INLAY_TOKEN_REGEX_BEFORE_EXTRACTION.flags)
  })

  it.each([
    '{{inlay::asset-1}}',
    '{{inlayed::asset-2}}',
    '{{inlayeddata::asset-3}}',
    '{{inlay::a}}/{{inlay::b}}',
    '{{inlay::}}',
    '{{inlay ::asset}}',
    '{{other::asset}}',
    '{{inlay::line\nbreak}}',
    '{{inlay::unterminated',
  ])('preserves replacement behavior for %o', (input) => {
    expect(input.replace(inlayTokenRegex, '[Image]')).toBe(
      input.replace(INLAY_TOKEN_REGEX_BEFORE_EXTRACTION, '[Image]'),
    )
  })

  it('remains reusable after matching and non-matching replacements', () => {
    expect('{{inlay::a}}'.replace(inlayTokenRegex, '[Image]')).toBe('[Image]')
    expect('no token'.replace(inlayTokenRegex, '[Image]')).toBe('no token')
    expect('{{inlayed::b}}'.replace(inlayTokenRegex, '[Image]')).toBe('[Image]')
    expect(inlayTokenRegex.lastIndex).toBe(0)
  })
})
