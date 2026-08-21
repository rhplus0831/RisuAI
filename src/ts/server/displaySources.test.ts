import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sha256Hex } from '../sha256Fallback'
import { pluginV2 } from '../plugins/plugins.svelte'
import { clearCachedServerCommandRevision, setCachedServerCommandRevision } from './commands'
import { resetWriterAccessLostForTests } from './activeWriterSession'
import { displaySourceNamespaceJson } from '../process/displaySourceProtocol'
import {
  configureDisplaySourceProtocol,
  requestServerDisplaySource,
  resetDisplaySourceClientForTests,
} from './displaySources'

vi.mock('../storage/fastifyStorage', () => ({ getNodeServerProxyAuth: vi.fn(async () => 'display-auth') }))
vi.mock('../plugins/plugins.svelte', () => ({ pluginV2: { editdisplay: new Set() } }))

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
      const body = JSON.parse(String(init?.body)) as {
        context: { pageSessionId: string; browserLanguage?: string; screenWidth?: number; screenHeight?: number }
        targets: Array<{ requestKey: string; source: string; sourceHash: string }>
      }
      requests.push(body as unknown as Record<string, unknown>)
      const contextFingerprint = await sha256Hex(
        displaySourceNamespaceJson({ databaseLineage: 'lineage-a', activeWriterEpoch: 3, context: body.context }),
      )
      return new Response(
        JSON.stringify({
          protocolVersion: 1,
          revision: 7,
          contextFingerprint,
          entries: body.targets.map((target) => ({
            requestKey: target.requestKey,
            status: 'ok',
            sourceHash: target.sourceHash,
            dependencyFingerprint: `dep:${target.source}`,
            displaySource: target.source.toUpperCase(),
          })),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
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
