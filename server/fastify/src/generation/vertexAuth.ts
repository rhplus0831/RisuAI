import { createSign } from 'node:crypto'

/**
 * Vertex AI service-account auth helper. The SPA's local path
 * (`src/ts/process/request/google.ts:462-557`) signs a JWT with Web
 * Crypto, exchanges it for a Bearer at oauth2.googleapis.com, and
 * caches the result in `db.vertexAccessToken` /
 * `db.vertexAccessTokenExpires`. The server mirrors the flow with Node
 * `crypto.createSign('RSA-SHA256')` and an in-process Map keyed by
 * service-account email.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const TOKEN_TTL_SAFETY_MS = 60 * 1000

interface CachedToken {
  token: string
  expiresAt: number
}

// Module-private cache. Tests reach in via `_resetVertexTokenCacheForTesting`.
const tokenCache = new Map<string, CachedToken>()

function base64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64url')
}

interface JWTClaimSet {
  iss: string
  iat: number
  exp: number
  scope: string
  aud: string
}

/**
 * Build + RS256-sign a JWT for the Google OAuth2 token endpoint. Exported
 * for tests; the dispatcher path uses `resolveVertexBearer` which wraps
 * this plus the token exchange.
 */
export function signServiceAccountJWT(
  email: string,
  privateKeyPem: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): string {
  const header = { alg: 'RS256', typ: 'JWT' }
  const claimSet: JWTClaimSet = {
    iss: email,
    iat: nowSec,
    exp: nowSec + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
  }
  const encHeader = base64url(Buffer.from(JSON.stringify(header)))
  const encClaim = base64url(Buffer.from(JSON.stringify(claimSet)))
  const signingInput = `${encHeader}.${encClaim}`
  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  signer.end()
  const signature = signer.sign(privateKeyPem)
  return `${signingInput}.${base64url(signature)}`
}

function getCachedToken(email: string): string | null {
  const entry = tokenCache.get(email)
  if (!entry) return null
  if (entry.expiresAt - TOKEN_TTL_SAFETY_MS <= Date.now()) return null
  return entry.token
}

function setCachedToken(email: string, token: string, expiresInSec: number): void {
  tokenCache.set(email, {
    token,
    expiresAt: Date.now() + expiresInSec * 1000,
  })
}

/**
 * Test-only helper to clear the in-process Bearer cache between cases.
 */
export function _resetVertexTokenCacheForTesting(): void {
  tokenCache.clear()
}

interface TokenResponse {
  access_token?: unknown
  expires_in?: unknown
}

export type VertexBearerResult = { ok: true; token: string } | { ok: false; error: string }

/**
 * Return a Bearer token for the given service account, fetching a fresh
 * one (and caching it) if no live cached token exists. Validates the
 * credentials shape before signing so misconfigured callers get a useful
 * error message instead of a crypto exception.
 */
export async function resolveVertexBearer(
  email: string,
  privateKey: string,
  signal: AbortSignal,
): Promise<VertexBearerResult> {
  if (typeof email !== 'string' || email.length === 0 || !email.includes('gserviceaccount.com')) {
    return { ok: false, error: 'Vertex clientEmail must be a gserviceaccount.com address' }
  }
  if (
    typeof privateKey !== 'string' ||
    !privateKey.includes('-----BEGIN PRIVATE KEY-----') ||
    !privateKey.includes('-----END PRIVATE KEY-----')
  ) {
    return { ok: false, error: 'Vertex privateKey must include PEM begin/end markers' }
  }

  const cached = getCachedToken(email)
  if (cached !== null) return { ok: true, token: cached }

  let jwt: string
  try {
    jwt = signServiceAccountJWT(email, privateKey)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `failed to sign Vertex JWT: ${msg}` }
  }

  let response: Response
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body:
        'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' +
        encodeURIComponent(jwt),
      signal,
    })
  } catch (err) {
    if (signal.aborted) return { ok: false, error: 'aborted' }
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `failed to fetch Vertex Bearer: ${msg}` }
  }

  if (!response.ok) {
    let body = ''
    try {
      body = await response.text()
    } catch {
      // ignore
    }
    return {
      ok: false,
      error: `Vertex token exchange failed: HTTP ${response.status} ${body}`.trim(),
    }
  }

  let data: TokenResponse
  try {
    data = (await response.json()) as TokenResponse
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Vertex token response was not valid JSON: ${msg}` }
  }

  if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
    return { ok: false, error: 'Vertex token response missing access_token' }
  }
  // Google's expires_in is typically 3599; default conservatively when absent.
  // The 60s safety margin in `getCachedToken` handles small / about-to-expire
  // values naturally on the next call.
  const expiresInSec =
    typeof data.expires_in === 'number' && Number.isFinite(data.expires_in) && data.expires_in > 0
      ? data.expires_in
      : 3500

  setCachedToken(email, data.access_token, expiresInSec)
  return { ok: true, token: data.access_token }
}
