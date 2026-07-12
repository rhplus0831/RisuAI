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
import { setResourceWriteGuardEnabled } from './server/resourceWriteGuard.svelte'
import './stores.svelte'
import { getDatabase, setDatabaseLite } from './storage/database.svelte'
import { importUserPersona, selectUserImg, updateSelectedPersonaField } from './persona'
import { PngChunk } from './pngChunk'

interface CapturedFetch {
  url: string
  method: string
  body: unknown
}

interface StubCommandFetchOptions {
  personaCommandResponses?: Array<Promise<Response> | Response>
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
  setDatabaseLite({
    characters: [],
    personas,
    selectedPersona,
    username: selected?.name ?? '',
    userIcon: selected?.icon ?? '',
    personaPrompt: selected?.personaPrompt ?? '',
    userNote: selected?.note ?? '',
  } as any)
}

function selectPersonaDirect(index: number): void {
  const target = getDatabase().personas[index]
  getDatabase().selectedPersona = index
  getDatabase().username = target.name
  getDatabase().userIcon = target.icon
  getDatabase().personaPrompt = target.personaPrompt
  getDatabase().userNote = target.note
}

function personaFile(name = 'persona.png') {
  return { name, data: new Uint8Array([1, 2, 3, 4]) }
}

const BASE_PNG = new Uint8Array(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'),
)

async function personaImportFile(
  patch: { name?: string; personaPrompt?: string; note?: string } = {},
  name = 'persona-import.png',
) {
  const card = {
    name: 'Imported Persona',
    personaPrompt: 'Imported prompt',
    note: 'Imported note',
    ...patch,
  }
  const png = await PngChunk.write(BASE_PNG, {
    persona: Buffer.from(JSON.stringify(card)).toString('base64'),
  })
  if (!png) throw new Error('failed to build persona PNG fixture')
  return { name, data: new Uint8Array(png) }
}

async function tick(times = 2): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function stubCommandFetch(
  assetQueue: Array<Promise<string> | string> = [],
  options: StubCommandFetchOptions = {},
): CapturedFetch[] {
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
        const nextCommandResponse = options.personaCommandResponses?.shift()
        if (nextCommandResponse) return nextCommandResponse
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
      if (url === '/api/v1/commands/personas') {
        const nextCommandResponse = options.personaCommandResponses?.shift()
        if (nextCommandResponse) return nextCommandResponse
        revision += 1
        return jsonResponse({
          revision,
          event: {
            type: 'persona.created',
            revision,
            resource: 'persona',
            id: 'created-persona',
          },
          personaId: 'created-persona',
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
  setResourceWriteGuardEnabled(false)
  selectedFileState.queue.length = 0
})

afterEach(() => {
  setResourceWriteGuardEnabled(false)
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

    expect(getDatabase().selectedPersona).toBe(1)
    expect(getDatabase().userIcon).toBe('icon-b')
    expect(getDatabase().personas[0].icon).toBe('icon-a')
    expect(getDatabase().personas[1].icon).toBe('icon-b')
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

    expect(getDatabase()).toMatchObject({
      username: 'Edited Name',
      personaPrompt: 'Edited prompt',
      userNote: 'Edited note',
      userIcon: 'fresh-icon',
    })
    expect(getDatabase().personas[0]).toMatchObject({
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

    expect(getDatabase().userIcon).toBe('older-icon')
    expect(getDatabase().personas[0].icon).toBe('older-icon')
  })

  it('failed icon save rolls back only attempted icon fields after newer profile and selection changes', async () => {
    const command = deferred<Response>()
    const calls = stubCommandFetch(['attempted-icon'], {
      personaCommandResponses: [command.promise],
    })
    selectedFileState.queue.push(personaFile('rollback-icon.png'))
    seedPersonaState(
      [
        makePersona({ id: 'persona-a', name: 'Persona A', icon: 'old-icon-a' }),
        makePersona({ id: 'persona-b', name: 'Persona B', icon: 'old-icon-b' }),
      ],
      0,
    )

    const operation = selectUserImg()
    await vi.waitFor(() => {
      expect(commandCalls(calls)).toHaveLength(1)
    })

    getDatabase().personas[0] = {
      ...getDatabase().personas[0],
      name: 'Persona A edited after dispatch',
    } as any
    selectPersonaDirect(1)
    getDatabase().username = 'Persona B live name'
    getDatabase().userIcon = 'old-icon-b'
    getDatabase().personaPrompt = 'Persona B live prompt'
    getDatabase().userNote = 'Persona B live note'
    command.resolve(jsonResponse({ error: 'persona icon failed' }, 500))
    await operation
    await tick()

    expect(getDatabase().personas[0]).toMatchObject({
      id: 'persona-a',
      name: 'Persona A edited after dispatch',
      icon: 'old-icon-a',
    })
    expect(getDatabase()).toMatchObject({
      selectedPersona: 1,
      username: 'Persona B live name',
      userIcon: 'old-icon-b',
      personaPrompt: 'Persona B live prompt',
      userNote: 'Persona B live note',
    })
  })

  it('failed import create removes only the unchanged imported row and preserves newer rows and selection', async () => {
    const command = deferred<Response>()
    const calls = stubCommandFetch(['imported-icon'], {
      personaCommandResponses: [command.promise],
    })
    selectedFileState.queue.push(
      await personaImportFile({
        name: 'Imported Persona',
        personaPrompt: 'Imported prompt',
        note: 'Imported note',
      }),
    )
    seedPersonaState(
      [
        makePersona({ id: 'persona-a', name: 'Persona A', icon: 'icon-a' }),
        makePersona({ id: 'persona-b', name: 'Persona B', icon: 'icon-b' }),
      ],
      0,
    )

    const operation = importUserPersona()
    await vi.waitFor(() => {
      expect(commandCalls(calls)).toHaveLength(1)
    })

    const imported = getDatabase().personas.find((persona) => persona.name === 'Imported Persona')
    expect(imported?.icon).toBe('imported-icon')
    getDatabase().personas[0] = {
      ...getDatabase().personas[0],
      name: 'Persona A edited after dispatch',
    } as any
    getDatabase().personas.push(
      makePersona({
        id: 'persona-d',
        name: 'Persona D appended after dispatch',
        icon: 'icon-d',
        personaPrompt: 'D prompt',
        note: 'D note',
      }) as any,
    )
    getDatabase().selectedPersona = 3
    getDatabase().username = 'Persona D live name'
    getDatabase().userIcon = 'icon-d'
    getDatabase().personaPrompt = 'Persona D live prompt'
    getDatabase().userNote = 'Persona D live note'
    command.resolve(jsonResponse({ error: 'persona import failed' }, 500))
    await operation
    await tick()

    expect(getDatabase().personas.map((persona) => persona.id)).toEqual(['persona-a', 'persona-b', 'persona-d'])
    expect(getDatabase().personas[0]).toMatchObject({
      id: 'persona-a',
      name: 'Persona A edited after dispatch',
    })
    expect(getDatabase().personas[2]).toMatchObject({
      id: 'persona-d',
      name: 'Persona D appended after dispatch',
    })
    expect(getDatabase()).toMatchObject({
      selectedPersona: 2,
      username: 'Persona D live name',
      userIcon: 'icon-d',
      personaPrompt: 'Persona D live prompt',
      userNote: 'Persona D live note',
    })
  })
})
