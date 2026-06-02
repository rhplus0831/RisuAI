import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchNativeMock = vi.hoisted(() => vi.fn())
const globalFetchMock = vi.hoisted(() => vi.fn())

vi.mock('src/ts/platform', async (importActual) => {
  const actual = await importActual<typeof import('../../../platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('src/ts/globalApi.svelte', async (importActual) => {
  const actual = await importActual<typeof import('../../../globalApi.svelte')>()
  return {
    ...actual,
    fetchNative: fetchNativeMock,
    textifyReadableStream: vi.fn(),
  }
})

vi.mock('../../modules', async (importActual) => {
  const actual = await importActual<typeof import('../../modules')>()
  return { ...actual, moduleUpdate: () => {}, getModuleToggles: () => '' }
})

import { LLMFormat } from '../../../model/types'
import { getDatabase, setDatabase, type Database } from '../../../storage/database.svelte'
import type { RequestDataArgumentExtended } from '../request'
import { requestGoogleCloudVertex } from '../google'

const originalWindowCrypto = window.crypto

function installCryptoStub(): void {
  const cryptoStub = {
    randomUUID: () => '00000000-0000-4000-8000-000000000000',
    subtle: {
      importKey: vi.fn(async () => ({ key: 'stub' })),
      sign: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
    },
  } as unknown as Crypto
  vi.stubGlobal('crypto', cryptoStub)
  Object.defineProperty(window, 'crypto', {
    value: cryptoStub,
    configurable: true,
  })
}

function restoreWindowCrypto(): void {
  Object.defineProperty(window, 'crypto', {
    value: originalWindowCrypto,
    configurable: true,
  })
}

function seedDb(): void {
  setDatabase({
    aiModel: 'gemini-1.5-pro',
    subModel: 'gemini-1.5-pro',
    characters: [],
    maxContext: 4000,
    maxResponse: 32,
    botPresetsId: 0,
    statics: { messages: 0 } as unknown as Database['statics'],
    promptInfoInsideChat: false,
    google: {
      accessToken: '',
      projectId: 'vertex-project',
    },
    vertexRegion: 'us-central1',
    vertexClientEmail: 'svc@vertex-project.iam.gserviceaccount.com',
    vertexPrivateKey: '-----BEGIN PRIVATE KEY-----AQID-----END PRIVATE KEY-----',
    vertexAccessToken: 'old-projection-token',
    vertexAccessTokenExpires: 0,
  } as unknown as Database)
}

function makeVertexArg(): RequestDataArgumentExtended {
  return {
    bias: {},
    formated: [{ role: 'user', content: 'hello' }],
    aiModel: 'gemini-1.5-pro',
    maxTokens: 32,
    useStreaming: false,
    modelInfo: {
      id: 'gemini-1.5-pro',
      name: 'Gemini',
      internalID: 'gemini-1.5-pro',
      provider: 0 as never,
      format: LLMFormat.VertexAIGemini,
      flags: [],
      parameters: [],
      tokenizer: 0 as never,
      recommended: false,
    } as unknown as RequestDataArgumentExtended['modelInfo'],
  } as RequestDataArgumentExtended
}

beforeEach(() => {
  installCryptoStub()
  seedDb()
  fetchNativeMock.mockReset()
  globalFetchMock.mockReset()
  globalFetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'fresh-token' }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'server vertex ok' }] } }],
      }),
    })
  vi.stubGlobal('fetch', globalFetchMock)
})

afterEach(() => {
  restoreWindowCrypto()
  vi.unstubAllGlobals()
})

describe('requestGoogleCloudVertex in Fastify mode', () => {
  it('uses a refreshed Vertex bearer without writing it into the server projection', async () => {
    const result = await requestGoogleCloudVertex(makeVertexArg())

    expect(result).toMatchObject({ type: 'success', result: 'server vertex ok' })
    expect(globalFetchMock).toHaveBeenCalledTimes(2)
    expect(globalFetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-token')

    const db = getDatabase()
    expect(db.vertexAccessToken).toBe('old-projection-token')
    expect(db.vertexAccessTokenExpires).toBe(0)
  })
})
