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
import { displaySourceNamespaceJson } from '@risuai/protocol/display-source'
import { reloadRegexDisplay, resetRegexDisplayReloadForTests } from '../process/regexDisplayReload'
import {
  activateDisplaySourceChat,
  configureDisplaySourceProtocol,
  requestServerDisplaySource,
  resetDisplaySourceClientForTests,
} from './displaySources'

const pluginRuntime = vi.hoisted(() => ({ ready: true }))

vi.mock('../storage/fastifyStorage', () => ({ getNodeServerProxyAuth: vi.fn(async () => 'display-auth') }))
vi.mock('../plugins/plugins.svelte', () => ({
  isPluginRuntimeReady: () => pluginRuntime.ready,
  pluginV2: { editdisplay: new Set() },
}))

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
    pluginRuntime.ready = true
    resetWriterAccessLostForTests()
    resetDisplaySourceClientForTests()
    clearCachedServerCommandRevision()
    pluginV2.editdisplay.clear()
    resetRegexDisplayReloadForTests()
    setCachedServerCommandRevision(7)
    configureDisplaySourceProtocol({ version: 1 }, 'lineage-a', 3)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    pluginV2.editdisplay.clear()
    resetDisplaySourceClientForTests()
    clearCachedServerCommandRevision()
    resetRegexDisplayReloadForTests()
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

  it('deduplicates identical in-flight and completed targets until their regex owner activates', async () => {
    const requests: DisplayRequestBody[] = []
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as DisplayRequestBody
      requests.push(body)
      return successfulDisplayResponse(body, 7)
    })

    const input = {
      chatId: 'chat-a',
      character: { chaId: 'char-a', name: 'Tess' },
      messageId: 'message-a',
      index: 0,
      role: 'char',
      firstMessage: false,
      layer: 'original' as const,
      source: 'same source',
    }
    const [first, duplicate] = await Promise.all([requestServerDisplaySource(input), requestServerDisplaySource(input)])

    expect(requests).toHaveLength(1)
    expect(requests[0].targets).toHaveLength(1)
    expect(first).toEqual(duplicate)

    await expect(requestServerDisplaySource(input)).resolves.toEqual(first)
    expect(requests).toHaveLength(1)

    reloadRegexDisplay('char-b')
    await expect(requestServerDisplaySource(input)).resolves.toEqual(first)
    expect(requests).toHaveLength(1)

    reloadRegexDisplay('char-a')
    await expect(requestServerDisplaySource(input)).resolves.toMatchObject({
      status: 'ok',
      displaySource: 'SAME SOURCE',
    })
    expect(requests).toHaveLength(2)
  })

  it('releases critical newest-message results before deferred background rows', async () => {
    activateDisplaySourceChat('chat-a')
    const deferredCriticalResponse = createDeferred<Response>()
    const requests: DisplayRequestBody[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        const body = JSON.parse(String(init.body)) as DisplayRequestBody
        requests.push(body)
        if (requests.length === 1) return deferredCriticalResponse.promise
        return successfulDisplayResponse(body, 9)
      }) as unknown as typeof fetch,
    )

    const character = { chaId: 'char-a' }
    const background = requestServerDisplaySource({
      chatId: 'chat-a',
      character,
      messageId: 'message-old',
      index: 0,
      role: 'char',
      firstMessage: false,
      layer: 'original',
      source: 'old',
      priority: 'background',
    })
    const critical = [
      requestServerDisplaySource({
        chatId: 'chat-a',
        character,
        messageId: 'message-latest-a',
        index: 8,
        role: 'char',
        firstMessage: false,
        layer: 'original',
        source: 'latest-a',
        priority: 'critical',
      }),
      requestServerDisplaySource({
        chatId: 'chat-a',
        character,
        messageId: 'message-latest-b',
        index: 9,
        role: 'char',
        firstMessage: false,
        layer: 'original',
        source: 'latest-b',
        priority: 'critical',
      }),
    ]

    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0].targets.map((target) => target.source)).toEqual(['latest-a', 'latest-b'])
    deferredCriticalResponse.resolve(await successfulDisplayResponse(requests[0], 8))
    await expect(Promise.all(critical)).resolves.toEqual([
      expect.objectContaining({ status: 'ok', displaySource: 'LATEST-A' }),
      expect.objectContaining({ status: 'ok', displaySource: 'LATEST-B' }),
    ])

    await vi.waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1].baseRevision).toBe(8)
    expect(requests[1].targets.map((target) => target.source)).toEqual(['old'])
    await expect(background).resolves.toMatchObject({ status: 'ok', displaySource: 'OLD' })
  })

  it('aborts obsolete visible-chat work so navigation can use the revision lane', async () => {
    activateDisplaySourceChat('chat-a')
    const requests: DisplayRequestBody[] = []
    let firstRequestAborted = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        const body = JSON.parse(String(init.body)) as DisplayRequestBody
        requests.push(body)
        if (requests.length > 1) return successfulDisplayResponse(body, 8)
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => {
              firstRequestAborted = true
              reject(init.signal?.reason)
            },
            { once: true },
          )
        })
      }) as unknown as typeof fetch,
    )

    const obsolete = requestServerDisplaySource({
      chatId: 'chat-a',
      character: { chaId: 'char-a' },
      messageId: 'message-a',
      index: 0,
      role: 'char',
      firstMessage: false,
      layer: 'original',
      source: 'obsolete',
      priority: 'critical',
    })
    await vi.waitFor(() => expect(requests).toHaveLength(1))

    activateDisplaySourceChat('chat-b')
    await expect(obsolete).resolves.toEqual({ status: 'fallback', reason: 'display_scope_changed' })
    expect(firstRequestAborted).toBe(true)

    const current = requestServerDisplaySource({
      chatId: 'chat-b',
      character: { chaId: 'char-b' },
      messageId: 'message-b',
      index: 0,
      role: 'char',
      firstMessage: false,
      layer: 'original',
      source: 'current',
      priority: 'critical',
    })
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    await expect(current).resolves.toMatchObject({ status: 'ok', displaySource: 'CURRENT' })
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

  it('ignores a partial editdisplay registration while plugin runtime is not ready', async () => {
    pluginRuntime.ready = false
    pluginV2.editdisplay.add(async (source) => source)
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      const body = JSON.parse(String(init.body)) as DisplayRequestBody
      return successfulDisplayResponse(body, 8)
    })
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)

    await expect(
      requestServerDisplaySource({
        chatId: 'chat-a',
        character: { chaId: 'char-a' },
        index: 0,
        role: 'assistant',
        firstMessage: false,
        layer: 'original',
        source: 'body',
      }),
    ).resolves.toMatchObject({ status: 'ok', displaySource: 'BODY' })
    expect(fetchSpy).toHaveBeenCalledOnce()
  })
})
