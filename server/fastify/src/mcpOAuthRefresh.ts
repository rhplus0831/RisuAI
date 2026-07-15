import { isIP } from 'node:net'
import type { McpOAuthRefreshRequest, McpOAuthRefreshSuccess } from '../../../src/ts/server/mcpOAuthRefreshProtocol.js'
import { readBoundedBodyJson } from './generation/body.js'
import { fetchMcpOAuthRefreshToken, isLocalMcpOAuthRefreshAddress } from './mcpOAuthRefreshEgress.js'
import { MASKED_PROVIDER_SECRET } from './providerSecrets.js'
import { createTimeoutController } from './proxy.js'

export const MCP_OAUTH_REFRESH_TIMEOUT_MS = 30_000
export const MCP_OAUTH_REFRESH_MAX_RESPONSE_BYTES = 256 * 1024
export const MCP_OAUTH_REFRESH_MAX_IDENTITY_LENGTH = 8 * 1024
export const MCP_OAUTH_REFRESH_REQUEST_BODY_LIMIT_BYTES = 16 * 1024
export const MCP_OAUTH_REFRESH_MAX_TOKEN_URL_LENGTH = 8 * 1024
export const MCP_OAUTH_REFRESH_MAX_CLIENT_ID_LENGTH = 16 * 1024
export const MCP_OAUTH_REFRESH_MAX_SECRET_LENGTH = 64 * 1024
export const MCP_OAUTH_REFRESH_MAX_ACCESS_TOKEN_LENGTH = 64 * 1024
export const MCP_OAUTH_REFRESH_MAX_RECORDS = 2_048

type JsonRecord = Record<string, unknown>

export interface StoredMcpOAuthRefreshRecord {
  url: string
  tokenUrl: string
  refreshToken: string
  clientId: string
  clientSecret: string
}

export interface McpOAuthRefreshExecutionOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxResponseBytes?: number
  signal?: AbortSignal
}

export type McpOAuthRefreshErrorCode =
  | 'invalid_mcp_oauth_refresh_request'
  | 'mcp_oauth_refresh_not_found'
  | 'mcp_oauth_refresh_configuration_invalid'
  | 'mcp_oauth_refresh_failed'
  | 'mcp_oauth_refresh_invalid_response'
  | 'mcp_oauth_refresh_timeout'
  | 'mcp_oauth_refresh_cancelled'

export class McpOAuthRefreshError extends Error {
  readonly code: McpOAuthRefreshErrorCode
  readonly statusCode: number
  readonly upstreamStatus?: number

  constructor(code: McpOAuthRefreshErrorCode, statusCode: number, upstreamStatus?: number) {
    super(code)
    this.name = 'McpOAuthRefreshError'
    this.code = code
    this.statusCode = statusCode
    this.upstreamStatus = upstreamStatus
  }
}

export function parseMcpOAuthRefreshRequest(body: unknown): McpOAuthRefreshRequest {
  const record = readExactRecord(body, ['url'], invalidRequest)
  if (Object.keys(record).length !== 1) throw invalidRequest()
  return { url: readMcpIdentity(record.url, invalidRequest) }
}

export function resolveStoredMcpOAuthRefreshRecord(
  settings: JsonRecord,
  identity: string,
): StoredMcpOAuthRefreshRecord {
  const requestedIdentity = readMcpIdentity(identity, invalidRequest)
  const rawRefreshes = settings.authRefreshes
  if (rawRefreshes === undefined || rawRefreshes === null) throw notFound()
  if (!Array.isArray(rawRefreshes) || rawRefreshes.length > MCP_OAUTH_REFRESH_MAX_RECORDS) {
    throw invalidConfiguration()
  }

  const records = new Map<string, StoredMcpOAuthRefreshRecord>()
  for (const value of rawRefreshes) {
    const record = parseStoredRefreshRecord(value)
    if (records.has(record.url)) throw invalidConfiguration()
    records.set(record.url, record)
  }

  const match = records.get(requestedIdentity)
  if (!match) throw notFound()
  return match
}

export async function executeStoredMcpOAuthRefresh(
  request: McpOAuthRefreshRequest,
  settings: JsonRecord,
  options: McpOAuthRefreshExecutionOptions = {},
): Promise<McpOAuthRefreshSuccess> {
  const refresh = resolveStoredMcpOAuthRefreshRecord(settings, request.url)
  const timeout = createTimeoutController(options.timeoutMs ?? MCP_OAUTH_REFRESH_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([timeout.signal, options.signal]) : timeout.signal

  try {
    let response: Response
    try {
      const init: RequestInit = {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refresh.refreshToken,
          client_id: refresh.clientId,
          client_secret: refresh.clientSecret,
        }).toString(),
        redirect: 'error',
        signal,
      }
      response = options.fetchImpl
        ? await options.fetchImpl(refresh.tokenUrl, init)
        : await fetchMcpOAuthRefreshToken(refresh.tokenUrl, init, {
            allowLocalTarget: isLocalMcpIdentity(refresh.url),
          })
    } catch {
      throw executionFailure(timeout.timedOut(), options.signal?.aborted === true)
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new McpOAuthRefreshError('mcp_oauth_refresh_failed', 502, response.status)
    }

    let data: unknown
    try {
      data = await readBoundedBodyJson(response, options.maxResponseBytes ?? MCP_OAUTH_REFRESH_MAX_RESPONSE_BYTES)
    } catch {
      throw executionFailure(timeout.timedOut(), options.signal?.aborted === true, true)
    }

    if (!isRecord(data)) throw invalidUpstreamResponse()
    const accessToken = data.access_token
    if (
      typeof accessToken !== 'string' ||
      accessToken.trim().length === 0 ||
      accessToken.length > MCP_OAUTH_REFRESH_MAX_ACCESS_TOKEN_LENGTH ||
      accessToken === MASKED_PROVIDER_SECRET
    ) {
      throw invalidUpstreamResponse()
    }
    return { accessToken }
  } finally {
    timeout.cleanup()
  }
}

function parseStoredRefreshRecord(value: unknown): StoredMcpOAuthRefreshRecord {
  const record = readExactRecord(
    value,
    ['url', 'tokenUrl', 'refreshToken', 'clientId', 'clientSecret'],
    invalidConfiguration,
  )
  const parsed: StoredMcpOAuthRefreshRecord = {
    url: readMcpIdentity(record.url, invalidConfiguration),
    tokenUrl: readTokenUrl(record.tokenUrl, invalidConfiguration),
    refreshToken: readNonBlankString(record.refreshToken, MCP_OAUTH_REFRESH_MAX_SECRET_LENGTH, invalidConfiguration),
    clientId: readNonBlankString(record.clientId, MCP_OAUTH_REFRESH_MAX_CLIENT_ID_LENGTH, invalidConfiguration),
    clientSecret: readString(record.clientSecret, MCP_OAUTH_REFRESH_MAX_SECRET_LENGTH, invalidConfiguration),
  }

  if (Object.values(parsed).some((field) => field === MASKED_PROVIDER_SECRET)) throw invalidConfiguration()
  return parsed
}

function readMcpIdentity(value: unknown, error: () => McpOAuthRefreshError): string {
  const identity = readNonBlankString(value, MCP_OAUTH_REFRESH_MAX_IDENTITY_LENGTH, error)
  if (identity.trim() !== identity) throw error()

  if (identity.startsWith('http://') || identity.startsWith('https://')) {
    readHttpUrl(identity, MCP_OAUTH_REFRESH_MAX_IDENTITY_LENGTH, error)
    return identity
  }

  if (identity.startsWith('stdio:')) {
    try {
      const parsed = JSON.parse(identity.slice('stdio:'.length)) as unknown
      if (!isRecord(parsed)) throw error()
      readHttpUrl(parsed.url, MCP_OAUTH_REFRESH_MAX_IDENTITY_LENGTH, error)
      return identity
    } catch (caught) {
      if (caught instanceof McpOAuthRefreshError) throw caught
      throw error()
    }
  }

  throw error()
}

function readHttpUrl(value: unknown, maxLength: number, error: () => McpOAuthRefreshError): string {
  const raw = readNonBlankString(value, maxLength, error)
  if (raw.trim() !== raw) throw error()
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw error()
    return raw
  } catch (caught) {
    if (caught instanceof McpOAuthRefreshError) throw caught
    throw error()
  }
}

function readTokenUrl(value: unknown, error: () => McpOAuthRefreshError): string {
  const raw = readHttpUrl(value, MCP_OAUTH_REFRESH_MAX_TOKEN_URL_LENGTH, error)
  const url = new URL(raw)
  if (url.username !== '' || url.password !== '' || url.hash !== '') {
    throw error()
  }
  return raw
}

function isLocalMcpIdentity(identity: string): boolean {
  let rawUrl = identity
  if (identity.startsWith('stdio:')) {
    const parsed = JSON.parse(identity.slice('stdio:'.length)) as JsonRecord
    rawUrl = parsed.url as string
  }
  const url = new URL(rawUrl)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const lowerHostname = hostname.toLowerCase()
  if (lowerHostname === 'localhost' || lowerHostname.endsWith('.localhost') || lowerHostname.endsWith('.local')) {
    return true
  }
  return isIP(hostname) !== 0 && isLocalMcpOAuthRefreshAddress(hostname)
}

function readExactRecord(
  value: unknown,
  allowedKeys: readonly string[],
  error: () => McpOAuthRefreshError,
): JsonRecord {
  if (!isRecord(value)) throw error()
  const allowed = new Set(allowedKeys)
  if (Object.keys(value).some((key) => !allowed.has(key))) throw error()
  return value
}

function readNonBlankString(value: unknown, maxLength: number, error: () => McpOAuthRefreshError): string {
  const parsed = readString(value, maxLength, error)
  if (parsed.trim().length === 0) throw error()
  return parsed
}

function readString(value: unknown, maxLength: number, error: () => McpOAuthRefreshError): string {
  if (typeof value !== 'string' || value.length > maxLength) throw error()
  return value
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function executionFailure(timedOut: boolean, cancelled: boolean, invalidResponse = false): McpOAuthRefreshError {
  if (timedOut) return new McpOAuthRefreshError('mcp_oauth_refresh_timeout', 504)
  if (cancelled) return new McpOAuthRefreshError('mcp_oauth_refresh_cancelled', 499)
  return invalidResponse
    ? new McpOAuthRefreshError('mcp_oauth_refresh_invalid_response', 502)
    : new McpOAuthRefreshError('mcp_oauth_refresh_failed', 502)
}

function invalidRequest(): McpOAuthRefreshError {
  return new McpOAuthRefreshError('invalid_mcp_oauth_refresh_request', 400)
}

function notFound(): McpOAuthRefreshError {
  return new McpOAuthRefreshError('mcp_oauth_refresh_not_found', 404)
}

function invalidConfiguration(): McpOAuthRefreshError {
  return new McpOAuthRefreshError('mcp_oauth_refresh_configuration_invalid', 400)
}

function invalidUpstreamResponse(): McpOAuthRefreshError {
  return new McpOAuthRefreshError('mcp_oauth_refresh_invalid_response', 502)
}
