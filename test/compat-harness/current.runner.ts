import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/ts/platform', async (importActual) => {
  const actual = await importActual<typeof import('../../src/ts/platform')>()
  return { ...actual, isFastifyServer: true }
})

vi.mock('../../src/ts/storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'fixture-auth-token',
}))

vi.mock('../../src/ts/process/tts', () => import('../../src/ts/process/__fixtures__/mocks/tts'))
vi.mock('../../src/ts/process/inlayScreen', () => import('../../src/ts/process/__fixtures__/mocks/inlayScreen'))
vi.mock('../../src/ts/process/stableDiff', () => import('../../src/ts/process/__fixtures__/mocks/stableDiff'))
vi.mock('../../src/ts/process/prereroll', () => import('../../src/ts/process/__fixtures__/mocks/prereroll'))
vi.mock('../../src/ts/process/files/inlays', () => import('../../src/ts/process/__fixtures__/mocks/inlays'))
vi.mock('../../src/ts/process/scriptings', () => import('../../src/ts/process/__fixtures__/mocks/scriptings'))

vi.mock('../../src/ts/process/postGeneration/notification', async (importActual) => {
  const actual = await importActual<typeof import('../../src/ts/process/postGeneration/notification')>()
  return { ...actual, fireDesktopNotification: async () => undefined }
})

vi.mock('../../src/ts/process/postGeneration/emotionFallbackEmbedding', () => ({
  runEmotionEmbeddingFallback: async () => undefined,
}))

vi.mock('../../src/ts/process/messageCompletionSound', () => ({
  playMessageCompletionSoundIfEnabled: () => undefined,
}))

vi.mock('../../src/ts/process/memory/hypav3', async (importActual) => {
  const actual = await importActual<typeof import('../../src/ts/process/memory/hypav3')>()
  const fake = await import('../../src/ts/process/__fixtures__/mocks/hypav3')
  return { ...actual, hypaMemoryV3: fake.hypaMemoryV3 }
})

vi.mock('../../src/ts/process/transformers', async (importActual) => {
  const actual = await importActual<typeof import('../../src/ts/process/transformers')>()
  return { ...actual, runImageEmbedding: async () => [{ generated_text: 'compat caption' }] }
})

const uuidState = vi.hoisted(() => ({ counter: 0 }))
vi.mock('uuid', () => ({
  v4: () => `current-generated-${uuidState.counter++}`,
}))

vi.mock('@mlc-ai/web-tokenizers', () => ({
  Tokenizer: {
    fromJSON: async () => ({ encode: (text: string) => (text.length === 0 ? [] : text.split(/\s+/)) }),
    fromSentencePiece: async () => ({ encode: (text: string) => (text.length === 0 ? [] : text.split(/\s+/)) }),
  },
}))

import { setupAuthedClient } from '../../server/fastify/__tests__/helpers/auth'
import { buildApp } from '../../server/fastify/src/app'
import { appendCurrentChatUserMessageForSend, captureActiveChatTarget } from '../../src/ts/chatCommands'
import { resolveActiveChatGenerationSettings } from '../../src/ts/activeChatGenerationSettings'
import { markFixtureActiveChatGenerationSettingsReady } from '../../src/ts/process/__fixtures__/loadFixture'
import { isTokenizerUrl, serveTokenizerFetch } from '../../src/ts/process/__fixtures__/mocks/tokenizerFetch'
import { resetAcceptedSendCoordinatorForTests } from '../../src/ts/process/acceptedSendCoordinator.svelte'
import { processMultiCommand } from '../../src/ts/process/command'
import { abortChat, chatProcessStage, doingChat, sendChat } from '../../src/ts/process/index.svelte'
import { clearCachedServerCommandRevision, setCachedServerCommandRevision } from '../../src/ts/server/commands'
import { getResourceDatabase } from '../../src/ts/__tests__/resourceDatabaseState'
import { setDatabase, type Database } from '../../src/ts/storage/database.svelte'
import { selectedCharID } from '../../src/ts/stores.svelte'
import {
  FIXTURE_ASSISTANT_ID,
  FIXTURE_CHAT_ID,
  FIXTURE_CHARACTER_ID,
  MULTISEND_COMMAND,
  createFixtureDatabase,
  providerReply,
} from './fixture'
import { captureProviderRequest, normalizeTranscript, openAiMockResponse } from './normalize'
import { compatCells, type CapturedProviderRequest, type CompatCellArtifact, type CompatSideArtifact } from './types'

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const OUTPUT_PATH = process.env.COMPAT_HARNESS_CURRENT_OUTPUT

type InjectMethod = 'DELETE' | 'GET' | 'HEAD' | 'PATCH' | 'POST' | 'PUT' | 'OPTIONS'

function toInjectMethod(method: string | undefined): InjectMethod {
  const value = (method ?? 'GET').toUpperCase()
  return ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT', 'OPTIONS'].includes(value) ? (value as InjectMethod) : 'GET'
}

function requestHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]))
}

interface CurrentHarness {
  app: FastifyInstance
  authAssertion: string
  dataDir: string
  providerRequests: CapturedProviderRequest[]
  seed(database: Database): Promise<number>
  persistedMessages(): Promise<unknown[]>
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  close(): Promise<void>
}

async function createCurrentHarness(
  cell: ReturnType<typeof compatCells>[number],
  providerRequests: CapturedProviderRequest[],
): Promise<CurrentHarness> {
  process.env.LOG_LEVEL = 'silent'
  process.env.RISU_WEB_PUSH_VAPID_PUBLIC_KEY = 'compat-disabled'
  delete process.env.RISU_WEB_PUSH_VAPID_PRIVATE_KEY
  const dataDir = mkdtempSync(resolve(tmpdir(), 'risu-compat-current-'))
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      importMaxBytes: Number.POSITIVE_INFINITY,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
    memoryWorker: false,
  })
  const { assertion: authAssertion } = await setupAuthedClient(app)

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (isTokenizerUrl(rawUrl)) return serveTokenizerFetch(rawUrl)
    if (rawUrl === OPENAI_ENDPOINT) {
      const captured = captureProviderRequest(input, init)
      providerRequests.push(captured)
      return openAiMockResponse(
        providerReply(cell.scenario, providerRequests.length - 1),
        captured.body.stream === true,
      )
    }

    const url = rawUrl.startsWith('http') ? new URL(rawUrl).pathname : rawUrl
    if (!url.startsWith('/api/')) throw new Error(`Unexpected current-stack fetch: ${rawUrl}`)
    const headers = requestHeaders(init?.headers)
    if (headers['risu-auth'] === 'fixture-auth-token') headers['risu-auth'] = authAssertion
    const payload = typeof init?.body === 'string' && init.body.length > 0 ? JSON.parse(init.body) : undefined
    const res = await app.inject({
      method: toInjectMethod(init?.method),
      url,
      headers,
      payload,
    })
    const responseHeaders: Record<string, string> = {}
    for (const [key, value] of Object.entries(res.headers)) {
      if (typeof value === 'string') responseHeaders[key] = value
      else if (Array.isArray(value)) responseHeaders[key] = value.join(', ')
    }
    return new Response(res.body, { status: res.statusCode, headers: responseHeaders })
  }

  return {
    app,
    authAssertion,
    dataDir,
    providerRequests,
    async seed(database) {
      const cloned = JSON.parse(JSON.stringify(database)) as Database
      const chat = cloned.characters[0].chats[0]
      const generationSettings = JSON.parse(JSON.stringify(chat.generationSettings)) as unknown
      const imported = await app.inject({
        method: 'POST',
        url: '/api/v1/import/risusave',
        headers: { 'risu-auth': authAssertion },
        payload: { database: cloned },
      })
      expect(imported.statusCode).toBe(200)
      const configured = await app.inject({
        method: 'PUT',
        url: `/api/v1/commands/chats/${encodeURIComponent(FIXTURE_CHAT_ID)}/generation-settings`,
        headers: { 'risu-auth': authAssertion },
        payload: { baseRevision: imported.json().revision, generationSettings },
      })
      expect(configured.statusCode).toBe(200)
      return configured.json().revision as number
    },
    async persistedMessages() {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/chats/${encodeURIComponent(FIXTURE_CHAT_ID)}/messages`,
        headers: { 'risu-auth': authAssertion },
      })
      expect(res.statusCode).toBe(200)
      return res.json().message as unknown[]
    },
    fetch,
    async close() {
      await app.close()
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

async function drainCommands(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise<void>((resolvePromise) => setImmediate(resolvePromise))
  await new Promise<void>((resolvePromise) => setImmediate(resolvePromise))
}

describe('Original-Risu compatibility harness current-stack runner', () => {
  const cells: CompatCellArtifact[] = []
  let originalFetch: typeof globalThis.fetch
  let activeHarness: CurrentHarness | undefined
  let restoreConsole: (() => void) | undefined

  beforeAll(() => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    restoreConsole = () => {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'))
    originalFetch = globalThis.fetch
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    if (activeHarness) await activeHarness.close()
    activeHarness = undefined
  })

  afterAll(async () => {
    vi.useRealTimers()
    if (!OUTPUT_PATH) throw new Error('COMPAT_HARNESS_CURRENT_OUTPUT is required')
    const artifact: CompatSideArtifact = {
      schemaVersion: 1,
      side: 'current',
      baselineCommit: '71c476e9c86263fe907105b011ca4dde0a619d66',
      boundary:
        'Current browser send/command coordinators plus in-process Fastify, SQLite persistence, real server prompt assembly, real OpenAI adapter, and terminal reconciliation.',
      cells,
    }
    await mkdir(dirname(OUTPUT_PATH), { recursive: true })
    await writeFile(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
    restoreConsole?.()
  })

  it.each(compatCells())('$id', async (cell) => {
    const providerRequests: CapturedProviderRequest[] = []
    const harness = await createCurrentHarness(cell, providerRequests)
    activeHarness = harness
    globalThis.fetch = harness.fetch as typeof globalThis.fetch

    uuidState.counter = 0
    doingChat.set(false)
    abortChat.set(false)
    chatProcessStage.set(0)
    selectedCharID.set(0)
    resetAcceptedSendCoordinatorForTests()
    clearCachedServerCommandRevision()
    setDatabase(createFixtureDatabase(cell.transport, cell.useSayNothing) as Database)
    markFixtureActiveChatGenerationSettingsReady({ canonicalOpenAiProfile: true })
    const activeGenerationSettings = resolveActiveChatGenerationSettings()
    expect(
      activeGenerationSettings.readiness,
      JSON.stringify(activeGenerationSettings.readiness.missing),
    ).toMatchObject({
      ready: true,
    })
    const database = getResourceDatabase()
    const chat = database.characters[0].chats[0]
    const revision = await harness.seed(database)
    setCachedServerCommandRevision(revision)

    let completed = false
    let error: string | undefined
    try {
      switch (cell.scenario) {
        case 'send':
          if (cell.useSayNothing) {
            const target = captureActiveChatTarget()
            if (!target) throw new Error('Missing active target for empty-send fixture')
            const appended = await appendCurrentChatUserMessageForSend(
              { role: 'user', data: '*says nothing*', name: null },
              { expectedTarget: target },
            )
            if (appended.status === 'error') throw new Error(appended.error)
            completed = await sendChat(-1, { expectedTarget: target, syntheticSayNothing: true })
          } else {
            completed = await sendChat(-1)
          }
          break
        case 'regenerate': {
          completed = await sendChat(-1, { regenerateMessageId: FIXTURE_ASSISTANT_ID })
          break
        }
        case 'continue':
          completed = await sendChat(-1, { continue: true })
          break
        case 'multisend':
          await processMultiCommand(MULTISEND_COMMAND)
          completed = providerRequests.length === 2
          break
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    } finally {
      doingChat.set(false)
    }

    await drainCommands()
    const persisted = await harness.persistedMessages()
    cells.push({
      ...cell,
      execution: {
        completed,
        providerCallCount: providerRequests.length,
        ...(error ? { error } : {}),
      },
      persistedTranscript: normalizeTranscript(persisted),
      providerRequests: structuredClone(providerRequests),
    })

    expect(database.characters[0].chaId).toBe(FIXTURE_CHARACTER_ID)
  })
})
