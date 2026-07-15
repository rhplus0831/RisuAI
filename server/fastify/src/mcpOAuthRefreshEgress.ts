import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { Readable } from 'node:stream'

export type McpOAuthRefreshLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>

export interface McpOAuthRefreshEgressOptions {
  allowLocalTarget?: boolean
  lookup?: McpOAuthRefreshLookup
}

const blockedIpv4Addresses = new BlockList()
const blockedIpv6Addresses = new BlockList()
const localIpv4Addresses = new BlockList()
const localIpv6Addresses = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['10.0.0.0', 8],
  ['127.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const) {
  localIpv4Addresses.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['ff00::', 8],
  // Deny transition forms wholesale so an embedded private IPv4 address
  // cannot bypass the address classifier.
  ['2002::', 16],
  ['2001:db8::', 32],
  ['64:ff9b::', 96],
  ['::ffff:0:0', 96],
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, 'ipv6')
}
for (const [network, prefix] of [
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  localIpv6Addresses.addSubnet(network, prefix, 'ipv6')
}

export function isBlockedMcpOAuthRefreshAddress(address: string): boolean {
  const normalized = address.trim().replace(/%.+$/, '')
  const family = isIP(normalized)
  if (family === 4) return blockedIpv4Addresses.check(normalized, 'ipv4')
  if (family === 6) return blockedIpv6Addresses.check(normalized, 'ipv6')
  return true
}

export function isLocalMcpOAuthRefreshAddress(address: string): boolean {
  const normalized = address.trim().replace(/%.+$/, '')
  const family = isIP(normalized)
  if (family === 4) return localIpv4Addresses.check(normalized, 'ipv4')
  if (family === 6) return localIpv6Addresses.check(normalized, 'ipv6')
  return false
}

export async function resolveMcpOAuthRefreshAddresses(
  rawUrl: string,
  options: McpOAuthRefreshEgressOptions = {},
  signal?: AbortSignal,
): Promise<{ url: URL; addresses: string[] }> {
  const url = new URL(rawUrl)
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.hash) {
    throw new Error('unsafe MCP OAuth token URL')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const lowerHostname = hostname.toLowerCase()
  if (
    !options.allowLocalTarget &&
    (lowerHostname === 'localhost' || lowerHostname.endsWith('.localhost') || lowerHostname.endsWith('.local'))
  ) {
    throw new Error('unsafe MCP OAuth token URL')
  }

  let addresses: string[]
  if (isIP(hostname)) {
    addresses = [hostname]
  } else {
    const lookup = options.lookup ?? (async (host) => await dnsLookup(host, { all: true }))
    const results = await abortableLookup(lookup, hostname, signal)
    addresses = results.map((entry) => entry.address)
  }

  const allPublic = addresses.length > 0 && addresses.every((address) => !isBlockedMcpOAuthRefreshAddress(address))
  const allLocal = addresses.length > 0 && addresses.every(isLocalMcpOAuthRefreshAddress)
  if (
    (!allPublic && !(options.allowLocalTarget && allLocal)) ||
    (url.protocol === 'http:' && !(options.allowLocalTarget && allLocal))
  ) {
    throw new Error('unsafe MCP OAuth token URL')
  }
  return { url, addresses }
}

export async function fetchMcpOAuthRefreshToken(
  rawUrl: string,
  init: RequestInit,
  options: McpOAuthRefreshEgressOptions = {},
): Promise<Response> {
  const signal = init.signal ?? undefined
  const { url, addresses } = await resolveMcpOAuthRefreshAddresses(rawUrl, options, signal)
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
  return await pinnedHttpRequest(url, addresses[0], init, signal)
}

async function abortableLookup(
  lookup: McpOAuthRefreshLookup,
  hostname: string,
  signal?: AbortSignal,
): Promise<Array<{ address: string; family: number }>> {
  if (!signal) return await lookup(hostname)
  if (signal.aborted) throw new DOMException('aborted', 'AbortError')

  return await new Promise((resolve, reject) => {
    const onAbort = (): void => reject(new DOMException('aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    void lookup(hostname)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
  })
}

function pinnedHttpRequest(
  url: URL,
  pinnedAddress: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finishReject = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    const pinnedLookup = (
      _hostname: string,
      options: { all?: boolean },
      callback: (...args: unknown[]) => void,
    ): void => {
      const family = isIP(pinnedAddress)
      if (options?.all) {
        callback(null, [{ address: pinnedAddress, family }])
      } else {
        callback(null, pinnedAddress, family)
      }
    }

    const request = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = request(
      url,
      {
        method: init.method ?? 'POST',
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        lookup: pinnedLookup as never,
      },
      (response) => {
        if (settled) {
          response.destroy()
          return
        }
        settled = true
        const headers = new Headers()
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) {
            for (const entry of value) headers.append(name, entry)
          } else if (value !== undefined) {
            headers.set(name, String(value))
          }
        }
        resolve(
          new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
            status: response.statusCode ?? 502,
            headers,
          }),
        )
      },
    )

    const onAbort = (): void => {
      req.destroy(new DOMException('aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    req.once('close', () => signal?.removeEventListener('abort', onAbort))
    req.once('error', finishReject)

    if (signal?.aborted) {
      onAbort()
      return
    }
    if (typeof init.body === 'string') req.write(init.body)
    req.end()
  })
}
