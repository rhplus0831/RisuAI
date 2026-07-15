import { MASKED_PROVIDER_SECRET } from '../providerSecretMask'
import { getNodeServerProxyAuth } from '../storage/fastifyStorage'
import type { McpOAuthRefreshRequest, McpOAuthRefreshSuccess } from './mcpOAuthRefreshProtocol'

const MCP_OAUTH_REFRESH_ENDPOINT = '/api/v1/mcp/oauth/refresh'
const MCP_OAUTH_REFRESH_MAX_IDENTITY_LENGTH = 8 * 1024
const MCP_OAUTH_REFRESH_MAX_ACCESS_TOKEN_LENGTH = 64 * 1024
const MCP_OAUTH_REFRESH_MAX_RESPONSE_LENGTH = MCP_OAUTH_REFRESH_MAX_ACCESS_TOKEN_LENGTH + 1024

export interface RequestStoredMcpOAuthRefreshOptions {
  signal?: AbortSignal | null
}

export async function requestStoredMcpOAuthRefresh(
  url: string,
  options: RequestStoredMcpOAuthRefreshOptions = {},
): Promise<string> {
  if (
    typeof url !== 'string' ||
    url.trim() !== url ||
    url.length === 0 ||
    url.length > MCP_OAUTH_REFRESH_MAX_IDENTITY_LENGTH ||
    url === MASKED_PROVIDER_SECRET
  ) {
    throw new Error('Stored MCP OAuth refresh identity was invalid')
  }

  throwIfAborted(options.signal)
  const auth = await getNodeServerProxyAuth()
  throwIfAborted(options.signal)
  const response = await fetch(MCP_OAUTH_REFRESH_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'risu-auth': auth,
    },
    body: JSON.stringify({ url } satisfies McpOAuthRefreshRequest),
    cache: 'no-store',
    signal: options.signal ?? undefined,
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`Stored MCP OAuth refresh failed (${response.status})`)
  }

  const rawBody = await response.text()
  throwIfAborted(options.signal)
  if (rawBody.length > MCP_OAUTH_REFRESH_MAX_RESPONSE_LENGTH) {
    throw new Error('Stored MCP OAuth refresh response was malformed')
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    throw new Error('Stored MCP OAuth refresh response was malformed')
  }
  if (!isRecord(body) || Object.keys(body).length !== 1) {
    throw new Error('Stored MCP OAuth refresh response was malformed')
  }
  const accessToken = (body as Partial<McpOAuthRefreshSuccess>).accessToken
  if (
    typeof accessToken !== 'string' ||
    accessToken.trim().length === 0 ||
    accessToken.length > MCP_OAUTH_REFRESH_MAX_ACCESS_TOKEN_LENGTH ||
    accessToken === MASKED_PROVIDER_SECRET
  ) {
    throw new Error('Stored MCP OAuth refresh response was malformed')
  }
  return accessToken
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (!signal?.aborted) return
  const reason = signal.reason
  throw reason instanceof Error ? reason : new DOMException('Stored MCP OAuth refresh cancelled', 'AbortError')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
