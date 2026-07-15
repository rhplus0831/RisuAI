import { pluginFetchNative } from 'src/ts/globalApi.svelte'
import { hasher } from 'src/ts/parser/parser.svelte'
import { assertAllowedPluginNetworkUrl } from './pluginNetworkAccess'
import { getPluginPermission } from './pluginPermissions'

export interface PluginUpdateTarget {
  name: string
  script: string
  updateURL?: string
  versionOfPlugin?: string
}

export interface PluginUpdateInfo {
  version: string
  updateURL: string
}

export type PluginUpdateCheckResult =
  | { status: 'available'; update: PluginUpdateInfo }
  | { status: 'up-to-date' }
  | { status: 'denied' }
  | { status: 'failed' }

export type PluginUpdateDownloadResult =
  | { status: 'downloaded'; source: string }
  | { status: 'denied' }
  | { status: 'failed' }

interface PluginUpdateCacheEntry {
  checkedAt: number
  result: Extract<PluginUpdateCheckResult, { status: 'available' | 'up-to-date' }>
}

export const PLUGIN_UPDATE_CHECK_MAX_BYTES = 4 * 1024
export const PLUGIN_UPDATE_SCRIPT_MAX_BYTES = 8 * 1024 * 1024
const PLUGIN_UPDATE_REQUEST_TIMEOUT_MS = 30_000
const PLUGIN_UPDATE_CACHE_TTL_MS = 5 * 60 * 1000
const PLUGIN_UPDATE_CACHE_MAX_ENTRIES = 128

const updateCache = new Map<string, PluginUpdateCacheEntry>()
const updateRequests = new Map<string, Promise<PluginUpdateCheckResult>>()

class PluginUpdateBodyTooLargeError extends Error {
  constructor() {
    super('Plugin update response exceeds the allowed size.')
    this.name = 'PluginUpdateBodyTooLargeError'
  }
}

function assertAllowedPluginUpdateUrl(rawUrl: string): URL {
  const url = assertAllowedPluginNetworkUrl(rawUrl)
  if (url.protocol !== 'https:') {
    throw new Error('Plugin updates require HTTPS URLs.')
  }
  return url
}

export function comparePluginVersions(v1: string, v2: string): 0 | 1 | -1 {
  const v1parts = v1.split('.').map(Number)
  const v2parts = v2.split('.').map(Number)
  const len = Math.max(v1parts.length, v2parts.length)
  for (let i = 0; i < len; i++) {
    const part1 = v1parts[i] || 0
    const part2 = v2parts[i] || 0
    if (part1 > part2) return 1
    if (part1 < part2) return -1
  }
  return 0
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel()
  } catch {
    // The transport may already have closed the stream. The byte limit still
    // held because no additional chunks were consumed.
  }
}

/** Reads a UTF-8 response without allowing an ignored Range header to buffer an unbounded body. */
export async function readPluginUpdateText(
  response: Response,
  maxBytes: number,
  truncateAtLimit: boolean,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('Plugin update byte limit must be a positive integer.')
  }

  const reader = response.body?.getReader()
  if (!reader) return ''

  const decoder = new TextDecoder()
  let receivedBytes = 0
  let text = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return text + decoder.decode()
      if (!value || value.byteLength === 0) continue

      const remainingBytes = maxBytes - receivedBytes
      if (value.byteLength > remainingBytes) {
        if (remainingBytes > 0) {
          text += decoder.decode(value.subarray(0, remainingBytes), { stream: true })
        }
        await cancelReader(reader)
        if (!truncateAtLimit) throw new PluginUpdateBodyTooLargeError()
        return text + decoder.decode()
      }

      receivedBytes += value.byteLength
      text += decoder.decode(value, { stream: true })
      if (receivedBytes === maxBytes && truncateAtLimit) {
        await cancelReader(reader)
        return text + decoder.decode()
      }
    }
  } finally {
    reader.releaseLock()
  }
}

async function authorizeUpdateTarget(
  target: PluginUpdateTarget,
  isActive: () => boolean,
): Promise<{ status: 'allowed'; updateURL: string; cacheKey: string } | { status: 'denied' | 'failed' }> {
  const updateURL = target.updateURL
  if (!updateURL || !isActive()) return { status: 'failed' }

  try {
    assertAllowedPluginUpdateUrl(updateURL)
  } catch (error) {
    console.warn('Rejected plugin update URL:', error)
    return { status: 'failed' }
  }

  let allowed: boolean
  try {
    allowed = await getPluginPermission(target.name, 'pluginUpdate', false, target.script, undefined, {
      updateURL,
    })
  } catch (error) {
    console.warn('Failed to request plugin update permission:', error)
    return { status: 'failed' }
  }
  if (!isActive()) return { status: 'failed' }
  if (!allowed) return { status: 'denied' }

  try {
    // Reparse immediately before use. This keeps authorization and transport
    // validation tied to the same immutable URL snapshot.
    assertAllowedPluginUpdateUrl(updateURL)
    const scriptHash = await hasher(new TextEncoder().encode(target.script))
    if (!scriptHash || !isActive()) return { status: 'failed' }
    return {
      status: 'allowed',
      updateURL,
      cacheKey: JSON.stringify([target.name, scriptHash, updateURL, target.versionOfPlugin || '0.0.0']),
    }
  } catch (error) {
    console.warn('Failed to authorize plugin update URL:', error)
    return { status: 'failed' }
  }
}

function readPluginUpdateCache(
  key: string,
): Extract<PluginUpdateCheckResult, { status: 'available' | 'up-to-date' }> | null {
  const cached = updateCache.get(key)
  if (!cached) return null
  if (Date.now() - cached.checkedAt >= PLUGIN_UPDATE_CACHE_TTL_MS) {
    updateCache.delete(key)
    return null
  }

  updateCache.delete(key)
  updateCache.set(key, cached)
  return cached.result
}

function writePluginUpdateCache(
  key: string,
  result: Extract<PluginUpdateCheckResult, { status: 'available' | 'up-to-date' }>,
): void {
  updateCache.delete(key)
  while (updateCache.size >= PLUGIN_UPDATE_CACHE_MAX_ENTRIES) {
    const oldest = updateCache.keys().next().value
    if (typeof oldest !== 'string') break
    updateCache.delete(oldest)
  }
  updateCache.set(key, { checkedAt: Date.now(), result })
}

export async function checkPluginUpdate(
  target: PluginUpdateTarget,
  isActive: () => boolean = () => true,
): Promise<PluginUpdateCheckResult> {
  const snapshot = { ...target }
  const authorization = await authorizeUpdateTarget(snapshot, isActive)
  if (authorization.status !== 'allowed') return authorization

  const cached = readPluginUpdateCache(authorization.cacheKey)
  if (cached) return cached

  const pending = updateRequests.get(authorization.cacheKey)
  if (pending) return pending

  const request = (async (): Promise<PluginUpdateCheckResult> => {
    try {
      if (!isActive()) return { status: 'failed' }
      const response = await pluginFetchNative(authorization.updateURL, {
        method: 'GET',
        headers: {
          Range: `bytes=0-${PLUGIN_UPDATE_CHECK_MAX_BYTES - 1}`,
        },
        requestTimeoutMs: PLUGIN_UPDATE_REQUEST_TIMEOUT_MS,
        sensitive: true,
      })
      if (!isActive()) {
        await response.body?.cancel().catch(() => undefined)
        return { status: 'failed' }
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        return { status: 'failed' }
      }

      const text = await readPluginUpdateText(response, PLUGIN_UPDATE_CHECK_MAX_BYTES, true)
      if (!isActive()) return { status: 'failed' }
      const match = text.match(/^\/\/@version[\t ]+([^\s]+)/m)
      const latestVersion = match?.[1]?.trim()
      const result: Extract<PluginUpdateCheckResult, { status: 'available' | 'up-to-date' }> =
        latestVersion && comparePluginVersions(latestVersion, snapshot.versionOfPlugin || '0.0.0') === 1
          ? {
              status: 'available',
              update: {
                version: latestVersion,
                updateURL: authorization.updateURL,
              },
            }
          : { status: 'up-to-date' }
      writePluginUpdateCache(authorization.cacheKey, result)
      return result
    } catch (error) {
      console.warn('Failed to check plugin update:', error)
      return { status: 'failed' }
    } finally {
      updateRequests.delete(authorization.cacheKey)
    }
  })()

  updateRequests.set(authorization.cacheKey, request)
  return request
}

export async function downloadPluginUpdate(
  target: PluginUpdateTarget,
  isActive: () => boolean = () => true,
): Promise<PluginUpdateDownloadResult> {
  const authorization = await authorizeUpdateTarget({ ...target }, isActive)
  if (authorization.status !== 'allowed') return authorization

  try {
    if (!isActive()) return { status: 'failed' }
    const response = await pluginFetchNative(authorization.updateURL, {
      method: 'GET',
      requestTimeoutMs: PLUGIN_UPDATE_REQUEST_TIMEOUT_MS,
      sensitive: true,
    })
    if (!isActive()) {
      await response.body?.cancel().catch(() => undefined)
      return { status: 'failed' }
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return { status: 'failed' }
    }

    const source = await readPluginUpdateText(response, PLUGIN_UPDATE_SCRIPT_MAX_BYTES, false)
    if (!isActive()) return { status: 'failed' }
    return { status: 'downloaded', source }
  } catch (error) {
    console.warn('Failed to download plugin update:', error)
    return { status: 'failed' }
  }
}
