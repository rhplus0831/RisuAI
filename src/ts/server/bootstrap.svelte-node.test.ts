import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'bootstrap-auth-token',
}))

import { DISCONNECT_EXISTING_WRITER_HEADER, fetchServerBootstrap, fetchServerBootstrapReadOnly } from './bootstrap'
import { ACTIVE_WRITER_SESSION_HEADER } from './activeWriterSession'
import { clearCachedServerCommandRevision, peekCachedServerCommandRevision } from './commands'

interface CapturedFetch {
  url: string
  method: string
  authHeader: string | null
  writerSessionHeader: string | null
  observerSessionHeader: string | null
  disconnectExistingWriterHeader: string | null
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubBootstrapFetch(body: unknown | (() => unknown)): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      calls.push({
        url: String(input),
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
        writerSessionHeader: headers?.[ACTIVE_WRITER_SESSION_HEADER] ?? null,
        observerSessionHeader: headers?.['risu-writer-observer-session'] ?? null,
        disconnectExistingWriterHeader: headers?.[DISCONNECT_EXISTING_WRITER_HEADER] ?? null,
      })
      const value = typeof body === 'function' ? body() : body
      return value instanceof Response ? value : jsonResponse(value)
    }) as unknown as typeof fetch,
  )
  return calls
}

beforeEach(() => {
  clearCachedServerCommandRevision()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('server runtime bootstrap helper', () => {
  it('fetches runtime metadata with auth, registers the writer, and caches revision', async () => {
    const calls = stubBootstrapFetch({
      initialized: true,
      revision: 12,
      schemaVersion: 17,
      assetBaseUrl: '/api/v1/assets',
      requestedWriterWasActive: true,
      databaseLineage: 'database-a',
      writerEpoch: 3,
      generationOperationProtocol: { version: 1 },
      startupTelemetry: { version: 1, sampleRate: 1 },
      generationOperationProjectionEpoch: 21,
      generationOperations: [
        {
          operationId: 'operation-a',
          protocolVersion: 1,
          requestOrigin: 'accepted_send',
          state: 'abandoned',
          stateVersion: 4,
          projectionEpoch: 21,
          creatorWriterSessionId: 'writer-a',
          creatorWriterEpoch: 3,
          characterId: 'character-a',
          chatId: 'chat-a',
          mode: 'send',
          acceptedMessageId: 'message-a',
          clientDraftGeneration: {
            databaseLineage: 'database-a',
            writerSessionId: 'writer-a',
            transcriptIdentity: 'chat-a',
            sequence: 4,
          },
          failureCode: 'server_restarted',
          providerMayHaveRun: true,
          recoveryDisposition: 'retryable',
        },
      ],
      activeGenerationJobs: [
        {
          chatId: 'chat-a',
          jobId: 'job-a',
          mode: 'continue',
          databaseLineage: 'database-a',
          operationId: 'operation-a',
          writerSessionId: 'writer-a',
          writerEpoch: 3,
          operationStateVersion: 3,
          projectionEpoch: 21,
          attemptNo: 1,
          targetMessageId: 'message-target-a',
        },
      ],
      generationFinalizations: [
        {
          generationId: 'generation-a',
          databaseLineage: 'database-a',
          operationId: 'operation-a',
          operationAttemptNo: 1,
          actorWriterSessionId: 'writer-a',
          actorWriterEpoch: 3,
          acceptedMessageId: 'message-source-a',
          terminalOutcome: 'completed',
          chatId: 'chat-a',
          messageId: 'message-a',
          mode: 'continue',
          state: 'stalled',
          failureCount: 3,
          nextAttemptAt: '2026-08-11T00:00:30.000Z',
          provisionalMessage: { role: 'char', data: 'provisional', chatId: 'message-a' },
          projectionFence: {
            mode: 'continue',
            kind: 'target-tail',
            transcriptLength: 1,
            target: { message: { role: 'char', data: 'before', chatId: 'message-a' } },
          },
        },
      ],
      activeMessageTranslations: [
        { chatId: 'chat-a', messageId: 'message-a', jobId: 'translation-a', status: 'running' },
      ],
    })

    await expect(fetchServerBootstrap()).resolves.toEqual({
      status: 'ok',
      bootstrap: {
        initialized: true,
        revision: 12,
        schemaVersion: 17,
        assetBaseUrl: '/api/v1/assets',
        requestedWriterWasActive: true,
        databaseLineage: 'database-a',
        writerEpoch: 3,
        generationOperationProtocol: { version: 1 },
        startupTelemetry: { version: 1, sampleRate: 1 },
        generationOperationProjectionEpoch: 21,
        generationOperations: [
          {
            operationId: 'operation-a',
            protocolVersion: 1,
            requestOrigin: 'accepted_send',
            state: 'abandoned',
            stateVersion: 4,
            projectionEpoch: 21,
            creatorWriterSessionId: 'writer-a',
            creatorWriterEpoch: 3,
            characterId: 'character-a',
            chatId: 'chat-a',
            mode: 'send',
            acceptedMessageId: 'message-a',
            clientDraftGeneration: {
              databaseLineage: 'database-a',
              writerSessionId: 'writer-a',
              transcriptIdentity: 'chat-a',
              sequence: 4,
            },
            failureCode: 'server_restarted',
            providerMayHaveRun: true,
            recoveryDisposition: 'retryable',
          },
        ],
        activeGenerationJobs: [
          {
            chatId: 'chat-a',
            jobId: 'job-a',
            mode: 'continue',
            databaseLineage: 'database-a',
            operationId: 'operation-a',
            writerSessionId: 'writer-a',
            writerEpoch: 3,
            operationStateVersion: 3,
            projectionEpoch: 21,
            attemptNo: 1,
            targetMessageId: 'message-target-a',
          },
        ],
        generationFinalizations: [
          {
            generationId: 'generation-a',
            databaseLineage: 'database-a',
            operationId: 'operation-a',
            operationAttemptNo: 1,
            actorWriterSessionId: 'writer-a',
            actorWriterEpoch: 3,
            acceptedMessageId: 'message-source-a',
            terminalOutcome: 'completed',
            chatId: 'chat-a',
            messageId: 'message-a',
            mode: 'continue',
            state: 'stalled',
            failureCount: 3,
            nextAttemptAt: '2026-08-11T00:00:30.000Z',
            provisionalMessage: { role: 'char', data: 'provisional', chatId: 'message-a' },
            projectionFence: {
              mode: 'continue',
              kind: 'target-tail',
              transcriptLength: 1,
              target: { message: { role: 'char', data: 'before', chatId: 'message-a' } },
            },
          },
        ],
        activeGreetingTranslations: [],
        activeMessageTranslations: [
          { chatId: 'chat-a', messageId: 'message-a', jobId: 'translation-a', status: 'running' },
        ],
      },
    })
    expect(peekCachedServerCommandRevision()).toBe(12)
    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'bootstrap-auth-token',
        writerSessionHeader: expect.any(String),
        observerSessionHeader: null,
        disconnectExistingWriterHeader: null,
      },
    ])
  })

  it('requires an explicit retry before disconnecting a connected writer', async () => {
    let requestCount = 0
    const calls = stubBootstrapFetch(() => {
      requestCount += 1
      if (requestCount === 1) {
        return jsonResponse(
          {
            error: 'active_writer_connected',
            reason: 'Another browser session is still connected.',
          },
          409,
        )
      }
      return {
        initialized: true,
        revision: 8,
        databaseLineage: 'database-a',
        requestedWriterWasActive: false,
        writerEpoch: 2,
      }
    })

    await expect(fetchServerBootstrap()).resolves.toEqual({
      status: 'active-writer-connected',
      error: 'active_writer_connected',
    })
    await expect(fetchServerBootstrap(null, { disconnectExistingWriter: true })).resolves.toMatchObject({
      status: 'ok',
      bootstrap: {
        revision: 8,
        requestedWriterWasActive: false,
        writerEpoch: 2,
      },
    })
    expect(calls.map((call) => call.disconnectExistingWriterHeader)).toEqual([null, 'true'])
  })

  it('performs read-only bootstrap without writer ownership or optional revision caching', async () => {
    const calls = stubBootstrapFetch({
      initialized: false,
      revision: 0,
      databaseLineage: 'database-a',
      writerEpoch: 3,
    })

    const expected = {
      status: 'ok',
      bootstrap: {
        initialized: false,
        revision: 0,
        schemaVersion: undefined,
        assetBaseUrl: undefined,
        requestedWriterWasActive: undefined,
        databaseLineage: 'database-a',
        writerEpoch: 3,
        generationOperationProtocol: undefined,
        generationOperationProjectionEpoch: undefined,
        generationOperations: [],
        activeGenerationJobs: [],
        activeGreetingTranslations: [],
        activeMessageTranslations: [],
      },
    }
    await expect(fetchServerBootstrapReadOnly(null, { cacheRevision: false })).resolves.toEqual(expected)
    await expect(fetchServerBootstrapReadOnly(null, { cacheRevision: false })).resolves.toEqual(expected)
    expect(peekCachedServerCommandRevision()).toBeNull()
    expect(calls[0].writerSessionHeader).toBeNull()
    expect(calls[0].observerSessionHeader).toEqual(expect.any(String))
    expect(calls[0].observerSessionHeader).not.toBe('')
    expect(calls[1].observerSessionHeader).toBe(calls[0].observerSessionHeader)
  })

  it('drops malformed runtime job entries', async () => {
    stubBootstrapFetch({
      initialized: true,
      revision: 3,
      activeGenerationJobs: [
        { chatId: 'chat-a', jobId: 'job-a', mode: 'regenerate', regenerateMessageId: 'message-a' },
        { chatId: 'chat-b' },
        'invalid',
      ],
      generationOperations: [
        {
          operationId: 'operation-valid',
          protocolVersion: 1,
          requestOrigin: 'accepted_send',
          state: 'retryable',
          stateVersion: 2,
          projectionEpoch: 3,
          creatorWriterSessionId: 'writer-a',
          creatorWriterEpoch: 1,
          providerMayHaveRun: false,
          recoveryDisposition: 'retryable',
        },
        { operationId: 'missing-fields' },
      ],
      activeMessageTranslations: [{ chatId: 'chat-a', messageId: 'message-a' }, { chatId: 'chat-b' }, null],
    })

    const result = await fetchServerBootstrap()
    expect(result).toMatchObject({ status: 'ok' })
    if (result.status !== 'ok') return
    expect(result.bootstrap.activeGenerationJobs).toEqual([
      { chatId: 'chat-a', jobId: 'job-a', mode: 'regenerate', regenerateMessageId: 'message-a' },
    ])
    expect(result.bootstrap.activeMessageTranslations).toEqual([
      {
        chatId: 'chat-a',
        messageId: 'message-a',
        jobId: 'legacy:chat-a:message-a',
        status: 'running',
      },
    ])
    expect(result.bootstrap.generationOperations).toEqual([
      {
        operationId: 'operation-valid',
        protocolVersion: 1,
        requestOrigin: 'accepted_send',
        state: 'retryable',
        stateVersion: 2,
        projectionEpoch: 3,
        creatorWriterSessionId: 'writer-a',
        creatorWriterEpoch: 1,
        providerMayHaveRun: false,
        recoveryDisposition: 'retryable',
      },
    ])
  })

  it('maps HTTP failures and network failures to status:error', async () => {
    stubBootstrapFetch(jsonResponse({ error: 'missing_auth' }, 401))
    await expect(fetchServerBootstrap()).resolves.toEqual({ status: 'error', error: 'missing_auth' })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    )
    await expect(fetchServerBootstrap()).resolves.toEqual({ status: 'error', error: 'Network error: offline' })
  })

  it('requires initialized and a non-negative integer revision', async () => {
    stubBootstrapFetch({ revision: 1 })
    await expect(fetchServerBootstrap()).resolves.toEqual({
      status: 'error',
      error: 'Invalid bootstrap initialization state',
    })

    vi.unstubAllGlobals()
    stubBootstrapFetch({ initialized: true, revision: 'invalid' })
    await expect(fetchServerBootstrap()).resolves.toEqual({ status: 'error', error: 'Invalid bootstrap revision' })
  })
})
