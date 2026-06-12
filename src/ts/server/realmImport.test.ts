import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))
const commandState = vi.hoisted(() => ({
  baseRevision: 7 as number | null,
  cachedRevision: null as number | null,
}))

vi.mock('../platform', async (importActual) => {
  const actual = await importActual<typeof import('../platform')>()
  return {
    ...actual,
    get isFastifyServer() {
      return platformState.isFastifyServer
    },
  }
})

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'realm-auth-token',
}))

vi.mock('./activeWriterSession', () => ({
  activeWriterSessionHeader: () => ({ 'risu-writer-session': 'writer-a' }),
  handleActiveWriterStaleResponse: () => false,
}))

vi.mock('./commands', () => ({
  getServerCommandBaseRevision: async () => commandState.baseRevision,
  setCachedServerCommandRevision: (revision: number) => {
    commandState.cachedRevision = revision
  },
}))

import { importRealmCharacterFromServer } from './realmImport'

interface CapturedFetch {
  url: string
  headers: Record<string, string>
  body: unknown
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(text))
      controller.close()
    },
  })
}

function stubRealmFetch(response: Response): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string>
      calls.push({
        url: String(input),
        headers,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      })
      return response
    }) as unknown as typeof fetch,
  )
  return calls
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  platformState.isFastifyServer = true
  commandState.baseRevision = 7
  commandState.cachedRevision = null
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Realm import server adapter', () => {
  it('reads progress SSE frames and returns the done payload', async () => {
    const calls = stubRealmFetch(
      new Response(
        streamOf(
          [
            'event: progress',
            'data: {"phase":"download","message":"Downloading Realm character","percent":12}',
            '',
            'event: done',
            'data: {"revision":9,"event":{"type":"character.created","resource":"character","revision":9},"characterId":"char-1"}',
            '',
            '',
          ].join('\n'),
        ),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    )
    const progress: unknown[] = []

    const result = await importRealmCharacterFromServer('realm-id', {
      onProgress: (frame) => progress.push(frame),
    })

    expect(result).toMatchObject({ status: 'ok', revision: 9, characterId: 'char-1' })
    expect(progress).toEqual([{ phase: 'download', message: 'Downloading Realm character', percent: 12 }])
    expect(calls[0]).toMatchObject({
      url: '/api/v1/import/realm-character',
      headers: {
        accept: 'text/event-stream',
        'risu-auth': 'realm-auth-token',
        'risu-writer-session': 'writer-a',
      },
      body: { id: 'realm-id', baseRevision: 7, allowLowLevelAccess: false },
    })
    expect(commandState.cachedRevision).toBe(9)
  })

  it('falls back to JSON parsing when progress is requested but JSON is returned', async () => {
    stubRealmFetch(
      jsonResponse({
        revision: 11,
        event: { type: 'character.created', resource: 'character', revision: 11 },
        characterId: 'char-json',
      }),
    )

    const result = await importRealmCharacterFromServer('realm-id', { onProgress: vi.fn() })

    expect(result).toMatchObject({ status: 'ok', revision: 11, characterId: 'char-json' })
    expect(commandState.cachedRevision).toBe(11)
  })

  it('maps progress stream low-level-access and conflicts', async () => {
    stubRealmFetch(
      new Response(
        streamOf(['event: conflict', 'data: {"error":"Revision mismatch","currentRevision":15}', '', ''].join('\n')),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    )

    await expect(importRealmCharacterFromServer('realm-id', { onProgress: vi.fn() })).resolves.toEqual({
      status: 'conflict',
      currentRevision: 15,
    })
    expect(commandState.cachedRevision).toBe(15)

    stubRealmFetch(
      new Response(streamOf(['event: low_level_access', 'data: {"error":"confirm"}', '', ''].join('\n')), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    )

    await expect(importRealmCharacterFromServer('realm-id', { onProgress: vi.fn() })).resolves.toEqual({
      status: 'low-level-access',
    })
  })
})
