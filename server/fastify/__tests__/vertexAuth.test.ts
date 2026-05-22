import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import {
  _resetVertexTokenCacheForTesting,
  resolveVertexBearer,
  signServiceAccountJWT,
} from '../src/generation/vertexAuth.js'

interface KeyPair {
  publicKeyPem: string
  privateKeyPem: string
}

function makeKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { publicKeyPem: publicKey, privateKeyPem: privateKey }
}

function decodeBase64UrlJson<T>(segment: string): T {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf-8')) as T
}

beforeEach(() => {
  _resetVertexTokenCacheForTesting()
})

afterEach(() => {
  vi.unstubAllGlobals()
  _resetVertexTokenCacheForTesting()
})

describe('signServiceAccountJWT', () => {
  it('produces a header.claim.signature triple with RS256 + valid claim set', () => {
    const { privateKeyPem } = makeKeyPair()
    const jwt = signServiceAccountJWT(
      'svc@example.iam.gserviceaccount.com',
      privateKeyPem,
      1700000000,
    )
    const [encHeader, encClaim, encSig] = jwt.split('.')
    expect(encHeader && encClaim && encSig).toBeTruthy()

    const header = decodeBase64UrlJson<{ alg: string; typ: string }>(encHeader)
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' })

    const claim = decodeBase64UrlJson<{
      iss: string
      iat: number
      exp: number
      scope: string
      aud: string
    }>(encClaim)
    expect(claim).toEqual({
      iss: 'svc@example.iam.gserviceaccount.com',
      iat: 1700000000,
      exp: 1700003600,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
    })
  })

  it('signs a JWT that verifies against the matching public key', () => {
    const { publicKeyPem, privateKeyPem } = makeKeyPair()
    const jwt = signServiceAccountJWT('svc@example.iam.gserviceaccount.com', privateKeyPem)
    const [encHeader, encClaim, encSig] = jwt.split('.')
    const signingInput = `${encHeader}.${encClaim}`
    const verifier = createVerify('RSA-SHA256')
    verifier.update(signingInput)
    verifier.end()
    expect(verifier.verify(publicKeyPem, Buffer.from(encSig, 'base64url'))).toBe(true)
  })
})

describe('resolveVertexBearer', () => {
  function okTokenResponse(token: string, expiresIn = 3599): Response {
    return new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  it('returns an error when clientEmail is not a service-account address', async () => {
    const r = await resolveVertexBearer(
      'someone@example.com',
      '-----BEGIN PRIVATE KEY-----\nXXXX\n-----END PRIVATE KEY-----',
      new AbortController().signal,
    )
    expect(r.ok).toBe(false)
    expect((r as { error: string }).error).toMatch(/gserviceaccount\.com/)
  })

  it('returns an error when privateKey lacks PEM markers', async () => {
    const r = await resolveVertexBearer(
      'svc@example.iam.gserviceaccount.com',
      'not a key',
      new AbortController().signal,
    )
    expect(r.ok).toBe(false)
    expect((r as { error: string }).error).toMatch(/PEM/)
  })

  it('signs a JWT, posts to oauth2.googleapis.com/token, and returns the access_token', async () => {
    const { privateKeyPem } = makeKeyPair()
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      captured = { url, init }
      return okTokenResponse('ya29.fixture-token')
    })

    const r = await resolveVertexBearer(
      'svc@example.iam.gserviceaccount.com',
      privateKeyPem,
      new AbortController().signal,
    )
    expect(r).toEqual({ ok: true, token: 'ya29.fixture-token' })
    expect(captured!.url).toBe('https://oauth2.googleapis.com/token')
    expect((captured!.init.headers as Record<string, string>)['content-type']).toBe(
      'application/x-www-form-urlencoded',
    )
    const body = captured!.init.body as string
    expect(body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer')
    expect(body).toContain('&assertion=')
  })

  it('returns a cached token instead of re-signing on the next call', async () => {
    const { privateKeyPem } = makeKeyPair()
    let fetchCount = 0
    vi.stubGlobal('fetch', async () => {
      fetchCount++
      return okTokenResponse('ya29.cached-token')
    })

    const a = await resolveVertexBearer(
      'svc@example.iam.gserviceaccount.com',
      privateKeyPem,
      new AbortController().signal,
    )
    const b = await resolveVertexBearer(
      'svc@example.iam.gserviceaccount.com',
      privateKeyPem,
      new AbortController().signal,
    )
    expect(a).toEqual({ ok: true, token: 'ya29.cached-token' })
    expect(b).toEqual({ ok: true, token: 'ya29.cached-token' })
    expect(fetchCount).toBe(1)
  })

  it('refreshes a token whose expiry is within the safety margin', async () => {
    const { privateKeyPem } = makeKeyPair()
    let fetchCount = 0
    vi.stubGlobal('fetch', async () => {
      fetchCount++
      // 30s TTL — fully consumed by the 60s safety margin so the second
      // call should re-fetch.
      return okTokenResponse(`ya29.token-${fetchCount}`, 30)
    })

    const a = await resolveVertexBearer(
      'svc@example.iam.gserviceaccount.com',
      privateKeyPem,
      new AbortController().signal,
    )
    const b = await resolveVertexBearer(
      'svc@example.iam.gserviceaccount.com',
      privateKeyPem,
      new AbortController().signal,
    )
    expect(a).toEqual({ ok: true, token: 'ya29.token-1' })
    expect(b).toEqual({ ok: true, token: 'ya29.token-2' })
    expect(fetchCount).toBe(2)
  })

  it('returns an error with the upstream body when the token exchange returns non-2xx', async () => {
    const { privateKeyPem } = makeKeyPair()
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('{"error":"invalid_grant","error_description":"Invalid JWT"}', {
          status: 400,
        }),
    )
    const r = await resolveVertexBearer(
      'svc@example.iam.gserviceaccount.com',
      privateKeyPem,
      new AbortController().signal,
    )
    expect(r.ok).toBe(false)
    expect((r as { error: string }).error).toContain('400')
    expect((r as { error: string }).error).toContain('invalid_grant')
  })

  it('returns an error when the response JSON lacks access_token', async () => {
    const { privateKeyPem } = makeKeyPair()
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ token_type: 'Bearer' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const r = await resolveVertexBearer(
      'svc@example.iam.gserviceaccount.com',
      privateKeyPem,
      new AbortController().signal,
    )
    expect(r.ok).toBe(false)
    expect((r as { error: string }).error).toMatch(/access_token/)
  })
})
