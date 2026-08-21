import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sha256Hex } from '../sha256Fallback'
import { pluginV2 } from '../plugins/plugins.svelte'
import {
  clearCachedServerCommandRevision,
  peekCachedServerCommandRevision,
  runServerCommand,
  selectCharacterCommand,
  setCachedServerCommandRevision,
} from './commands'
import { resetWriterAccessLostForTests } from './activeWriterSession'
import { displaySourceNamespaceJson } from '../process/displaySourceProtocol'
import {
  configureDisplaySourceProtocol,
  requestServerDisplaySource,
  resetDisplaySourceClientForTests,
} from './displaySources'

vi.mock('../storage/fastifyStorage', () => ({ getNodeServerProxyAuth: vi.fn(async () => 'display-auth') }))
vi.mock('../plugins/plugins.svelte', () => ({ pluginV2: { editdisplay: new Set() } }))

interface DisplayRequestBody {
  baseRevision: number
  context: { pageSessionId: string; browserLanguage?: string; screenWidth?: number; screenHeight?: number }
  targets: Array<{ requestKey: string; source: string; sourceHash: string }>
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function successfulDisplayResponse(body: DisplayRequestBody, revision: number): Promise<Response> {
  const contextFingerprint = await sha256Hex(
    displaySourceNamespaceJson({ databaseLineage: 'lineage-a', activeWriterEpoch: 3, context: body.context }),
  )
  return jsonResponse({
    protocolVersion: 1,
    revision,
    contextFingerprint,
    entries: body.targets.map((target) => ({
      requestKey: target.requestKey,
      status: 'ok',
      sourceHash: target.sourceHash,
      dependencyFingerprint: `dep:${target.source}`,
      displaySource: target.source.toUpperCase(),
    })),
  })
}

describe('browser display source batching bridge', () => {
  beforeEach(() => {
    resetWriterAccessLostForTests()
    resetDisplaySourceClientForTests()
    clearCachedServerCommandRevision()
    pluginV2.editdisplay.clear()
    setCachedServerCommandRevision(7)
    configureDisplaySourceProtocol({ version: 1 }, 'lineage-a', 3)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    pluginV2.editdisplay.clear()
    resetDisplaySourceClientForTests()
    clearCachedServerCommandRevision()
  })

  it('batches same-chat transforms and validates the exact namespace/source response', async () => {
    const requests: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as DisplayRequestBody
      requests.push(body as unknown as Record<string, unknown>)
      return successfulDisplayResponse(body, 7)
    })

    const character = { chaId: 'char-a', name: 'Tess' }
    const [first, second] = await Promise.all([
      requestServerDisplaySource({
        chatId: 'chat-a',
        character,
        messageId: 'message-a',
        index: 0,
        role: 'char',
        firstMessage: false,
        layer: 'original',
        source: 'first',
      }),
      requestServerDisplaySource({
        chatId: 'chat-a',
        character,
        messageId: 'message-b',
        index: 1,
        role: 'char',
        firstMessage: false,
        layer: 'translation',
        source: 'second',
      }),
    ])

    expect(requests).toHaveLength(1)
    expect(requests[0].targets as unknown[]).toHaveLength(2)
    expect(requests[0].context).toMatchObject({ screenWidth: window.innerWidth, screenHeight: window.innerHeight })
    expect(first).toMatchObject({ status: 'ok', displaySource: 'FIRST' })
    expect(second).toMatchObject({ status: 'ok', displaySource: 'SECOND' })
  })

  it('holds the shared revision lane until a display response advances the cursor', async () => {
    const deferredDisplayResponse = createDeferred<Response>()
    const displayRequests: DisplayRequestBody[] = []
    const selectionRequests: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        const body = JSON.parse(String(init.body)) as DisplayRequestBody
        if (url.endsWith('/display-sources')) {
          displayRequests.push(body)
          return deferredDisplayResponse.promise
        }
        if (url === '/api/v1/commands/characters/select') {
          selectionRequests.push(body as unknown as Record<string, unknown>)
          return jsonResponse({
            revision: 9,
            event: { type: 'character.selected', revision: 9, resource: 'characterSelection', id: 'char-b' },
            characterId: 'char-b',
          })
        }
        throw new Error(`Unexpected request: ${url}`)
      }) as unknown as typeof fetch,
    )

    const display = requestServerDisplaySource({
      chatId: 'chat-a',
      character: { chaId: 'char-a' },
      messageId: 'message-a',
      index: 0,
      role: 'char',
      firstMessage: false,
      layer: 'original',
      source: 'first',
    })
    await vi.waitFor(() => expect(displayRequests).toHaveLength(1))

    const selection = runServerCommand({
      command: (baseRevision) =>
        selectCharacterCommand({
          baseRevision,
          characterId: 'char-b',
          lastInteraction: 1234,
        }),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(selectionRequests).toHaveLength(0)

    deferredDisplayResponse.resolve(await successfulDisplayResponse(displayRequests[0], 8))
    await expect(display).resolves.toMatchObject({ status: 'ok', displaySource: 'FIRST' })
    await vi.waitFor(() => expect(selectionRequests).toHaveLength(1))
    expect(selectionRequests[0]).toMatchObject({
      baseRevision: 8,
      characterId: 'char-b',
      lastInteraction: 1234,
    })
    await expect(selection).resolves.toMatchObject({ status: 'ok', revision: 9 })
    expect(peekCachedServerCommandRevision()).toBe(9)
  })

  it('serializes display batches that are scheduled while an earlier batch is in flight', async () => {
    const deferredFirstResponse = createDeferred<Response>()
    const requests: DisplayRequestBody[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        const body = JSON.parse(String(init.body)) as DisplayRequestBody
        requests.push(body)
        if (requests.length === 1) return deferredFirstResponse.promise
        return successfulDisplayResponse(body, 9)
      }) as unknown as typeof fetch,
    )

    const first = requestServerDisplaySource({
      chatId: 'chat-a',
      character: { chaId: 'char-a' },
      messageId: 'message-a',
      index: 0,
      role: 'char',
      firstMessage: false,
      layer: 'original',
      source: 'first',
    })
    await vi.waitFor(() => expect(requests).toHaveLength(1))

    const second = requestServerDisplaySource({
      chatId: 'chat-a',
      character: { chaId: 'char-a' },
      messageId: 'message-b',
      index: 1,
      role: 'char',
      firstMessage: false,
      layer: 'original',
      source: 'second',
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requests).toHaveLength(1)

    deferredFirstResponse.resolve(await successfulDisplayResponse(requests[0], 8))
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    expect(requests.map((request) => request.baseRevision)).toEqual([7, 8])
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 'ok', displaySource: 'FIRST' }),
      expect.objectContaining({ status: 'ok', displaySource: 'SECOND' }),
    ])
    expect(peekCachedServerCommandRevision()).toBe(9)
  })

  it('selects the whole client path without a request when an editdisplay plugin is registered', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    pluginV2.editdisplay.add(async (source) => source)

    await expect(
      requestServerDisplaySource({
        chatId: 'chat-a',
        character: { chaId: 'char-a' },
        index: 0,
        role: 'char',
        firstMessage: false,
        layer: 'original',
        source: 'body',
      }),
    ).resolves.toEqual({ status: 'fallback', reason: 'browser_editdisplay_plugin' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
