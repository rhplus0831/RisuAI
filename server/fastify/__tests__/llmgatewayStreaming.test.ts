import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it, vi } from 'vitest'
import { resolveModelProfile } from '@risuai/shared-core/model-profile-resolver'
import { dispatchChatProvider } from '../src/prompt/chatDispatch.js'
import { applyProfileBoundGenerationFields } from '../src/prompt/effectiveGenerationConfig.js'
import { emitProviderChunks } from '../src/prompt/providerTransport.js'
import type { PromptChatEvent } from '../src/prompt/sseEvents.js'
import { tokenize } from '../src/prompt/tokens.js'
import { tokenizerEncodingFromDb } from '../src/prompt/tokenizerConfig.js'
import type { FastifyDatabase } from '../src/prompt/serverTypes.js'
import { createRequestHistoryTable, getRequestHistoryRecord, listRequestHistory } from '../src/requestHistory.js'

afterEach(() => vi.unstubAllGlobals())

it.each([false, true])(
  'streams LLM Gateway with Strip CoT and halfStreaming=%s before the provider finishes',
  async (halfStreaming) => {
    const database = {
      modelRuntimeDefaults: { useStreaming: !halfStreaming, halfStreaming, stripCoT: true },
      providerCredentials: [{ id: 'key', name: 'Test', type: 'apiKey', apiKey: 'test-key' }],
      modelProfiles: [
        {
          id: 'gateway',
          name: 'Gateway',
          providerId: 'llmgateway',
          modelId: 'test-model',
          providerOptions: { credentialId: 'key' },
        },
      ],
      modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'gateway' } },
      requestHistoryLimit: 5,
    } as unknown as FastifyDatabase
    const profile = resolveModelProfile({ database })
    applyProfileBoundGenerationFields(database, profile)
    const historyDb = new DatabaseSync(':memory:')
    createRequestHistoryTable(historyDb)
    let controller!: ReadableStreamDefaultController<Uint8Array>
    let reads = 0
    const encoder = new TextEncoder()
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          start(value) {
            controller = value
          },
          pull() {
            reads += 1
          },
        },
        { highWaterMark: 0 },
      ),
      { headers: { 'content-type': 'text/event-stream' } },
    )
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => response)
    vi.stubGlobal('fetch', fetchMock)
    const events: PromptChatEvent[] = []
    const signal = new AbortController().signal
    const frames = await dispatchChatProvider({
      database,
      profile,
      formated: [{ role: 'user', content: 'Hello' }],
      signal,
      history: { db: historyDb, source: 'chat' },
    })
    const encoding = tokenizerEncodingFromDb(database)
    const countTokens = (content: string) => tokenize(content, encoding)
    const reading = emitProviderChunks(frames, (event) => events.push(event), signal, {
      ...(halfStreaming ? { tokenProgress: { startedAt: Date.now(), countTokens } } : {}),
    })
    const send = (content: string) =>
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`))
    const rawChunks = ['<think>private reasoning', ' continues</think>\nHello ', 'world']
    try {
      await vi.waitFor(() => expect(reads).toBe(1))
      send(rawChunks[0]!)
      await vi.waitFor(() => expect(reads).toBe(2))
      if (halfStreaming) {
        expect(events).toEqual([
          expect.objectContaining({ type: 'token', content: '', generatedTokens: countTokens(rawChunks[0]!) }),
        ])
      } else {
        expect(events).toEqual([])
      }

      send(rawChunks[1]!)
      await vi.waitFor(() => expect(reads).toBe(3))
      expect(events.at(-1)).toMatchObject({ type: 'token', content: 'Hello' })
      expect(events.some((event) => event.type === 'done')).toBe(false)
      expect(JSON.stringify(events)).not.toContain('private reasoning')
      expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.llmgateway.io/v1/chat/completions')
      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).stream).toBe(true)

      send(rawChunks[2]!)
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
      await expect(reading).resolves.toMatchObject({ status: 'done', result: 'Hello world' })
      if (halfStreaming) {
        const lastToken = events.filter((event) => event.type === 'token').at(-1)
        expect(lastToken).toMatchObject({
          generatedTokens: rawChunks.reduce((sum, chunk) => sum + countTokens(chunk), 0),
        })
      }
      const records = listRequestHistory(historyDb, 5)
      expect(records).toHaveLength(1)
      expect(getRequestHistoryRecord(historyDb, records[0]!.id)).toMatchObject({
        status: 'success',
        response: 'Hello world',
      })
    } finally {
      // Release a blocked source on assertion failure, then close its history DB.
      try {
        controller.close()
      } catch {
        /* already closed or cancelled */
      }
      await reading
      historyDb.close()
    }
  },
)
