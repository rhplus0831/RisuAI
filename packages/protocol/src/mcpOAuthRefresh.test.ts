import { describe, expect, it } from 'vitest'
import { isMcpOAuthRefreshRequest, isMcpOAuthRefreshSuccess } from '@risuai/protocol/mcp-oauth-refresh'

describe('MCP OAuth refresh protocol', () => {
  it('accepts the exact stored-refresh identity request', () => {
    expect(isMcpOAuthRefreshRequest({ url: 'https://mcp.example/messages' })).toBe(true)
    expect(isMcpOAuthRefreshRequest({ url: 'stdio:{"url":"http://127.0.0.1:3010/messages"}' })).toBe(true)
  })

  it('rejects missing, malformed, and additive request envelopes', () => {
    expect(isMcpOAuthRefreshRequest({})).toBe(false)
    expect(isMcpOAuthRefreshRequest({ url: 7 })).toBe(false)
    expect(
      isMcpOAuthRefreshRequest({ url: 'https://mcp.example/messages', tokenUrl: 'https://attacker.example' }),
    ).toBe(false)
  })

  it('accepts the exact access-token success envelope', () => {
    expect(isMcpOAuthRefreshSuccess({ accessToken: 'fresh-access-token' })).toBe(true)
  })

  it('rejects missing, malformed, and additive success envelopes', () => {
    expect(isMcpOAuthRefreshSuccess({})).toBe(false)
    expect(isMcpOAuthRefreshSuccess({ accessToken: null })).toBe(false)
    expect(isMcpOAuthRefreshSuccess({ accessToken: 'fresh-access-token', refreshToken: 'must-not-cross-wire' })).toBe(
      false,
    )
  })
})
