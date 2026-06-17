import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const selectedFileState = vi.hoisted(() => ({
  queue: [] as Array<Promise<null | { name: string; data: Uint8Array }> | null | { name: string; data: Uint8Array }>,
}))

const saveImageState = vi.hoisted(() => ({
  calls: [] as Uint8Array[],
  queue: [] as Array<Promise<string> | string>,
}))

vi.mock('./platform', async (importActual) => {
  const actual = await importActual<typeof import('./platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'image-emotion-token',
}))

vi.mock('./util', () => {
  return {
    appendLastPath: vi.fn((base: string, next: string) => `${base.replace(/\/$/, '')}/${next.replace(/^\//, '')}`),
    asBuffer: vi.fn((data: Uint8Array | string) => Buffer.from(data)),
    base64url: vi.fn((data: Uint8Array | string) => Buffer.from(data).toString('base64url')),
    blobToUint8Array: vi.fn(async (data: Blob) => new Uint8Array(await data.arrayBuffer())),
    BufferToText: vi.fn((data: Uint8Array) => new TextDecoder().decode(data)),
    changeFullscreen: vi.fn(),
    checkNullish: (data: unknown) => data === undefined || data === null,
    decryptBuffer: vi.fn(async (data: Uint8Array) => data),
    encodeMultilangString: vi.fn((data: string) => data),
    encryptBuffer: vi.fn(async (data: Uint8Array) => data),
    findCharacterbyId: vi.fn(() => ({ name: 'Character' })),
    getAuthorNoteDefaultText: vi.fn(() => ''),
    getNodetextToSentence: vi.fn(() => []),
    getPersonaPrompt: vi.fn(() => ''),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    isKnownUri: vi.fn(() => false),
    jsonOutputTrimmer: vi.fn((data: string) => data),
    languageCodes: [],
    parseKeyValue: vi.fn(() => ({})),
    parseMultilangString: vi.fn((data: string) => data),
    parseToggleSyntax: vi.fn(() => []),
    pickHashRand: vi.fn(() => 0),
    prebuiltAssetCommand: vi.fn(() => false),
    replaceAsync: vi.fn(async (data: string) => data),
    selectFileByDom: vi.fn(),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(async () => {
      const selected = selectedFileState.queue.shift()
      return selected ? await selected : selected
    }),
    simplifySchema: vi.fn((data: unknown) => data),
    sleep: vi.fn(async () => {}),
    sortableOptions: {},
    toLangName: vi.fn((data: string) => data),
    trimUntilPunctuation: vi.fn((data: string) => data),
  }
})

import { clearCachedServerCommandRevision } from './server/commands'
import { setServerProjectionWriteGuardEnabled } from './server/projectionWriteGuard.svelte'
import { DBState, selectedCharID } from './stores.svelte'
import { seedCloneCostDb, withCloneInstrumentation } from './__tests__/cloneCostHarness'
// Import the heavy `./characters` module last so its circular dependency on
// `stores`/`database` finishes initializing before the reactive `moduleUpdate`
// effect can run (matches the working characters.importChat test ordering).
import { rmCharEmotion, selectCharImg } from './characters'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function tick(times = 2): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface CapturedFetch {
  url: string
  method: string
  body: unknown
}

function stubCommandFetch(): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  let revision = 10
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      })

      if (url === '/api/v1/bootstrap') return jsonResponse({ revision })
      if (url === '/api/v1/assets') {
        const body = init.body
        saveImageState.calls.push(body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array())
        const next = saveImageState.queue.shift()
        const assetId = next ? await next : `asset-${saveImageState.calls.length}`
        revision += 1
        return jsonResponse({ assetId, revision })
      }
      if (url.startsWith('/api/v1/commands/characters/')) {
        revision += 1
        return jsonResponse({
          revision,
          event: { type: 'character.updated', revision, resource: 'character' },
          characterId: url.split('/').at(-1),
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

function commandCalls(calls: CapturedFetch[]): CapturedFetch[] {
  return calls.filter((call) => call.url.startsWith('/api/v1/commands/'))
}

function textChunk(key: string, value: string): Uint8Array {
  const keyBytes = new TextEncoder().encode(key)
  const valueBytes = new TextEncoder().encode(value)
  const length = keyBytes.length + 1 + valueBytes.length
  const chunk = new Uint8Array(12 + length)
  chunk[0] = (length >>> 24) & 0xff
  chunk[1] = (length >>> 16) & 0xff
  chunk[2] = (length >>> 8) & 0xff
  chunk[3] = length & 0xff
  chunk.set(new TextEncoder().encode('tEXt'), 4)
  chunk.set(keyBytes, 8)
  chunk[8 + keyBytes.length] = 0
  chunk.set(valueBytes, 9 + keyBytes.length)
  return chunk
}

function minimalPng(chunks: Record<string, string> = {}): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const iend = new Uint8Array([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0])
  const parts = [signature, ...Object.entries(chunks).map(([key, value]) => textChunk(key, value)), iend]
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  const png = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    png.set(part, offset)
    offset += part.length
  }
  return png
}

function avatarFile(name: string, chunks: Record<string, string> = {}) {
  return { name, data: minimalPng(chunks) }
}

function baseCharacter(overrides: Record<string, unknown> = {}) {
  return {
    chaId: 'char-a',
    type: 'character',
    name: 'Character A',
    image: 'old-avatar',
    firstMessage: '',
    desc: '',
    notes: '',
    chats: [{ id: 'chat-a', name: 'Chat A', message: [], localLore: [], note: '' }],
    chatFolders: [],
    chatPage: 0,
    emotionImages: [],
    bias: [],
    viewScreen: 'none',
    globalLore: [],
    sdData: [],
    utilityBot: false,
    customscript: [],
    exampleMessage: '',
    creatorNotes: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    alternateGreetings: [],
    tags: [],
    creator: '',
    characterVersion: '',
    personality: '',
    scenario: '',
    firstMsgIndex: -1,
    replaceGlobalNote: '',
    triggerscript: [],
    additionalText: '',
    ...overrides,
  }
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  selectedCharID.set(0)
  selectedFileState.queue.length = 0
  saveImageState.calls.length = 0
  saveImageState.queue.length = 0
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('Phase 7 image/emotion scoped rollback', () => {
  it('rmCharEmotion captures a single-row baseline, never the whole characters array', async () => {
    // char-0 carries the large 40-message hydrated transcript; the edit targets a
    // small sibling so a whole-array clone would dwarf the single-row clone.
    DBState.db = seedCloneCostDb() as any
    ;(DBState.db.characters[1] as any).emotionImages = [
      ['happy', 'happy.png'],
      ['sad', 'sad.png'],
    ]
    selectedCharID.set(1)
    const charactersSize = JSON.stringify(DBState.db.characters).length
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ revision: 10 })) as unknown as typeof fetch)

    const instrumented = withCloneInstrumentation(() => {
      rmCharEmotion(1, 0)
    })

    // the rollback baseline + diff clone only the one edited row, never the
    // multi-message corpus stored on char-0.
    expect(instrumented.maxClonedSize).toBeLessThan(charactersSize)
    expect(DBState.db.characters[1].emotionImages).toEqual([['sad', 'sad.png']])

    await tick()
  })

  it('rolls back only the edited row on command failure, leaving siblings intact', async () => {
    DBState.db = seedCloneCostDb() as any
    ;(DBState.db.characters[1] as any).emotionImages = [
      ['happy', 'happy.png'],
      ['sad', 'sad.png'],
    ]
    selectedCharID.set(1)

    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        calls.push(url)
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        if (url === '/api/v1/commands/characters/char-1') {
          return jsonResponse({ error: 'nope' }, 500)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    rmCharEmotion(1, 0)
    // a concurrent edit to an unrelated sibling that a whole-array restore wipes.
    DBState.db.characters[2].name = 'Concurrent sibling edit'

    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (DBState.db.characters[1].emotionImages.length >= 2) break
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    // the failed update restores only char-1's emotionImages; the sibling edit
    // survives, proving the rollback did not reinstall the whole characters array.
    expect(DBState.db.characters[1].emotionImages).toEqual([
      ['happy', 'happy.png'],
      ['sad', 'sad.png'],
    ])
    expect(DBState.db.characters[2].name).toBe('Concurrent sibling edit')
  })
})

describe('Phase 3 character avatar upload freshness', () => {
  it('drops a stale upload after a newer avatar edit without appending assets or png metadata', async () => {
    const calls = stubCommandFetch()
    const upload = deferred<string>()
    selectedFileState.queue.push(avatarFile('stale.png', { Description: 'stale metadata' }))
    saveImageState.queue.push(upload.promise)
    DBState.db = {
      characters: [
        baseCharacter({
          image: 'old-avatar',
          ccAssets: [{ type: 'icon', name: 'prior', uri: 'prior-asset', ext: 'png' }],
          extentions: { pngExif: { Title: 'existing metadata' } },
        }),
      ],
    } as any

    const operation = selectCharImg(0)
    await vi.waitFor(() => {
      expect(saveImageState.calls).toHaveLength(1)
    })

    DBState.db.characters[0].image = 'manual-newer-avatar'
    upload.resolve('stale-upload-asset')
    await operation
    await tick()

    expect(DBState.db.characters[0].image).toBe('manual-newer-avatar')
    expect(DBState.db.characters[0].ccAssets).toEqual([{ type: 'icon', name: 'prior', uri: 'prior-asset', ext: 'png' }])
    expect(DBState.db.characters[0].extentions.pngExif).toEqual({ Title: 'existing metadata' })
    expect(commandCalls(calls)).toHaveLength(0)
  })

  it('lets a newer avatar upload for the same character win over an older delayed upload', async () => {
    const calls = stubCommandFetch()
    const olderUpload = deferred<string>()
    const newerUpload = deferred<string>()
    selectedFileState.queue.push(
      avatarFile('older.png', { Title: 'older metadata' }),
      avatarFile('newer.png', { Title: 'newer metadata' }),
    )
    saveImageState.queue.push(olderUpload.promise, newerUpload.promise)
    DBState.db = {
      characters: [baseCharacter({ image: 'initial-avatar', ccAssets: [] })],
    } as any

    const olderOperation = selectCharImg(0)
    await vi.waitFor(() => {
      expect(saveImageState.calls).toHaveLength(1)
    })

    const newerOperation = selectCharImg(0)
    await vi.waitFor(() => {
      expect(saveImageState.calls).toHaveLength(2)
    })

    newerUpload.resolve('newer-upload-asset')
    await newerOperation
    await vi.waitFor(() => {
      expect(commandCalls(calls)).toHaveLength(1)
    })

    olderUpload.resolve('older-upload-asset')
    await olderOperation
    await tick()

    expect(DBState.db.characters[0].image).toBe('newer-upload-asset')
    expect(DBState.db.characters[0].ccAssets).toEqual([
      { type: 'icon', name: 'iconx', uri: 'initial-avatar', ext: 'png' },
    ])
    expect(DBState.db.characters[0].extentions.pngExif).toEqual({ Title: 'newer metadata' })
    expect(commandCalls(calls)).toHaveLength(1)
  })

  it('keeps an older pending upload current when a newer picker is canceled', async () => {
    const calls = stubCommandFetch()
    const olderUpload = deferred<string>()
    selectedFileState.queue.push(avatarFile('older.png', { Title: 'older metadata' }), null)
    saveImageState.queue.push(olderUpload.promise)
    DBState.db = {
      characters: [baseCharacter({ image: 'initial-avatar', ccAssets: [] })],
    } as any

    const olderOperation = selectCharImg(0)
    await vi.waitFor(() => {
      expect(saveImageState.calls).toHaveLength(1)
    })

    await selectCharImg(0)
    expect(saveImageState.calls).toHaveLength(1)

    olderUpload.resolve('older-upload-asset')
    await olderOperation
    await vi.waitFor(() => {
      expect(commandCalls(calls)).toHaveLength(1)
    })

    expect(DBState.db.characters[0].image).toBe('older-upload-asset')
    expect(DBState.db.characters[0].ccAssets).toEqual([
      { type: 'icon', name: 'iconx', uri: 'initial-avatar', ext: 'png' },
    ])
    expect(DBState.db.characters[0].extentions.pngExif).toEqual({ Title: 'older metadata' })
  })

  it('drops a stale upload when the target row id changes before upload resolution', async () => {
    const calls = stubCommandFetch()
    const upload = deferred<string>()
    selectedFileState.queue.push(avatarFile('stale-row.png', { Title: 'stale row metadata' }))
    saveImageState.queue.push(upload.promise)
    DBState.db = {
      characters: [baseCharacter({ chaId: 'char-a', image: 'old-avatar', ccAssets: [] })],
    } as any

    const operation = selectCharImg(0)
    await vi.waitFor(() => {
      expect(saveImageState.calls).toHaveLength(1)
    })

    DBState.db.characters[0] = baseCharacter({
      chaId: 'char-replacement',
      name: 'Replacement',
      image: 'replacement-avatar',
      ccAssets: [],
    })
    upload.resolve('stale-row-upload-asset')
    await operation
    await tick()

    expect(DBState.db.characters[0]).toMatchObject({
      chaId: 'char-replacement',
      image: 'replacement-avatar',
      ccAssets: [],
    })
    expect(DBState.db.characters[0].extentions?.pngExif).toBeUndefined()
    expect(commandCalls(calls)).toHaveLength(0)
  })
})
