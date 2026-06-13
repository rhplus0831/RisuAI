import { createHash, webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./platform', async (importActual) => {
  const actual = await importActual<typeof import('./platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'proxy-auth-token',
}))

import { DBState } from './stores.svelte'
import { saveAssets } from './globalApi.svelte'

interface CapturedFetch {
  input: RequestInfo | URL
  init?: RequestInit
}

const fetchCalls: CapturedFetch[] = []
const presentAsset = new Uint8Array([1, 2, 3])
const missingAsset = new Uint8Array([4, 5, 6])
const otherMissingAsset = new Uint8Array([7, 8, 9])
const presentId = sha256HexSync(presentAsset)
const missingId = sha256HexSync(missingAsset)
const otherMissingId = sha256HexSync(otherMissingAsset)

function sha256HexSync(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function responseJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function readRequestJson(init?: RequestInit): Promise<unknown> {
  if (typeof init?.body !== 'string') {
    throw new Error('Expected JSON request body')
  }
  return JSON.parse(init.body) as unknown
}

async function readBulkBinaryBody(init?: RequestInit): Promise<{ manifest: unknown; bytes: Uint8Array }> {
  const rawBody = init?.body
  if (!(rawBody instanceof ArrayBuffer)) {
    throw new Error('Expected binary bulk request body')
  }
  const body = new Uint8Array(rawBody)
  const manifestLength = new DataView(rawBody).getUint32(0)
  const manifestBytes = body.slice(4, 4 + manifestLength)
  return {
    manifest: JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown,
    bytes: body.slice(4 + manifestLength),
  }
}

beforeEach(() => {
  fetchCalls.length = 0
  DBState.db = {
    usePlainFetch: false,
    requestLocation: '',
    modules: [],
    enabledModules: [],
    characters: [],
  } as unknown as typeof DBState.db
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init })
      if (input === '/api/v1/assets/exists') {
        return responseJson({ missing: [missingId, otherMissingId] })
      }
      if (input === '/api/v1/assets/bulk') {
        return responseJson({
          assets: [{ assetId: missingId }, { assetId: otherMissingId }],
        })
      }
      throw new Error(`Unexpected fetch: ${String(input)}`)
    }) as unknown as typeof fetch,
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('saveAssets server bulk upload', () => {
  it('probes existing ids and uploads only unique missing assets as binary bulk', async () => {
    const ids = await saveAssets([
      { data: presentAsset, fileName: 'present.png' },
      { data: missingAsset, fileName: 'missing.png' },
      { data: missingAsset, fileName: 'missing-duplicate.png' },
      { data: otherMissingAsset, fileName: 'other-missing.png' },
    ])

    expect(ids).toEqual([presentId, missingId, missingId, otherMissingId])
    expect(fetchCalls).toHaveLength(2)
    expect(fetchCalls[0].input).toBe('/api/v1/assets/exists')
    expect(await readRequestJson(fetchCalls[0].init)).toEqual({
      ids: [presentId, missingId, otherMissingId],
    })

    expect(fetchCalls[1].input).toBe('/api/v1/assets/bulk')
    expect(fetchCalls[1].init?.headers).toMatchObject({
      'content-type': 'application/vnd.risu.assets-bulk',
      'risu-auth': 'proxy-auth-token',
    })
    const bulkBody = await readBulkBinaryBody(fetchCalls[1].init)
    expect(bulkBody.manifest).toEqual({
      assets: [
        { contentType: 'image/png', size: missingAsset.byteLength },
        { contentType: 'image/png', size: otherMissingAsset.byteLength },
      ],
    })
    expect(Array.from(bulkBody.bytes)).toEqual([...missingAsset, ...otherMissingAsset])
  })
})
