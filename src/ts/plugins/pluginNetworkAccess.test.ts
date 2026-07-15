import { describe, expect, it, vi } from 'vitest'

vi.mock('./pluginPermissions', () => ({
  getPluginPermission: vi.fn(),
}))

import {
  assertAllowedPluginNetworkUrl,
  createPluginNetworkAccess,
  type PluginNetworkPermissionRequester,
  type PluginNetworkTransport,
} from './pluginNetworkAccess'

function createTransport(): PluginNetworkTransport & {
  risuFetch: ReturnType<typeof vi.fn>
  nativeFetch: ReturnType<typeof vi.fn>
} {
  return {
    risuFetch: vi.fn(async () => ({ ok: true })),
    nativeFetch: vi.fn(async () => new Response('ok')),
  }
}

function permission(result: boolean): PluginNetworkPermissionRequester & ReturnType<typeof vi.fn> {
  return vi.fn(async () => result) as PluginNetworkPermissionRequester & ReturnType<typeof vi.fn>
}

const plugin = { name: 'network-plugin', script: 'console.log("v1")' }

describe('plugin network access', () => {
  it('does not invoke a transport when network consent is denied', async () => {
    const transport = createTransport()
    const requestPermission = permission(false)
    const access = createPluginNetworkAccess(plugin, transport, requestPermission)

    await expect(access.nativeFetch('https://api.example.com/data')).rejects.toThrow(/Permission/i)

    expect(requestPermission).toHaveBeenCalledWith(plugin.name, 'network', false, plugin.script, expect.any(Function))
    expect(transport.nativeFetch).not.toHaveBeenCalled()
  })

  it('allows a consented public request while discarding privileged host routing flags', async () => {
    const transport = createTransport()
    const requestPermission = permission(true)
    const access = createPluginNetworkAccess(plugin, transport, requestPermission)

    await expect(
      access.risuFetch('https://api.example.com/data', {
        body: { value: 1 },
        headers: { authorization: 'Bearer plugin-key' },
        interceptor: 'openai_streaming',
        networkRoute: 'local_network',
        plainFetchForce: true,
        useRisuToken: true,
      }),
    ).resolves.toEqual({ ok: true })

    expect(transport.risuFetch).toHaveBeenCalledWith('https://api.example.com/data', {
      body: { value: 1 },
      headers: { authorization: 'Bearer plugin-key' },
    })
  })

  it('snapshots plugin identity and normalizes tuple headers before transport', async () => {
    const mutablePlugin = { name: 'original-name', script: 'original-script' }
    const transport = createTransport()
    const requestPermission = permission(true)
    const access = createPluginNetworkAccess(mutablePlugin, transport, requestPermission)
    mutablePlugin.name = 'replacement-name'
    mutablePlugin.script = 'replacement-script'

    await access.nativeFetch('https://api.example.com/data', {
      headers: [
        ['x-first', 'one'],
        ['x-second', 'two'],
      ] as unknown as Record<string, string>,
      method: 'PATCH',
    })

    expect(requestPermission).toHaveBeenCalledWith(
      'original-name',
      'network',
      false,
      'original-script',
      expect.any(Function),
    )
    expect(transport.nativeFetch).toHaveBeenCalledWith('https://api.example.com/data', {
      headers: { 'x-first': 'one', 'x-second': 'two' },
      method: 'PATCH',
    })
  })

  it.each([
    'http://127.0.0.1:6419/api/v1/bootstrap',
    'http://2130706433/',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
    'http://[::ffff:7f00:1]/',
    'http://[::ffff:a9fe:a9fe]/',
    'http://[fec0::1]/',
    'http://metadata.google.internal/computeMetadata/v1',
    'http://instance-data/latest/meta-data',
    'https://subdomain.risuai.xyz/private',
  ])('blocks private, metadata, IPv4-in-IPv6, or RisuAI target %s before consent', async (url) => {
    const transport = createTransport()
    const requestPermission = permission(true)
    const access = createPluginNetworkAccess(plugin, transport, requestPermission)

    await expect(access.nativeFetch(url)).rejects.toThrow(/cannot access|not public/i)

    expect(requestPermission).not.toHaveBeenCalled()
    expect(transport.nativeFetch).not.toHaveBeenCalled()
  })

  it('parses hostnames instead of blocking a protected-domain substring in the path or a different suffix', () => {
    expect(() => assertAllowedPluginNetworkUrl('https://public.example/path?next=https://risuai.xyz')).not.toThrow()
    expect(() => assertAllowedPluginNetworkUrl('https://risuai.xyz.attacker.example/')).not.toThrow()
    expect(() => assertAllowedPluginNetworkUrl('https://api.risuai.xyz/')).toThrow(/cannot access/i)
  })
})
