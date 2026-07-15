import { language } from 'src/lang'
import type { GlobalFetchArgs } from 'src/ts/globalApi.svelte'
import { getPluginPermission } from './pluginPermissions'

const BLOCKED_SERVICE_DOMAINS = ['risuai.xyz', 'risuai.net', 'sionyw.com'] as const
const BLOCKED_METADATA_HOSTS = new Set(['metadata', 'instance-data', 'metadata.google.internal'])

export interface PluginNetworkIdentity {
  name: string
  script: string
}

export interface PluginNativeFetchArgs {
  body?: string | Uint8Array | ArrayBuffer
  headers?: { [key: string]: string }
  method?: 'POST' | 'GET' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'
  signal?: AbortSignal
  useRisuTk?: boolean
  chatId?: string
  interceptor?: string
  requestTimeoutMs?: number
  networkRoute?: 'auto' | 'local_network'
  sensitive?: boolean
}

export interface PluginNetworkTransport {
  risuFetch(url: string, options?: GlobalFetchArgs): Promise<unknown>
  nativeFetch(url: string, options?: PluginNativeFetchArgs): Promise<Response>
}

export type PluginNetworkPermissionRequester = (
  pluginName: string,
  permission: 'network',
  reconfirm: false,
  runtimeScript: string,
  assertActive?: () => void,
) => Promise<boolean>

function normalizedHostname(url: URL): string {
  return url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .split('%')[0]
}

function isBlockedServiceHostname(hostname: string): boolean {
  return BLOCKED_SERVICE_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
}

function parseIPv4(hostname: string): number[] | null {
  const parts = hostname.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return null
  const values = parts.map(Number)
  return values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255) ? values : null
}

function isForbiddenIPv4(values: number[]): boolean {
  const [a, b] = values
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function mappedIPv4FromIPv6(hostname: string): number[] | null {
  if (!hostname.includes(':')) return null
  const dottedTail = hostname.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (dottedTail) return parseIPv4(dottedTail)

  const mapped = hostname.match(/^(?:::ffff:|::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (!mapped) return null
  const high = Number.parseInt(mapped[1], 16)
  const low = Number.parseInt(mapped[2], 16)
  return [high >> 8, high & 0xff, low >> 8, low & 0xff]
}

function parseIPv6Hextets(hostname: string): number[] | null {
  if (!hostname.includes(':')) return null
  const [leftText, rightText, extra] = hostname.toLowerCase().split('::')
  if (extra !== undefined) return null
  const left = leftText ? leftText.split(':') : []
  const right = rightText === undefined || rightText === '' ? [] : rightText.split(':')
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null
  const zeroCount = rightText === undefined ? 0 : 8 - left.length - right.length
  if (zeroCount < 0 || (rightText === undefined && left.length !== 8)) return null
  const parts = [...left, ...Array(zeroCount).fill('0'), ...right].map((part) => Number.parseInt(part, 16))
  return parts.length === 8 ? parts : null
}

function isForbiddenIPv6(hostname: string): boolean {
  if (!hostname.includes(':')) return false
  const host = hostname.toLowerCase()
  const mapped = mappedIPv4FromIPv6(host)
  if (mapped) return isForbiddenIPv4(mapped)
  const hextets = parseIPv6Hextets(host)
  if (!hextets) return true
  const [first, second, third, fourth, fifth, sixth] = hextets
  return (
    first === 0 ||
    (first >= 0xfc00 && first <= 0xfdff) ||
    (first >= 0xfe80 && first <= 0xfebf) ||
    (first >= 0xfec0 && first <= 0xfeff) ||
    (first >= 0xff00 && first <= 0xffff) ||
    (first === 0x100 && second === 0 && third === 0 && fourth === 0) ||
    (first === 0x64 &&
      second === 0xff9b &&
      (third === 1 || (third === 0 && fourth === 0 && fifth === 0 && sixth === 0))) ||
    first === 0x2002 ||
    (first === 0x2001 &&
      (second === 0 || (second === 2 && third === 0) || (second >= 0x10 && second <= 0x2f) || second === 0xdb8)) ||
    (first === 0x3fff && second <= 0x0fff) ||
    first === 0x5f00
  )
}

/** Browser-side fail-closed checks; Fastify repeats them after DNS resolution. */
export function assertAllowedPluginNetworkUrl(rawUrl: unknown): URL {
  if (typeof rawUrl !== 'string') throw new Error('Plugin network URL must be a string.')

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('Plugin network URL is invalid.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Plugin network requests only support HTTP and HTTPS URLs.')
  }
  if (url.username || url.password) {
    throw new Error('Plugin network URLs cannot contain credentials.')
  }

  const hostname = normalizedHostname(url)
  const ipv4 = parseIPv4(hostname)
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home.arpa') ||
    (!hostname.includes('.') && !hostname.includes(':')) ||
    BLOCKED_METADATA_HOSTS.has(hostname) ||
    isBlockedServiceHostname(hostname) ||
    (ipv4 ? isForbiddenIPv4(ipv4) : isForbiddenIPv6(hostname))
  ) {
    throw new Error('Plugin network requests cannot access private, local, metadata, or RisuAI service targets.')
  }

  return url
}

export function createPluginNetworkAccess(
  plugin: PluginNetworkIdentity | undefined,
  transport: PluginNetworkTransport,
  requestPermission: PluginNetworkPermissionRequester = getPluginPermission,
  assertActive: () => void = () => {},
): PluginNetworkTransport {
  const identity = plugin ? { name: plugin.name, script: plugin.script } : undefined
  const authorize = async (url: string): Promise<void> => {
    assertActive()
    assertAllowedPluginNetworkUrl(url)
    if (!identity) {
      throw new Error('Plugin network access requires a plugin identity.')
    }
    const allowed = await requestPermission(identity.name, 'network', false, identity.script, assertActive)
    assertActive()
    if (!allowed) throw new Error(language.permissionDenied)
  }

  return {
    async risuFetch(url, options) {
      await authorize(url)
      const {
        plainFetchForce: _plainFetchForce,
        plainFetchDeforce: _plainFetchDeforce,
        useRisuToken: _useRisuToken,
        interceptor: _interceptor,
        networkRoute: _networkRoute,
        ...publicOptions
      } = options ?? {}
      return transport.risuFetch(url, {
        ...publicOptions,
        ...(publicOptions.headers ? { headers: Object.fromEntries(new Headers(publicOptions.headers).entries()) } : {}),
      })
    },
    async nativeFetch(url, options) {
      await authorize(url)
      const {
        useRisuTk: _useRisuTk,
        interceptor: _interceptor,
        networkRoute: _networkRoute,
        ...publicOptions
      } = options ?? {}
      return transport.nativeFetch(url, {
        ...publicOptions,
        ...(publicOptions.headers
          ? { headers: Object.fromEntries(new Headers(publicOptions.headers as HeadersInit).entries()) }
          : {}),
      })
    },
  }
}

/** Standard fetch-shaped adapter used to shadow the main-window fetch in V2.1. */
export function createPluginWebFetch(networkAccess: PluginNetworkTransport): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const rawMethod = request.method.toUpperCase()
    const supportedMethods = new Set<NonNullable<PluginNativeFetchArgs['method']>>([
      'GET',
      'POST',
      'PUT',
      'DELETE',
      'PATCH',
      'HEAD',
      'OPTIONS',
    ])
    if (!supportedMethods.has(rawMethod as NonNullable<PluginNativeFetchArgs['method']>)) {
      throw new Error(`Plugin fetch method ${rawMethod} is not supported.`)
    }
    const method = rawMethod as NonNullable<PluginNativeFetchArgs['method']>

    const headers = Object.fromEntries(request.headers.entries())
    const body = method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(await request.arrayBuffer())
    return networkAccess.nativeFetch(request.url, {
      body,
      headers,
      method,
      signal: request.signal,
    })
  }
}
