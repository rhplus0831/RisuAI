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

vi.mock('./process/modules', async (importActual) => {
  const actual = await importActual<typeof import('./process/modules')>()
  return { ...actual, moduleUpdate: vi.fn() }
})

import { testDatabaseState } from './__tests__/resourceDatabaseState'
import { saveAsset, saveAssets } from './globalApi.svelte'

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
  testDatabaseState.db = {
    usePlainFetch: false,
    requestLocation: '',
    modules: [],
    enabledModules: [],
    characters: [],
  }
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
          assetIds: [missingId, otherMissingId],
        })
      }
      if (input === '/api/v1/assets') {
        return responseJson({ assetId: 'uploaded-asset' })
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
      prefer: 'return=minimal',
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

  it('batches large existence probes to stay within the public endpoint limit', async () => {
    const assets = Array.from({ length: 1025 }, (_, index) => ({
      data: new Uint8Array([index >> 8, index & 0xff]),
      fileName: `${index}.png`,
    }))

    const ids = await saveAssets(assets)

    expect(ids).toHaveLength(1025)
    expect(fetchCalls).toHaveLength(2)
    const first = (await readRequestJson(fetchCalls[0].init)) as { ids: string[] }
    const second = (await readRequestJson(fetchCalls[1].init)) as { ids: string[] }
    expect(first.ids).toHaveLength(1024)
    expect(second.ids).toHaveLength(1)
  })
})

describe('saveAsset media type', () => {
  it.each([
    ['reference.jpeg', 'image/jpeg'],
    ['reference.webp', 'image/webp'],
    ['reference.gif', 'image/gif'],
    ['reference.wav', 'audio/wav'],
    ['reference.ogg', 'audio/ogg'],
    ['reference.mp3', 'audio/mpeg'],
    ['reference.aac', 'audio/aac'],
  ])('uses the filename extension for %s', async (fileName, expectedContentType) => {
    await expect(saveAsset(new Uint8Array([1, 2, 3]), '', fileName)).resolves.toBe('uploaded-asset')

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].input).toBe('/api/v1/assets')
    expect(fetchCalls[0].init?.headers).toMatchObject({ 'content-type': expectedContentType })
  })
})
