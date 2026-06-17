import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const selectedFileState = vi.hoisted(() => ({
  queue: [] as Array<null | { name: string; data: Uint8Array }>,
}))

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'persona-icon-token',
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
    selectMultipleFile: vi.fn(async () => []),
    selectSingleFile: vi.fn(async (_ext: string[], options: { onFileSelected?: (file: File) => void } = {}) => {
      const selected = selectedFileState.queue.shift() ?? null
      if (!selected) return null
      options.onFileSelected?.({ name: selected.name } as File)
      return selected
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
import { DBState } from './stores.svelte'
import { selectUserImg, updateSelectedPersonaField } from './persona'

interface CapturedFetch {
  url: string
  method: string
  body: unknown
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makePersona(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'persona-a',
    name: 'Persona A',
    icon: 'old-icon',
    personaPrompt: 'Old prompt',
    note: 'Old note',
    largePortrait: false,
    ...patch,
  }
}

function seedPersonaState(personas: Array<Record<string, unknown>>, selectedPersona = 0): void {
  const selected = personas[selectedPersona]
  DBState.db = {
    characters: [],
    personas,
    selectedPersona,
    username: selected?.name ?? '',
    userIcon: selected?.icon ?? '',
    personaPrompt: selected?.personaPrompt ?? '',
    userNote: selected?.note ?? '',
  } as any
}

function selectPersonaDirect(index: number): void {
  const target = DBState.db.personas[index]
  DBState.db.selectedPersona = index
  DBState.db.username = target.name
  DBState.db.userIcon = target.icon
  DBState.db.personaPrompt = target.personaPrompt
  DBState.db.userNote = target.note
}

function personaFile(name = 'persona.png') {
  return { name, data: new Uint8Array([1, 2, 3, 4]) }
}

async function tick(times = 2): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function stubCommandFetch(assetQueue: Array<Promise<string> | string> = []): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  let revision = 20
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
        const next = assetQueue.shift()
        const assetId = next ? await next : `asset-${revision}`
        revision += 1
        return jsonResponse({ assetId, revision })
      }
      if (url.startsWith('/api/v1/commands/personas/')) {
        revision += 1
        return jsonResponse({
          revision,
          event: {
            type: 'persona.updated',
            revision,
            resource: 'persona',
            id: url.split('/').at(-1),
          },
          personaId: url.split('/').at(-1),
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

beforeEach(() => {
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  selectedFileState.queue.length = 0
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('Phase 3 persona icon upload freshness', () => {
  it('drops stale completion if selected persona changes before saveImage resolves', async () => {
    const upload = deferred<string>()
    const calls = stubCommandFetch([upload.promise])
    selectedFileState.queue.push(personaFile('stale.png'))
    seedPersonaState(
      [
        makePersona({ id: 'persona-a', name: 'Persona A', icon: 'icon-a' }),
        makePersona({ id: 'persona-b', name: 'Persona B', icon: 'icon-b' }),
      ],
      0,
    )
    const operation = selectUserImg()
    await vi.waitFor(() => {
      expect(calls.filter((call) => call.url === '/api/v1/assets')).toHaveLength(1)
    })

    selectPersonaDirect(1)
    upload.resolve('late-icon')
    await operation
    await tick()

    expect(DBState.db.selectedPersona).toBe(1)
    expect(DBState.db.userIcon).toBe('icon-b')
    expect(DBState.db.personas[0].icon).toBe('icon-a')
    expect(DBState.db.personas[1].icon).toBe('icon-b')
    expect(commandCalls(calls)).toHaveLength(0)
  })

  it('preserves same-persona text edits while applying a fresh icon', async () => {
    const upload = deferred<string>()
    const calls = stubCommandFetch([upload.promise])
    selectedFileState.queue.push(personaFile('fresh.png'))
    seedPersonaState(
      [
        makePersona({
          id: 'persona-edit',
          name: 'Old Name',
          icon: 'old-icon',
          personaPrompt: 'Old prompt',
          note: 'Old note',
          largePortrait: true,
        }),
      ],
      0,
    )

    const operation = selectUserImg()
    await vi.waitFor(() => {
      expect(calls.filter((call) => call.url === '/api/v1/assets')).toHaveLength(1)
    })

    updateSelectedPersonaField('username', 'Edited Name')
    updateSelectedPersonaField('personaPrompt', 'Edited prompt')
    updateSelectedPersonaField('userNote', 'Edited note')
    upload.resolve('fresh-icon')
    await operation

    await vi.waitFor(() => {
      expect(commandCalls(calls)).toHaveLength(1)
    })

    expect(DBState.db).toMatchObject({
      username: 'Edited Name',
      personaPrompt: 'Edited prompt',
      userNote: 'Edited note',
      userIcon: 'fresh-icon',
    })
    expect(DBState.db.personas[0]).toMatchObject({
      id: 'persona-edit',
      name: 'Edited Name',
      icon: 'fresh-icon',
      personaPrompt: 'Edited prompt',
      note: 'Edited note',
      largePortrait: true,
    })
    expect(commandCalls(calls)[0].body).toMatchObject({
      patch: {
        name: 'Edited Name',
        icon: 'fresh-icon',
        personaPrompt: 'Edited prompt',
        note: 'Edited note',
      },
      mirrorLegacyProfile: true,
    })
  })

  it('does not let a canceled picker invalidate an older selected pending upload', async () => {
    const upload = deferred<string>()
    const calls = stubCommandFetch([upload.promise])
    selectedFileState.queue.push(personaFile('older.png'), null)
    seedPersonaState([makePersona({ id: 'persona-a', icon: 'old-icon' })], 0)

    const olderOperation = selectUserImg()
    await vi.waitFor(() => {
      expect(calls.filter((call) => call.url === '/api/v1/assets')).toHaveLength(1)
    })

    await selectUserImg()
    expect(calls.filter((call) => call.url === '/api/v1/assets')).toHaveLength(1)

    upload.resolve('older-icon')
    await olderOperation
    await vi.waitFor(() => {
      expect(commandCalls(calls)).toHaveLength(1)
    })

    expect(DBState.db.userIcon).toBe('older-icon')
    expect(DBState.db.personas[0].icon).toBe('older-icon')
  })
})
