import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MASKED_PROVIDER_SECRET } from '../src/providerSecrets.js'
import { buildApp } from '../src/app.js'
import {
  EMBEDDING_OPERATION_MAX_GROUP_CHUNKS,
  EMBEDDING_OPERATION_MAX_INPUT_STRING_BYTES,
  EmbeddingOperationError,
  executeEmbeddingOperation,
  parseEmbeddingOperationRequest,
  resolveEmbeddingOperationModel,
} from '../src/embeddingOperations.js'
import { createEmbeddingOperationDisconnectAbort } from '../src/routes/embeddingOperations.js'
import type {
  EmbeddingGroupsOperationRequest,
  EmbeddingTextsOperationRequest,
} from '@risuai/protocol/embedding-operation'

const storedSettings = {
  hypaV3Key: 'stored-openai-key',
  voyageApiKey: 'stored-voyage-key',
  hypaCustomSettings: {
    url: 'https://stored.example.test/v1',
    key: 'stored-custom-key',
    model: 'stored-model',
  },
}

function texts(overrides: Partial<EmbeddingTextsOperationRequest> = {}): EmbeddingTextsOperationRequest {
  return {
    operation: 'texts',
    model: 'openai3small',
    inputType: 'document',
    input: ['first'],
    credential: { source: 'stored' },
    ...overrides,
  }
}

function groups(overrides: Partial<EmbeddingGroupsOperationRequest> = {}): EmbeddingGroupsOperationRequest {
  return {
    operation: 'groups',
    model: 'voyageContext3',
    inputType: 'document',
    groups: [['first']],
    credential: { source: 'stored' },
    ...overrides,
  }
}

describe('embedding operation protocol', () => {
  it('accepts the closed text and contextual request shapes', () => {
    expect(parseEmbeddingOperationRequest(texts())).toEqual(texts())
    expect(parseEmbeddingOperationRequest(groups({ inputType: 'query' }))).toEqual(groups({ inputType: 'query' }))
    expect(parseEmbeddingOperationRequest(groups({ model: 'voyageContext4' }))).toEqual(
      groups({ model: 'voyageContext4' }),
    )
  })

  it('rejects unknown fields, masked provided keys, and oversized inputs', () => {
    expect(() => parseEmbeddingOperationRequest({ ...texts(), url: 'https://attacker.invalid' })).toThrow(
      EmbeddingOperationError,
    )
    expect(() =>
      parseEmbeddingOperationRequest({
        ...texts(),
        credential: { source: 'provided', apiKey: MASKED_PROVIDER_SECRET },
      }),
    ).toThrowError('invalid_embedding_operation_request')
    expect(() =>
      parseEmbeddingOperationRequest({
        ...texts(),
        input: ['x'.repeat(EMBEDDING_OPERATION_MAX_INPUT_STRING_BYTES + 1)],
      }),
    ).toThrowError('invalid_embedding_operation_request')
    expect(() =>
      parseEmbeddingOperationRequest({
        ...groups(),
        groups: [Array.from({ length: EMBEDDING_OPERATION_MAX_GROUP_CHUNKS + 1 }, () => 'x')],
      }),
    ).toThrowError('invalid_embedding_operation_request')
  })

  it('rejects custom metadata targets and URL-carried credentials', () => {
    for (const url of [
      'http://169.254.169.254/latest',
      'https://metadata.google.internal/computeMetadata/v1',
      'https://user:password@example.test/v1',
      'https://example.test/v1?token=secret',
    ]) {
      expect(() =>
        parseEmbeddingOperationRequest(
          texts({
            model: 'custom',
            custom: { source: 'provided', url },
          }),
        ),
      ).toThrowError('embedding_configuration_invalid')
    }
  })
})

describe('embedding operation credential resolution', () => {
  it('loads OpenAI, Voyage, and custom credentials from raw persisted settings', () => {
    expect(resolveEmbeddingOperationModel(texts(), storedSettings)).toMatchObject({
      endpoint: 'https://api.openai.com/v1/embeddings',
      apiKey: 'stored-openai-key',
      wireModel: 'text-embedding-3-small',
    })
    expect(resolveEmbeddingOperationModel(groups(), storedSettings)).toMatchObject({
      endpoint: 'https://api.voyageai.com/v1/contextualizedembeddings',
      apiKey: 'stored-voyage-key',
    })
    expect(
      resolveEmbeddingOperationModel(texts({ model: 'custom', custom: { source: 'stored' } }), storedSettings),
    ).toMatchObject({
      endpoint: 'https://stored.example.test/v1/embeddings',
      apiKey: 'stored-custom-key',
      wireModel: 'stored-model',
    })
  })

  it('uses one-shot credentials without exposing or persisting them', () => {
    const resolved = resolveEmbeddingOperationModel(
      texts({ credential: { source: 'provided', apiKey: 'draft-key' } }),
      storedSettings,
    )
    expect(resolved.apiKey).toBe('draft-key')
    expect(storedSettings.hypaV3Key).toBe('stored-openai-key')
  })

  it('does not pair a stored custom secret with a different draft endpoint', () => {
    expect(() =>
      resolveEmbeddingOperationModel(
        texts({
          model: 'custom',
          custom: { source: 'provided', url: 'https://draft.example.test/v1', model: 'draft-model' },
          credential: { source: 'stored' },
        }),
        storedSettings,
      ),
    ).toThrowError('embedding_credential_unavailable')

    expect(
      resolveEmbeddingOperationModel(
        texts({
          model: 'custom',
          custom: { source: 'provided', url: 'https://draft.example.test/v1', model: 'draft-model' },
          credential: { source: 'provided', apiKey: 'draft-key' },
        }),
        storedSettings,
      ),
    ).toMatchObject({
      endpoint: 'https://draft.example.test/v1/embeddings',
      apiKey: 'draft-key',
      wireModel: 'draft-model',
    })
  })

  it('treats an accidental persisted mask as unavailable, never as a credential', () => {
    expect(() =>
      resolveEmbeddingOperationModel(texts(), { ...storedSettings, hypaV3Key: MASKED_PROVIDER_SECRET }),
    ).toThrowError('embedding_credential_unavailable')
  })
})

describe('embedding operation execution', () => {
  it('returns bounded plain vectors and preserves contextual query semantics', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(init?.body as string)).toEqual({
        inputs: [['first']],
        model: 'voyage-context-4',
        input_type: 'query',
      })
      expect(init?.redirect).toBe('error')
      return new Response(JSON.stringify({ data: [{ data: [{ embedding: [1, 2] }] }] }))
    })

    await expect(
      executeEmbeddingOperation(groups({ model: 'voyageContext4', inputType: 'query' }), storedSettings, {
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).resolves.toEqual({
      operation: 'groups',
      model: 'voyage-context-4',
      dimension: 2,
      groups: [[[1, 2]]],
    })
  })

  it('sanitizes malformed and over-dimensional upstream responses', async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }))),
    )

    await expect(
      executeEmbeddingOperation(texts(), storedSettings, {
        fetchImpl: fetchImpl as typeof fetch,
        maxDimension: 2,
      }),
    ).rejects.toMatchObject({ code: 'embedding_operation_invalid_response', statusCode: 502 })
  })

  it('maps deadline aborts to a sanitized timeout', async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
            once: true,
          })
        }),
    )

    await expect(
      executeEmbeddingOperation(texts(), storedSettings, {
        fetchImpl: fetchImpl as typeof fetch,
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ code: 'embedding_operation_timeout', statusCode: 504 })
  })
})

describe('embedding operation disconnect handling', () => {
  it('ignores a completed request close and aborts an unfinished response close', () => {
    const request = Object.assign(new EventEmitter(), { complete: true })
    const response = Object.assign(new EventEmitter(), { writableEnded: false })
    const disconnect = createEmbeddingOperationDisconnectAbort(request, response)
    request.emit('close')
    expect(disconnect.signal.aborted).toBe(false)
    response.emit('close')
    expect(disconnect.signal.aborted).toBe(true)
    disconnect.cleanup()
  })
})

interface Harness {
  app: FastifyInstance
  dataDir: string
}

const harnesses: Harness[] = []

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop()!
    await harness.app.close()
    rmSync(harness.dataDir, { recursive: true, force: true })
  }
})

async function startHarness(fetchImpl: typeof fetch): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-embedding-operations-'))
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      importMaxBytes: Infinity,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
      agentDevAuthBypass: true,
    },
    memoryWorker: false,
    assetGc: false,
    embeddingOperations: { fetchImpl },
  })
  await app.ready()
  const harness = { app, dataDir }
  harnesses.push(harness)
  return harness
}

async function seedOpenAiEmbeddingSettings(app: FastifyInstance): Promise<void> {
  const initialized = await app.inject({
    method: 'POST',
    url: '/api/v1/commands/state/initialize',
    payload: {},
  })
  expect(initialized.statusCode, initialized.body).toBe(200)
  const patched = await app.inject({
    method: 'PATCH',
    url: '/api/v1/commands/settings/memory',
    payload: {
      baseRevision: initialized.json().revision,
      patch: { hypaV3Key: 'server-only-embedding-key', hypaModel: 'openai3small' },
    },
  })
  expect(patched.statusCode, patched.body).toBe(200)
}

describe('POST /api/v1/embedding-operations', () => {
  it('uses the raw SQLite credential without returning it to the browser', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: [1, 2] }] }))),
    )
    const harness = await startHarness(fetchImpl as typeof fetch)
    await seedOpenAiEmbeddingSettings(harness.app)

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/embedding-operations',
      payload: texts(),
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({
      operation: 'texts',
      model: 'text-embedding-3-small',
      dimension: 2,
      vectors: [[1, 2]],
    })
    expect(response.body).not.toContain('server-only-embedding-key')
    expect(new Headers((fetchImpl.mock.calls[0][1] as RequestInit).headers).get('authorization')).toBe(
      'Bearer server-only-embedding-key',
    )
  })

  it('returns only a sanitized error when the upstream response is malformed', async () => {
    const fetchImpl = vi.fn(async () => Promise.resolve(new Response('secret upstream diagnostic')))
    const harness = await startHarness(fetchImpl as typeof fetch)
    await seedOpenAiEmbeddingSettings(harness.app)

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/embedding-operations',
      payload: texts(),
    })

    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({ error: 'embedding_operation_invalid_response' })
    expect(response.body).not.toContain('secret upstream diagnostic')
    expect(response.body).not.toContain('server-only-embedding-key')
  })
})
