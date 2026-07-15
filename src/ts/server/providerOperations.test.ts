import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { language } from '../../lang'
import { MASKED_MODEL_PROFILE_SECRET } from '../model/modelProfileSecrets'
import { providerOperationCredential, requestProviderOperation } from './providerOperations'

const proxyAuth = vi.hoisted(() => vi.fn(async () => 'browser-auth'))

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: proxyAuth,
}))

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('providerOperationCredential', () => {
  it('uses server-side stored credentials for a masked global secret', () => {
    expect(providerOperationCredential(MASKED_MODEL_PROFILE_SECRET)).toEqual({ source: 'stored' })
  })

  it('uses the exact model profile for a masked profile secret', () => {
    expect(providerOperationCredential(MASKED_MODEL_PROFILE_SECRET, { profileId: ' profile-a ' })).toEqual({
      source: 'model-profile',
      profileId: 'profile-a',
    })
  })

  it('sends only intentional draft overrides and treats blank values as absent', () => {
    expect(providerOperationCredential('draft-key')).toEqual({ source: 'provided', apiKey: 'draft-key' })
    expect(providerOperationCredential('  ')).toEqual({ source: 'none' })
    expect(providerOperationCredential(undefined)).toEqual({ source: 'none' })
  })
})

describe('requestProviderOperation', () => {
  beforeEach(() => {
    proxyAuth.mockClear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts a fixed operation envelope with browser authentication', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ operation: 'nanogpt.model-providers', data: { providers: [] } }))

    await expect(
      requestProviderOperation<{ providers: unknown[] }>('nanogpt.model-providers', {
        credential: { source: 'model-profile', profileId: 'profile-a' },
        input: { modelId: 'owner/model' },
      }),
    ).resolves.toEqual({ providers: [] })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/provider-operations')
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'risu-auth': 'browser-auth',
      },
    })
    expect(JSON.parse(init.body as string)).toEqual({
      operation: 'nanogpt.model-providers',
      credential: { source: 'model-profile', profileId: 'profile-a' },
      input: { modelId: 'owner/model' },
    })
  })

  it('rejects failed and mismatched operation responses', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'provider_operation_failed' }, 502))
    await expect(requestProviderOperation('openrouter.models', { credential: { source: 'none' } })).rejects.toThrow(
      language.errors.providerOperationFailed(502),
    )

    fetchMock.mockResolvedValueOnce(jsonResponse({ operation: 'nanogpt.models', data: [] }))
    await expect(requestProviderOperation('openrouter.models', { credential: { source: 'none' } })).rejects.toThrow(
      language.errors.providerOperationResponseMalformed,
    )
  })
})
