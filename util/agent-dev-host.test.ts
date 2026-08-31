import { describe, expect, it, vi } from 'vitest'
import { isTailscaleIpv4, resolveAgentDevHost } from './agent-dev-host.js'

describe('agent dev host resolution', () => {
  it('binds human mode to the active Tailscale IPv4 address', () => {
    expect(resolveAgentDevHost(undefined, 'human', () => '100.91.99.68')).toEqual({
      host: '100.91.99.68',
      source: 'tailscale',
    })
  })

  it('falls back to loopback when Tailscale is unavailable or returns a non-Tailscale address', () => {
    expect(resolveAgentDevHost(undefined, 'human', () => undefined)).toEqual({
      host: '127.0.0.1',
      source: 'loopback',
    })
    expect(resolveAgentDevHost(undefined, 'human', () => '203.0.113.8')).toEqual({
      host: '127.0.0.1',
      source: 'loopback',
    })
  })

  it('keeps agent mode on loopback without querying Tailscale', () => {
    const lookup = vi.fn(() => '100.91.99.68')
    expect(resolveAgentDevHost(undefined, 'agent', lookup)).toEqual({
      host: '127.0.0.1',
      source: 'loopback',
    })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('honors an explicit host without querying Tailscale', () => {
    const lookup = vi.fn(() => '100.91.99.68')
    expect(resolveAgentDevHost(' 192.0.2.10 ', 'human', lookup)).toEqual({
      host: '192.0.2.10',
      source: 'configured',
    })
    expect(lookup).not.toHaveBeenCalled()
  })
})

describe('isTailscaleIpv4', () => {
  it('accepts only the Tailscale CGNAT range', () => {
    expect(isTailscaleIpv4('100.64.0.1')).toBe(true)
    expect(isTailscaleIpv4('100.127.255.254')).toBe(true)
    expect(isTailscaleIpv4('100.63.255.255')).toBe(false)
    expect(isTailscaleIpv4('100.128.0.1')).toBe(false)
    expect(isTailscaleIpv4('127.0.0.1')).toBe(false)
  })
})
