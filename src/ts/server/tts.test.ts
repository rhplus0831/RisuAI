import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MASKED_PROVIDER_SECRET } from '../providerSecretMask'
import { requestTtsSynthesis, ttsGlobalCredential, TtsSynthesisRequestError } from './tts'

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(async () => 'signed-auth'),
}))

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: mocks.getAuth,
}))

function audioResponse(bytes = new Uint8Array([1, 2, 3]), contentType = 'audio/mpeg'): Response {
  return new Response(bytes, { headers: { 'content-type': contentType } })
}

beforeEach(() => {
  vi.restoreAllMocks()
  mocks.getAuth.mockResolvedValue('signed-auth')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TTS synthesis client', () => {
  it('maps masked, draft, and empty global credentials without sending the sentinel as a key', () => {
    expect(ttsGlobalCredential(MASKED_PROVIDER_SECRET)).toEqual({ source: 'stored' })
    expect(ttsGlobalCredential('draft-key')).toEqual({ source: 'provided', apiKey: 'draft-key' })
    expect(ttsGlobalCredential('')).toEqual({ source: 'none' })
  })

  it('posts an authenticated fixed operation and returns binary audio metadata', async () => {
    const fetchMock = vi.fn(async () => audioResponse())
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requestTtsSynthesis({
        operation: 'elevenlabs.synthesize',
        credential: { source: 'stored' },
        input: { text: 'hello', voiceId: 'voice-a' },
      }),
    ).resolves.toEqual({ audio: new Uint8Array([1, 2, 3]).buffer, contentType: 'audio/mpeg' })

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/tts/synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'risu-auth': 'signed-auth' },
      body: JSON.stringify({
        operation: 'elevenlabs.synthesize',
        credential: { source: 'stored' },
        input: { text: 'hello', voiceId: 'voice-a' },
      }),
      cache: 'no-store',
      signal: undefined,
    })
  })

  it('forwards cancellation and exposes only sanitized server error metadata', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'tts_upstream_failed', upstreamStatus: 429 }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requestTtsSynthesis(
        {
          operation: 'novelai.synthesize',
          credential: { source: 'stored' },
          input: { text: 'hello', seed: 'Aini', version: 'v2' },
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject<TtsSynthesisRequestError>({
      name: 'TtsSynthesisRequestError',
      status: 502,
      code: 'tts_upstream_failed',
      upstreamStatus: 429,
    })
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal)
  })

  it('rejects a non-audio success response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } })),
    )
    await expect(
      requestTtsSynthesis({
        operation: 'elevenlabs.synthesize',
        credential: { source: 'stored' },
        input: { text: 'hello', voiceId: 'voice-a' },
      }),
    ).rejects.toMatchObject({ code: 'tts_upstream_invalid_response' })
  })
})
