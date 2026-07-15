import { lookup as dnsLookup } from 'node:dns/promises'
import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'
import net from 'node:net'

const BLOCKED_SERVICE_DOMAINS = ['risuai.xyz', 'risuai.net', 'sionyw.com'] as const
const BLOCKED_METADATA_HOSTS = new Set(['metadata', 'instance-data', 'metadata.google.internal'])

const FORBIDDEN_IPV4_ADDRESSES = (() => {
  const blockList = new net.BlockList()

  // IPv4 addresses that are not globally routable. This includes private,
  // loopback, link-local/metadata, carrier-grade NAT, benchmarking,
  // documentation, multicast, and reserved space.
  blockList.addRange('0.0.0.0', '0.255.255.255', 'ipv4')
  blockList.addRange('10.0.0.0', '10.255.255.255', 'ipv4')
  blockList.addRange('100.64.0.0', '100.127.255.255', 'ipv4')
  blockList.addRange('127.0.0.0', '127.255.255.255', 'ipv4')
  blockList.addRange('169.254.0.0', '169.254.255.255', 'ipv4')
  blockList.addRange('172.16.0.0', '172.31.255.255', 'ipv4')
  blockList.addRange('192.0.0.0', '192.0.0.255', 'ipv4')
  blockList.addRange('192.0.2.0', '192.0.2.255', 'ipv4')
  blockList.addRange('192.168.0.0', '192.168.255.255', 'ipv4')
  blockList.addRange('198.18.0.0', '198.19.255.255', 'ipv4')
  blockList.addRange('198.51.100.0', '198.51.100.255', 'ipv4')
  blockList.addRange('203.0.113.0', '203.0.113.255', 'ipv4')
  blockList.addRange('224.0.0.0', '255.255.255.255', 'ipv4')

  return blockList
})()

const FORBIDDEN_IPV6_ADDRESSES = (() => {
  const blockList = new net.BlockList()
  // IPv6 non-public ranges plus transition forms that can encode an IPv4
  // private target. Mapped IPv4 remains usable through its ordinary public
  // IPv4 spelling, so blocking the entire mapped prefix is compatibility-safe.
  blockList.addRange('::', '::ffff:ffff', 'ipv6')
  blockList.addRange('::ffff:0:0', '::ffff:ffff:ffff', 'ipv6')
  blockList.addRange('64:ff9b::', '64:ff9b::ffff:ffff', 'ipv6')
  blockList.addRange('64:ff9b:1::', '64:ff9b:1:ffff:ffff:ffff:ffff:ffff', 'ipv6')
  blockList.addRange('100::', '100::ffff:ffff:ffff:ffff', 'ipv6')
  blockList.addSubnet('2001::', 32, 'ipv6')
  blockList.addSubnet('2001:2::', 48, 'ipv6')
  blockList.addSubnet('2001:10::', 28, 'ipv6')
  blockList.addSubnet('2001:20::', 28, 'ipv6')
  blockList.addRange('2001:db8::', '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff', 'ipv6')
  blockList.addRange('2002::', '2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'ipv6')
  blockList.addSubnet('3fff::', 20, 'ipv6')
  blockList.addSubnet('5f00::', 16, 'ipv6')
  blockList.addRange('fc00::', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'ipv6')
  blockList.addRange('fe80::', 'febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'ipv6')
  blockList.addSubnet('fec0::', 10, 'ipv6')
  blockList.addRange('ff00::', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'ipv6')
  return blockList
})()

export interface PluginDnsAddress {
  address: string
  family: 4 | 6
}

export type PluginDnsResolver = (hostname: string) => Promise<readonly PluginDnsAddress[]>

export interface ResolvedPluginNetworkTarget {
  url: URL
  address: string
  family: 4 | 6
}

export class PluginNetworkTargetError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 403 | 502,
  ) {
    super(message)
    this.name = 'PluginNetworkTargetError'
  }
}

function normalizeHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .split('%')[0]
}

function isBlockedServiceHostname(hostname: string): boolean {
  return BLOCKED_SERVICE_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
}

export function isForbiddenPluginNetworkAddress(address: string): boolean {
  const normalized = normalizeHostname(address)
  const family = net.isIP(normalized)
  if (family === 4) return FORBIDDEN_IPV4_ADDRESSES.check(normalized, 'ipv4')
  if (family === 6) return FORBIDDEN_IPV6_ADDRESSES.check(normalized, 'ipv6')
  return true
}

const defaultResolver: PluginDnsResolver = async (hostname) => {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true })
  return addresses
    .filter((entry): entry is { address: string; family: 4 | 6 } => entry.family === 4 || entry.family === 6)
    .map((entry) => ({ address: entry.address, family: entry.family }))
}

/**
 * Parses and resolves a plugin target once. Every returned address must be
 * public; the selected address is then pinned into the actual connection so a
 * second DNS answer cannot pivot the request into a private network.
 */
export async function resolvePluginNetworkTarget(
  rawUrl: unknown,
  resolver: PluginDnsResolver = defaultResolver,
): Promise<ResolvedPluginNetworkTarget> {
  if (typeof rawUrl !== 'string') {
    throw new PluginNetworkTargetError('Plugin network URL must be a string', 400)
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new PluginNetworkTargetError('Plugin network URL is invalid', 400)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PluginNetworkTargetError('Plugin network requests only support HTTP and HTTPS', 400)
  }
  if (url.username || url.password) {
    throw new PluginNetworkTargetError('Plugin network URLs cannot contain credentials', 400)
  }

  const hostname = normalizeHostname(url.hostname)
  const literalFamily = net.isIP(hostname)
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home.arpa') ||
    (!hostname.includes('.') && literalFamily === 0) ||
    BLOCKED_METADATA_HOSTS.has(hostname) ||
    isBlockedServiceHostname(hostname)
  ) {
    throw new PluginNetworkTargetError('Plugin network target is not public', 403)
  }

  let addresses: readonly PluginDnsAddress[]
  try {
    addresses = literalFamily ? [{ address: hostname, family: literalFamily as 4 | 6 }] : await resolver(hostname)
  } catch {
    throw new PluginNetworkTargetError('Plugin network target could not be resolved', 502)
  }

  if (addresses.length === 0) {
    throw new PluginNetworkTargetError('Plugin network target could not be resolved', 502)
  }
  if (addresses.some((entry) => isForbiddenPluginNetworkAddress(entry.address))) {
    throw new PluginNetworkTargetError('Plugin network target resolved to a non-public address', 403)
  }

  const selected = addresses[0]
  return { url, address: selected.address, family: selected.family }
}

export interface PluginNetworkRequestOptions {
  method: string
  headers: Record<string, string>
  body?: Buffer
  signal?: AbortSignal
}

export const PLUGIN_NETWORK_MAX_REDIRECTS = 5

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])
const CROSS_ORIGIN_SENSITIVE_HEADERS = new Set([
  'api-key',
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-api-key',
  'x-goog-api-key',
])
const REQUEST_BODY_HEADERS = new Set([
  'content-encoding',
  'content-language',
  'content-length',
  'content-location',
  'content-type',
  'transfer-encoding',
])

function removeHeaders(headers: Record<string, string>, blocked: ReadonlySet<string>): void {
  for (const name of Object.keys(headers)) {
    if (blocked.has(name.toLowerCase())) delete headers[name]
  }
}

function redirectRequestOptions(
  statusCode: number,
  source: URL,
  destination: URL,
  current: PluginNetworkRequestOptions,
): PluginNetworkRequestOptions {
  let method = current.method
  let body = current.body
  const normalizedMethod = method.toUpperCase()
  if (
    ((statusCode === 301 || statusCode === 302) && normalizedMethod === 'POST') ||
    (statusCode === 303 && normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD')
  ) {
    method = 'GET'
    body = undefined
  }

  const headers = { ...current.headers }
  if (body === undefined && current.body !== undefined) removeHeaders(headers, REQUEST_BODY_HEADERS)
  if (source.origin !== destination.origin) removeHeaders(headers, CROSS_ORIGIN_SENSITIVE_HEADERS)
  return { ...current, method, body, headers }
}

/** Makes exactly one DNS-pinned HTTP hop. Node's request API never follows redirects. */
export function requestResolvedPluginNetworkTarget(
  target: ResolvedPluginNetworkTarget,
  options: PluginNetworkRequestOptions,
): Promise<IncomingMessage> {
  const transport = target.url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const request = transport.request(
      target.url,
      {
        // Never reuse a socket from an earlier DNS answer. Every hop must
        // create a fresh connection to the address selected above.
        agent: false,
        method: options.method,
        headers: options.headers,
        signal: options.signal,
        lookup: (_hostname, _lookupOptions, callback) => {
          if (typeof _lookupOptions === 'object' && _lookupOptions.all) {
            callback(null, [{ address: target.address, family: target.family }])
          } else {
            callback(null, target.address, target.family)
          }
        },
      },
      (response) => {
        const onAbort = (): void => {
          response.destroy()
        }
        if (options.signal?.aborted) {
          onAbort()
        } else {
          options.signal?.addEventListener('abort', onAbort, { once: true })
        }
        response.once('close', () => options.signal?.removeEventListener('abort', onAbort))
        resolve(response)
      },
    )
    request.once('error', reject)
    request.end(options.body)
  })
}

export interface PluginNetworkRedirectDependencies {
  resolveTarget(rawUrl: string): Promise<ResolvedPluginNetworkTarget>
  requestTarget(target: ResolvedPluginNetworkTarget, options: PluginNetworkRequestOptions): Promise<IncomingMessage>
}

const defaultRedirectDependencies: PluginNetworkRedirectDependencies = {
  resolveTarget: (rawUrl) => resolvePluginNetworkTarget(rawUrl),
  requestTarget: requestResolvedPluginNetworkTarget,
}

function createPluginNetworkAbortError(): Error {
  const error = new Error('Plugin network request aborted')
  error.name = 'AbortError'
  return error
}

function runAbortable<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation()
  if (signal.aborted) return Promise.reject(createPluginNetworkAbortError())

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup()
      reject(createPluginNetworkAbortError())
    }
    const cleanup = (): void => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })

    operation().then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}

/**
 * Follows a small, fetch-compatible redirect chain. Resolution and connection
 * pinning are repeated for every hop, so a public redirect cannot pivot into a
 * loopback/private/metadata address.
 */
export async function requestPluginNetworkWithRedirects(
  rawUrl: string,
  options: PluginNetworkRequestOptions,
  dependencies: PluginNetworkRedirectDependencies = defaultRedirectDependencies,
): Promise<IncomingMessage> {
  let target = await runAbortable(() => dependencies.resolveTarget(rawUrl), options.signal)
  let requestOptions: PluginNetworkRequestOptions = {
    ...options,
    headers: { ...options.headers },
  }

  for (let redirectCount = 0; ; redirectCount += 1) {
    const upstream = await dependencies.requestTarget(target, requestOptions)
    const statusCode = upstream.statusCode ?? 0
    const location = Array.isArray(upstream.headers.location) ? upstream.headers.location[0] : upstream.headers.location
    if (!REDIRECT_STATUS.has(statusCode) || !location) return upstream

    if (redirectCount >= PLUGIN_NETWORK_MAX_REDIRECTS) {
      upstream.destroy()
      throw new PluginNetworkTargetError('Plugin network request exceeded the redirect limit', 502)
    }

    let destinationUrl: URL
    try {
      destinationUrl = new URL(location, target.url)
    } catch {
      upstream.destroy()
      throw new PluginNetworkTargetError('Plugin network redirect URL is invalid', 502)
    }

    // Redirect bodies are irrelevant and may be unbounded. Destroy this hop
    // before resolving/starting the next one so redirect chains cannot leave
    // several bodies draining in parallel.
    upstream.destroy()
    requestOptions = redirectRequestOptions(statusCode, target.url, destinationUrl, requestOptions)
    target = await runAbortable(() => dependencies.resolveTarget(destinationUrl.href), options.signal)
  }
}
