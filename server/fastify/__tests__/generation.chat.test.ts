import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, webcrypto } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { listPersistedCommandEventHistory } from '../src/commands/events.js'
import { openDatabase } from '../src/db.js'
import { applyImport, hydrateAssemblyModuleBodies } from '../src/repository.js'
import type { CompletionStreamFrame } from '../src/generation/frames.js'
import {
  createRequestScopedStoredAssetResolver,
  type GenerationChatRouteOptions,
} from '../src/routes/generationChat.js'
import { normalizeRisuSaveSnapshotDatabase } from '../src/risuSave/importSnapshot.js'
import { saveSelectedPersonaSnapshot } from '../src/commands/personas.js'
import { LLMFlags, LLMFormat } from '../../../src/ts/model/types'
import {
  BROAD_WRITE_TABLES,
  assertCommandMetricGate,
  type CommandMutationMetric,
} from './helpers/commandMetricGates.js'
import { expectNoSuccessDoneAfterAbort, parseEvents, type PromptChatFrame } from './helpers/terminalFrameAssertions.js'
import { getChatMessageDiffInstrumentation, resetChatMessageDiffInstrumentation } from '../src/messageStore.js'
import { emitProviderChunks } from '../src/prompt/providerTransport.js'
import { summarizePromptRows, type PromptRowSummary } from '../src/prompt/promptSummary.js'
import type { PromptChatEvent } from '../src/prompt/sseEvents.js'
import type { GenerationTraceOptions, GenerationTraceSidecarEntry } from '../src/generation/generationTraceSidecar.js'

const subtle = webcrypto.subtle

interface Harness {
  app: FastifyInstance
  dataDir: string
}

async function startHarness(
  generationChat?: GenerationChatRouteOptions,
  generationTrace?: GenerationTraceOptions,
): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-'))
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      importMaxBytes: Infinity,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
      generationTrace,
    },
    generationChat,
  })
  return { app, dataDir }
}

async function stopHarness(h: Harness): Promise<void> {
  await h.app.close()
  rmSync(h.dataDir, { recursive: true, force: true })
}

async function restartHarness(
  generationChat: GenerationChatRouteOptions,
  generationTrace?: GenerationTraceOptions,
): Promise<void> {
  await stopHarness(harness)
  harness = await startHarness(generationChat, generationTrace)
}

async function signAssertion(privateKey: CryptoKey, publicJwk: JsonWebKey, ttlSec = 60): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'ES256', typ: 'JWT' }
  const payload = { iat: now, exp: now + ttlSec, pub: publicJwk }
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url')
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signingInput = `${headerB64}.${payloadB64}`
  const signature = await subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    privateKey,
    Buffer.from(signingInput),
  )
  const sigB64 = Buffer.from(signature).toString('base64url')
  return `${signingInput}.${sigB64}`
}

async function setupAuthedClient(app: FastifyInstance): Promise<{ assertion: string }> {
  const setup = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    payload: { password: 'hunter2' },
  })
  expect(setup.statusCode).toBe(200)

  const keypair = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const publicKey = await subtle.exportKey('jwk', keypair.publicKey)

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { password: 'hunter2', publicKey },
  })
  expect(login.statusCode).toBe(200)

  const assertion = await signAssertion(keypair.privateKey, publicKey)
  return { assertion }
}

let harness: Harness

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await stopHarness(harness)
})

const basePayload = {
  chatId: 'chat-1',
  characterId: 'char-1',
  mode: 'send',
  userMessage: 'hi',
}

/** A minimal but complete database the assembler can flatten. */
const fixtureDatabase = {
  currentChar: 0,
  characters: [
    {
      type: 'character',
      name: 'Tess',
      chaId: 'char-1',
      utilityBot: false,
      chatPage: 0,
      desc: 'DESC',
      firstMessage: 'Greetings.',
      chats: [{ id: 'chat-1', message: [], note: '', name: 'Chat', localLore: [] }],
    },
  ],
  formatingOrder: ['main', 'description', 'chats'],
  promptSettings: {
    assistantPrefill: '',
    postEndInnerFormat: '',
    sendChatAsSystem: false,
    sendName: false,
    utilOverride: false,
  },
  mainPrompt: 'MAIN',
  maxContext: 100_000,
  maxResponse: 50,
}

type JsonRecord = Record<string, unknown>

const DEFAULT_TEST_PERSONA_ID = 'persona-default'
const DEFAULT_TEST_MODEL_PRESET_ID = 'model-preset-default'
const DEFAULT_TEST_PROMPT_PRESET_ID = 'prompt-preset-default'

function normalizeGenerationFixtureDatabase(database: unknown): unknown {
  const normalized = structuredClone(database)
  if (!isJsonRecord(normalized)) return normalized

  ensureDefaultFixturePersona(normalized)
  ensureDefaultFixturePresets(normalized)
  fillDefaultChatGenerationSettings(normalized)

  return normalized
}

function ensureDefaultFixturePersona(database: JsonRecord): void {
  if (!Array.isArray(database.personas) || database.personas.length === 0) {
    const personas: Parameters<typeof saveSelectedPersonaSnapshot>[1] = [
      {
        id: DEFAULT_TEST_PERSONA_ID,
        name: 'User',
        icon: '',
        personaPrompt: '',
        note: '',
      },
    ]
    database.personas = personas
    database.selectedPersona = 0
    saveSelectedPersonaSnapshot(database, personas)
  }
}

function ensureDefaultFixturePresets(database: JsonRecord): void {
  if (!Array.isArray(database.modelPresets) || database.modelPresets.length === 0) {
    database.modelPresets = [
      {
        id: DEFAULT_TEST_MODEL_PRESET_ID,
        name: 'Default Model',
        maxContext: database.maxContext ?? 100_000,
        maxResponse: database.maxResponse ?? 50,
      },
    ]
    database.modelPresetsId = 0
  }

  if (!Array.isArray(database.promptPresets) || database.promptPresets.length === 0) {
    database.promptPresets = [
      {
        id: DEFAULT_TEST_PROMPT_PRESET_ID,
        name: 'Default Prompt',
        mainPrompt: database.mainPrompt ?? 'MAIN',
        formatingOrder: database.formatingOrder ?? ['main', 'description', 'chats'],
        promptSettings: database.promptSettings ?? {
          assistantPrefill: '',
          postEndInnerFormat: '',
          sendChatAsSystem: false,
          sendName: false,
          utilOverride: false,
        },
        customPromptTemplateToggle: '',
      },
    ]
    database.promptPresetsId = 0
  }
}

function fillDefaultChatGenerationSettings(database: JsonRecord): void {
  const personaId = firstId(database.personas, DEFAULT_TEST_PERSONA_ID)
  const modelPresetId = firstId(database.modelPresets, DEFAULT_TEST_MODEL_PRESET_ID)
  const promptPresetId = firstId(database.promptPresets, DEFAULT_TEST_PROMPT_PRESET_ID)
  const characters = Array.isArray(database.characters) ? database.characters : []
  for (const character of characters) {
    if (!isJsonRecord(character) || !Array.isArray(character.chats)) continue
    for (const chat of character.chats) {
      if (!isJsonRecord(chat)) continue
      if (Object.prototype.hasOwnProperty.call(chat, 'generationSettings')) continue
      chat.generationSettings = {
        configured: true,
        personaId,
        modelPresetId,
        promptPresetId,
        jailbreakToggle: database.jailbreakToggle === true,
        sidebarToggles: {},
      }
    }
  }
}

function firstId(collection: unknown, fallback: string): string {
  if (!Array.isArray(collection)) return fallback
  const first = collection.find((item) => isJsonRecord(item) && typeof item.id === 'string')
  return isJsonRecord(first) && typeof first.id === 'string' ? first.id : fallback
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

async function seedDatabase(_app: FastifyInstance, _assertion: string, database: unknown): Promise<number> {
  const db = openDatabase(harness.dataDir)
  try {
    const result = applyImport(
      db,
      harness.dataDir,
      normalizeRisuSaveSnapshotDatabase(normalizeGenerationFixtureDatabase(database)),
    )
    return result.revision
  } finally {
    db.close()
  }
}

async function importRisuSaveDatabase(app: FastifyInstance, assertion: string, database: unknown): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    headers: { 'risu-auth': assertion },
    payload: { database },
  })
  expect(res.statusCode).toBe(200)
  return res.json().revision as number
}

interface ProtocolMetric {
  metric: string
  type?: string
  status?: string
  chatId?: string
  characterId?: string
  mode?: string
  requestId?: string
  requestUid?: string
  xRisuCaller?: string
  loadoutId?: string
  expectedRevision?: number
  inlayAssetsCount?: number
  inlayAssetRefsCount?: number
  durable?: boolean
  compactPromptEvent?: boolean
  generationId?: string
  durableJobId?: string
  revision?: number
  durationMs?: number
  promptMs?: number
  databaseLoadCount?: number
  databaseLoadMs?: number
  stageTimingsMs?: Record<string, number>
  chatVarMutationCount?: number
  persistMessages?: boolean
  hasVarWrite?: boolean
  eventType?: string
  mutationPath?: string
  dbJsonWriteMs?: number
  loadMs?: number
  totalMs?: number
  writtenTables?: string[]
  fallbackType?: string
  targetMessageId?: string
  targetSnapshotKind?: string
  targetSnapshotTranscriptLength?: number
  completionLength?: number
  completionBytes?: number
  completionSha256?: string
  error?: string
  source?: string
  promptHash?: string
  promptRowCount?: number
  promptRoleSequence?: string
  promptRows?: PromptRowSummary[]
  promptContentBytes?: number
  promptContentChars?: number
  promptMultimodalCount?: number
  promptMultimodalBase64Bytes?: number
  inputTokens?: number
  outputTokens?: number
  modelPresetId?: string
  promptPresetId?: string
  activeModuleCount?: number
  activeModuleIds?: string[]
  lorebookActivationCount?: number
  lorebookActivationSourceCount?: number
  messageMutationCount?: number
  additionalSystemPromptMutationCount?: number
  varChanged?: boolean
  submitTranscriptChanged?: boolean
  persistedRevision?: number
  shouldDispatch?: boolean
  promptEventHasFormated?: boolean
  promptEventHasMessages?: boolean
  promptEventHasLorebookActivation?: boolean
  promptEventHasPromptInfo?: boolean
  fullPromptSidecar?: GenerationTraceSidecarEntry
  bodySidecar?: GenerationTraceSidecarEntry
  runCount?: number
  hostEventCount?: number
  logCount?: number
  llmAttemptCount?: number
  llmBlockedCount?: number
  axLlmAttemptCount?: number
  axLlmCompletedCount?: number
  setChatCount?: number
  setChatChangedCount?: number
  transcriptChanged?: boolean
  editOutputTextChanged?: boolean
  runs?: Array<Record<string, unknown>>
}

const EXPECTED_PROMPT_ASSEMBLY_STAGES = [
  'scope_resolution',
  'submit_transforms',
  'static_plain_slots',
  'lorebook_preflight',
  'history_bias',
  'memory_bridge',
  'final_render',
  'budget',
] as const

function expectPromptAssemblyStageTimings(metric: ProtocolMetric | undefined): void {
  expect(metric?.stageTimingsMs).toBeDefined()
  for (const stage of EXPECTED_PROMPT_ASSEMBLY_STAGES) {
    expect(metric?.stageTimingsMs?.[stage]).toBeGreaterThanOrEqual(0)
  }
}

async function withProtocolMetrics<T>(
  run: (metrics: ProtocolMetric[], rawMetricLines: string[]) => Promise<T>,
): Promise<T> {
  const previous = process.env.RISU_PROTOCOL_METRICS
  const metrics: ProtocolMetric[] = []
  const rawMetricLines: string[] = []
  process.env.RISU_PROTOCOL_METRICS = '1'
  const infoSpy = vi.spyOn(console, 'info').mockImplementation((message: unknown) => {
    if (typeof message !== 'string' || !message.startsWith('[protocol-metric] ')) return
    rawMetricLines.push(message)
    metrics.push(JSON.parse(message.slice('[protocol-metric] '.length)) as ProtocolMetric)
  })
  try {
    return await run(metrics, rawMetricLines)
  } finally {
    infoSpy.mockRestore()
    if (previous === undefined) {
      delete process.env.RISU_PROTOCOL_METRICS
    } else {
      process.env.RISU_PROTOCOL_METRICS = previous
    }
  }
}

function readGenerationSidecar(dataDir: string, entry: GenerationTraceSidecarEntry | undefined): unknown {
  expect(entry).toMatchObject({ status: 'written', path: expect.stringMatching(/^trace\/generation\/.+\.json\.gz$/) })
  const sidecar = entry as Extract<GenerationTraceSidecarEntry, { status: 'written' }>
  return JSON.parse(gunzipSync(readFileSync(path.join(dataDir, sidecar.path))).toString('utf8'))
}

function metricSummary(metric: ProtocolMetric | undefined): Record<string, unknown> | undefined {
  if (!metric) return undefined
  return {
    metric: metric.metric,
    ...(metric.type ? { type: metric.type } : {}),
    ...(metric.status ? { status: metric.status } : {}),
    ...(metric.mode ? { mode: metric.mode } : {}),
    ...(metric.eventType ? { eventType: metric.eventType } : {}),
    ...(metric.mutationPath ? { mutationPath: metric.mutationPath } : {}),
    ...(typeof metric.revision === 'number' ? { revision: metric.revision } : {}),
    ...(typeof metric.durationMs === 'number' ? { durationMs: metric.durationMs } : {}),
    ...(typeof metric.promptMs === 'number' ? { promptMs: metric.promptMs } : {}),
    ...(typeof metric.databaseLoadCount === 'number' ? { databaseLoadCount: metric.databaseLoadCount } : {}),
    ...(typeof metric.databaseLoadMs === 'number' ? { databaseLoadMs: metric.databaseLoadMs } : {}),
    ...(metric.stageTimingsMs ? { stageTimingsMs: metric.stageTimingsMs } : {}),
    ...(typeof metric.chatVarMutationCount === 'number' ? { chatVarMutationCount: metric.chatVarMutationCount } : {}),
    ...(typeof metric.persistMessages === 'boolean' ? { persistMessages: metric.persistMessages } : {}),
    ...(typeof metric.hasVarWrite === 'boolean' ? { hasVarWrite: metric.hasVarWrite } : {}),
    ...(typeof metric.dbJsonWriteMs === 'number' ? { dbJsonWriteMs: metric.dbJsonWriteMs } : {}),
    ...(typeof metric.totalMs === 'number' ? { totalMs: metric.totalMs } : {}),
  }
}

async function listenHarness(): Promise<string> {
  await harness.app.listen({ port: 0, host: '127.0.0.1' })
  const address = harness.app.server.address()
  if (!address || typeof address === 'string') {
    throw new Error('test harness did not bind to a TCP address')
  }
  return `http://127.0.0.1:${(address as AddressInfo).port}`
}

function authHeaders(assertion: string, extra: Record<string, string> = {}): Record<string, string> {
  return { 'risu-auth': assertion, ...extra }
}

async function readStreamingEvents(
  res: Response,
  until: (frame: PromptChatFrame) => boolean,
): Promise<PromptChatFrame[]> {
  expect(res.body).toBeTruthy()
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  const events: PromptChatFrame[] = []
  let buffer = ''

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let frameEnd: number
      while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, frameEnd)
        buffer = buffer.slice(frameEnd + 2)
        if (
          !block
            .replace(/\r/g, '')
            .split('\n')
            .some((line) => line.startsWith('event: '))
        ) {
          continue
        }
        const [frame] = parseEvents(`${block}\n\n`)
        events.push(frame)
        if (until(frame)) return events
      }
    }
  } catch {
    // The test may intentionally abort the client after the terminal proof.
  }

  return events
}

describe('H1 provider transport abort contract', () => {
  it('H1: treats sliding-deadline silent transport return as aborted', async () => {
    const controller = new AbortController()
    const events: PromptChatEvent[] = []
    const sideEffects = vi.fn((): PromptChatEvent[] => [
      { type: 'side_effect', kind: 'tts', payload: { text: 'partial', characterId: 'char-1' } },
    ])
    const postGeneration = vi.fn(async () => ({ revision: 3 }))

    async function* frames(): AsyncGenerator<CompletionStreamFrame> {
      yield { kind: 'token', content: 'partial' }
      controller.abort()
    }

    const result = await emitProviderChunks(frames(), (event) => events.push(event), controller.signal, {
      doneMetadata: () => ({ generationId: 'generation-h1' }),
      sideEffects,
      postGeneration,
    })

    expect(result).toEqual({ status: 'aborted', result: 'partial' })
    expect(events).toEqual([{ type: 'token', content: 'partial' }])
    expectNoSuccessDoneAfterAbort(events)
    expect(sideEffects).not.toHaveBeenCalled()
    expect(postGeneration).not.toHaveBeenCalled()
  })

  it('H1: re-checks abort before an in-loop provider done frame', async () => {
    const controller = new AbortController()
    const events: PromptChatEvent[] = []
    const sideEffects = vi.fn((): PromptChatEvent[] => [])
    const postGeneration = vi.fn(async () => ({ revision: 4 }))

    async function* frames(): AsyncGenerator<CompletionStreamFrame> {
      yield { kind: 'token', content: 'partial' }
      controller.abort()
      yield { kind: 'done', finishReason: 'stop' }
    }

    const result = await emitProviderChunks(frames(), (event) => events.push(event), controller.signal, {
      doneMetadata: () => ({ generationId: 'generation-h1-race' }),
      sideEffects,
      postGeneration,
    })

    expect(result).toEqual({ status: 'aborted', result: 'partial' })
    expect(events).toEqual([{ type: 'token', content: 'partial' }])
    expectNoSuccessDoneAfterAbort(events)
    expect(sideEffects).not.toHaveBeenCalled()
    expect(postGeneration).not.toHaveBeenCalled()
  })

  it('H1: treats non-streaming resultFrames-style silent return as aborted', async () => {
    const controller = new AbortController()
    const events: PromptChatEvent[] = []
    const sideEffects = vi.fn((): PromptChatEvent[] => [])
    const postGeneration = vi.fn(async () => ({ revision: 5 }))

    async function* frames(): AsyncGenerator<CompletionStreamFrame> {
      await Promise.resolve()
      controller.abort()
    }

    const result = await emitProviderChunks(frames(), (event) => events.push(event), controller.signal, {
      doneMetadata: () => ({ generationId: 'generation-h1-resultframes' }),
      sideEffects,
      postGeneration,
    })

    expect(result).toEqual({ status: 'aborted', result: '' })
    expect(events).toEqual([])
    expectNoSuccessDoneAfterAbort(events)
    expect(sideEffects).not.toHaveBeenCalled()
    expect(postGeneration).not.toHaveBeenCalled()
  })
})

describe('per-generation stored asset cache', () => {
  it('caches stored asset reads by normalized asset id and purpose', async () => {
    const assetId = 'a'.repeat(64)
    const reads: string[] = []
    const resolver = createRequestScopedStoredAssetResolver(null as any, '/data', (_db, _dataDir, id, purpose) => {
      reads.push(`${purpose}:${id}`)
      return {
        type: purpose === 'inlay' ? 'audio' : 'image',
        base64: `data:${purpose}:${id}`,
      }
    })

    const first = await resolver(assetId, 'asset_prompt')
    const second = await resolver(`assets/${assetId}.png`, 'asset_prompt')
    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    await expect(resolver(assetId, 'inlay')).resolves.toEqual({
      type: 'audio',
      base64: `data:inlay:${assetId}`,
    })
    expect(reads).toEqual([`asset_prompt:${assetId}`, `inlay:${assetId}`])
  })

  it('caches missing assets only for one request-scoped resolver', async () => {
    const assetId = 'b'.repeat(64)
    const reads: string[] = []
    const makeResolver = () =>
      createRequestScopedStoredAssetResolver(null as any, '/data', (_db, _dataDir, id, purpose) => {
        reads.push(`${purpose}:${id}`)
        return undefined
      })

    const firstResolver = makeResolver()
    await expect(firstResolver(assetId, 'asset_prompt')).resolves.toBeUndefined()
    await expect(firstResolver(`assets/${assetId}.webp`, 'asset_prompt')).resolves.toBeUndefined()

    const secondResolver = makeResolver()
    await expect(secondResolver(assetId, 'asset_prompt')).resolves.toBeUndefined()

    expect(reads).toEqual([`asset_prompt:${assetId}`, `asset_prompt:${assetId}`])
  })
})

describe('Phase 7-1 POST /api/v1/generate/chat', () => {
  it('returns 401 without auth once a password is set', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { password: 'hunter2' },
    })
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      payload: basePayload,
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a body missing chatId with 400', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: { ...basePayload, chatId: undefined },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'chatId is required' })
  })

  it('rejects a body missing characterId with 400', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: { ...basePayload, characterId: undefined },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'characterId is required' })
  })

  it('rejects an unrecognized mode with 400', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: { ...basePayload, mode: 'shout' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/mode must be one of/)
  })

  it('rejects mode=send without userMessage', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: { ...basePayload, userMessage: undefined },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({
      error: 'userMessage is required when mode is "send"',
    })
  })

  it('rejects mode=regenerate without regenerateMessageId', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: { chatId: 'chat-1', characterId: 'char-1', mode: 'regenerate' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({
      error: 'regenerateMessageId is required when mode is "regenerate"',
    })
  })

  it('blocks every /generate/chat mode when chat generation settings are incomplete before provider, job, or message side effects', async () => {
    let providerCalls = 0
    await restartHarness({
      dispatchProvider: () => {
        providerCalls++
        async function* source(): AsyncGenerator<CompletionStreamFrame> {
          yield { kind: 'token', content: 'should not stream' }
        }
        return source()
      },
    })
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      characters: [
        {
          ...fixtureDatabase.characters[0],
          chats: [
            {
              id: 'chat-1',
              message: [
                { role: 'user', data: 'first', chatId: 'msg-user-1' },
                { role: 'char', data: 'old reply', chatId: 'msg-char-1', saying: 'char-1' },
              ],
              note: '',
              name: 'Chat',
              localLore: [],
              generationSettings: undefined,
            },
          ],
        },
      ],
    })

    const beforeDb = openDatabase(harness.dataDir)
    let eventCountBefore = 0
    try {
      eventCountBefore = listPersistedCommandEventHistory(beforeDb).length
    } finally {
      beforeDb.close()
    }

    const cases: Array<{ label: string; payload: Record<string, unknown> }> = [
      { label: 'send', payload: basePayload },
      {
        label: 'continue',
        payload: { chatId: 'chat-1', characterId: 'char-1', mode: 'continue' },
      },
      {
        label: 'regenerate',
        payload: {
          chatId: 'chat-1',
          characterId: 'char-1',
          mode: 'regenerate',
          regenerateMessageId: 'msg-char-1',
        },
      },
      {
        label: 'preview',
        payload: { chatId: 'chat-1', characterId: 'char-1', mode: 'preview' },
      },
    ]

    for (const testCase of cases) {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/chat',
        headers: { 'risu-auth': assertion },
        payload: testCase.payload,
      })
      expect(res.statusCode, testCase.label).toBe(409)
      expect(res.headers['content-type'], testCase.label).toMatch(/application\/json/)
      expect(res.body, testCase.label).not.toContain('event:')
      expect(res.json(), testCase.label).toMatchObject({
        statusCode: 409,
        error: 'chat_generation_settings_incomplete',
        message: 'Chat generation settings are incomplete',
        chatId: 'chat-1',
        staleSidebarToggleKeys: [],
      })
      expect(
        res.json().missing.map((reason: { code: string }) => reason.code),
        testCase.label,
      ).toContain('settings_missing')
    }

    expect(providerCalls).toBe(0)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    expect(bootstrap.json().revision).toBe(revision)
    expect(bootstrap.json().activeGenerationJobs).toEqual([])
    const persisted = await persistedMessages(assertion)
    expect(
      persisted.map((message) => ({
        role: message.role,
        data: message.data,
        chatId: message.chatId,
      })),
    ).toEqual([
      { role: 'user', data: 'first', chatId: 'msg-user-1' },
      { role: 'char', data: 'old reply', chatId: 'msg-char-1' },
    ])

    const afterDb = openDatabase(harness.dataDir)
    try {
      expect(listPersistedCommandEventHistory(afterDb)).toHaveLength(eventCountBefore)
    } finally {
      afterDb.close()
    }
  })

  it('streams a regenerate message patch and assembled prompt for the truncated transcript', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      characters: [
        {
          ...fixtureDatabase.characters[0],
          chats: [
            {
              id: 'chat-1',
              message: [
                { role: 'user', data: 'try again', chatId: 'msg-user-1' },
                { role: 'char', data: 'old reply', chatId: 'msg-char-1', saying: 'char-1' },
              ],
              note: '',
              name: 'Chat',
              localLore: [],
            },
          ],
        },
      ],
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: {
        chatId: 'chat-1',
        characterId: 'char-1',
        mode: 'regenerate',
        regenerateMessageId: 'msg-char-1',
        clientCapabilities: { compactPromptEvent: true },
      },
    })
    expect(res.statusCode).toBe(200)

    const events = parseEvents(res.body)
    expect(events.map((e) => e.type)).toEqual([
      'stage',
      'stage',
      'stage',
      'prompt',
      'message_patch',
      'stage',
      'info',
      'error',
      'done',
    ])
    const patch = events.find((e) => e.type === 'message_patch')?.data.patch as
      | {
          messageMutations?: Array<{
            type?: string
            source?: string
            beforeLength?: number
            afterLength?: number
            firstChangedIndex?: number
            messages?: unknown[]
          }>
        }
      | undefined
    expect(patch?.messageMutations).toEqual([
      {
        type: 'replace_all',
        source: 'regenerate',
        beforeLength: 2,
        afterLength: 1,
        firstChangedIndex: 1,
        messages: [],
      },
    ])
    const prompt = events.find((e) => e.type === 'prompt')!
    const formated = prompt.data.formated as Array<{ content: unknown }>
    expect(formated.some((row) => row.content === 'old reply')).toBe(false)
  })

  it('emits an SSE error for an invalid regenerate target', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      characters: [
        {
          ...fixtureDatabase.characters[0],
          chats: [
            {
              id: 'chat-1',
              message: [
                { role: 'user', data: 'first', chatId: 'msg-user-1' },
                { role: 'char', data: 'old reply', chatId: 'msg-char-1' },
                { role: 'user', data: 'second', chatId: 'msg-user-2' },
              ],
              note: '',
              name: 'Chat',
              localLore: [],
            },
          ],
        },
      ],
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: {
        chatId: 'chat-1',
        characterId: 'char-1',
        mode: 'regenerate',
        regenerateMessageId: 'msg-char-1',
      },
    })
    expect(res.statusCode).toBe(200)
    const events = parseEvents(res.body)
    expect(events.find((e) => e.type === 'prompt')).toBeUndefined()
    expect(String(events.find((e) => e.type === 'error')?.data.error)).toMatch(/latest assistant message/)
    expect(events.at(-1)?.type).toBe('done')
  })

  it('streams the assembled prompt for a seeded database', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, fixtureDatabase)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')

    const events = parseEvents(res.body)
    expect(events.map((e) => e.type)).toEqual([
      'stage',
      'stage',
      'stage',
      'prompt',
      'message_patch',
      'stage',
      'info',
      'error',
      'done',
    ])
    const prompt = events.find((e) => e.type === 'prompt')!
    expect(Array.isArray(prompt.data.messages)).toBe(true)
    expect((prompt.data.messages as unknown[]).length).toBeGreaterThan(0)
    // The prompt event also carries full OpenAIChat rows so preview clients can
    // inspect the dispatch payload. `formated` preserves the
    // `role`/`content` of the lossy `messages` projection.
    const formated = prompt.data.formated as Array<{ role: string; content: unknown }>
    expect(Array.isArray(formated)).toBe(true)
    expect(formated.map((r) => ({ role: r.role, content: r.content }))).toEqual(prompt.data.messages)
    expect((prompt.data as Record<string, unknown>).biases).toBeUndefined()
    const messagePatch = events.find((e) => e.type === 'message_patch')
    expect(messagePatch?.data.patch).toMatchObject({
      chatId: 'chat-1',
      characterId: 'char-1',
      messageMutations: expect.any(Array),
      chatVarMutations: expect.any(Array),
    })
    // The prompt stage closes after the patch, then telemetry rides before the
    // provider-dispatch terminal frames.
    expect(events.at(-4)).toEqual({ type: 'stage', data: { stage: 'prompt', status: 'end' } })
    expect(events.at(-3)?.type).toBe('info')
    expect(events.at(-2)?.type).toBe('error')
    expect(events.at(-1)?.type).toBe('done')
  })

  it('M2/L4: omits duplicate prompt fields for compact-capable clients', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, fixtureDatabase)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: {
        ...basePayload,
        clientCapabilities: { compactPromptEvent: true },
      },
    })
    expect(res.statusCode).toBe(200)

    const events = parseEvents(res.body)
    const prompt = events.find((e) => e.type === 'prompt')!
    expect(prompt).toBeDefined()
    expect(Object.prototype.hasOwnProperty.call(prompt.data, 'messages')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(prompt.data, 'lorebookActivation')).toBe(false)
    expect(Array.isArray(prompt.data.formated)).toBe(true)
    expect(prompt.data.promptInfo).toBeDefined()
  })

  it('L19: leaves chat SSE uncompressed when gzip is requested', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, fixtureDatabase)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion, 'accept-encoding': 'gzip' },
      payload: { ...basePayload, clientCapabilities: { compactPromptEvent: true } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')
    expect(res.headers['content-encoding']).toBeUndefined()

    const events = parseEvents(res.body)
    expect(events.at(-1)?.type).toBe('done')
  })

  it('emits an info event with token counts and the response budget', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, fixtureDatabase)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)

    const events = parseEvents(res.body)
    const info = events.find((e) => e.type === 'info')!
    expect(info).toBeDefined()
    const tokens = info.data.tokens as { prompt?: number; total?: number }
    expect(typeof tokens.prompt).toBe('number')
    expect(tokens.total).toBe(tokens.prompt)
    // `responseBudget` mirrors the clamped `maxResponse` from the fixture.
    expect(info.data.responseBudget).toBe(50)
    expect(typeof (info.data.timings as Record<string, number>).prompt).toBe('number')
  })

  it('persists the assembly-time chat-var delta in send mode and bumps the revision (C-A1)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const db = structuredClone(fixtureDatabase) as typeof fixtureDatabase & {
      characters: Array<(typeof fixtureDatabase.characters)[number] & { triggerscript?: unknown }>
    }
    db.characters[0].triggerscript = [
      {
        comment: '',
        type: 'start',
        conditions: [],
        effect: [{ type: 'setvar', operator: '=', var: 'score', value: '9' }],
      },
    ]
    await seedDatabase(harness.app, assertion, db)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    const events = parseEvents(res.body)
    expect(events.at(-1)?.type).toBe('done')
    const patch = events.find((e) => e.type === 'message_patch')?.data.patch as
      | { chatVarMutations?: unknown[]; varChanged?: boolean }
      | undefined
    expect(patch?.varChanged).toBe(true)
    expect(patch?.chatVarMutations).toEqual([{ key: '$score', before: null, after: '9' }])

    // The route persists the assembly-time delta itself and returns the bumped
    // revision on the info frame so the browser can reconcile its cached command
    // revision.
    const info = events.find((e) => e.type === 'info')
    expect(info?.data.revision).toBe(2)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    expect(bootstrap.json().revision).toBe(2)
    expect(bootstrap.json().database.characters[0].chats[0].scriptstate).toEqual({ $score: '9' })
  })

  it('persists lorebook @@keep_activate_after_match and uses it on the next send (L4)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const db = structuredClone(fixtureDatabase) as typeof fixtureDatabase & {
      characters: Array<
        (typeof fixtureDatabase.characters)[number] & {
          globalLore?: unknown[]
        }
      >
    }
    db.formatingOrder = ['main', 'description', 'lorebook', 'chats']
    db.characters[0].globalLore = [
      {
        id: 'lore-keep',
        key: 'cat',
        secondkey: '',
        insertorder: 100,
        comment: 'Sticky route lore',
        content: '@@keep_activate_after_match\nSticky route lore.',
        mode: 'normal',
        alwaysActive: false,
        selective: false,
      },
    ]
    await seedDatabase(harness.app, assertion, db)

    const send = async (userMessage: string): Promise<PromptChatFrame[]> => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/chat',
        headers: { 'risu-auth': assertion },
        payload: { ...basePayload, userMessage },
      })
      expect(res.statusCode).toBe(200)
      return parseEvents(res.body)
    }

    const firstEvents = await send('cat')
    const firstPrompt = firstEvents.find((e) => e.type === 'prompt')!
    expect(
      (firstPrompt.data.messages as Array<{ content: string }>).some(
        (message) => message.content === 'Sticky route lore.',
      ),
    ).toBe(true)
    const firstPatch = firstEvents.find((e) => e.type === 'message_patch')?.data.patch as
      | {
          chatVarMutations?: Array<{ key: string; before: unknown; after: unknown }>
          varChanged?: boolean
        }
      | undefined
    expect(firstPatch?.varChanged).toBe(true)
    expect(firstPatch?.chatVarMutations).toEqual([{ key: '$__internal_ka_lore-keep', before: null, after: 'true' }])
    expect(firstEvents.find((e) => e.type === 'info')?.data.revision).toBe(2)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    expect(bootstrap.json().database.characters[0].chats[0].scriptstate).toEqual({
      '$__internal_ka_lore-keep': 'true',
    })

    const secondEvents = await send('unrelated')
    const secondPrompt = secondEvents.find((e) => e.type === 'prompt')!
    expect(
      (secondPrompt.data.messages as Array<{ content: string }>).some(
        (message) => message.content === 'Sticky route lore.',
      ),
    ).toBe(true)
    const secondPatch = secondEvents.find((e) => e.type === 'message_patch')?.data.patch as
      | { chatVarMutations?: unknown[] }
      | undefined
    expect(secondPatch?.chatVarMutations).toEqual([])
  })

  it('records prompt assembly and assembly-persistence protocol metrics separately', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const db = structuredClone(fixtureDatabase) as typeof fixtureDatabase & {
      characters: Array<(typeof fixtureDatabase.characters)[number] & { triggerscript?: unknown }>
    }
    db.characters[0].triggerscript = [
      {
        comment: '',
        type: 'start',
        conditions: [],
        effect: [{ type: 'setvar', operator: '=', var: 'score', value: '9' }],
      },
    ]
    await seedDatabase(harness.app, assertion, db)

    await withProtocolMetrics(async (metrics) => {
      const sentinel = 'slice-2-secret-route-prompt'
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/chat',
        headers: { 'risu-auth': assertion, 'x-risu-caller': 'chat-generate' },
        payload: { ...basePayload, userMessage: sentinel, expectedRevision: 1, inlayAssets: [], inlayAssetRefs: [] },
      })
      expect(res.statusCode).toBe(200)

      const assembly = metrics.find((entry) => entry.metric === 'generation_prompt_assembly')
      expect(assembly).toMatchObject({
        status: 'ok',
        chatId: 'chat-1',
        characterId: 'char-1',
        mode: 'send',
        xRisuCaller: 'chat-generate',
        expectedRevision: 1,
        inlayAssetsCount: 0,
        inlayAssetRefsCount: 0,
        durable: false,
        compactPromptEvent: false,
        databaseLoadCount: 1,
        promptRowCount: expect.any(Number),
        promptRows: expect.any(Array),
        promptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        inputTokens: expect.any(Number),
        outputTokens: 50,
        modelPresetId: DEFAULT_TEST_MODEL_PRESET_ID,
        promptPresetId: DEFAULT_TEST_PROMPT_PRESET_ID,
        activeModuleCount: 0,
        lorebookActivationCount: 0,
        messageMutationCount: 1,
        chatVarMutationCount: 1,
        additionalSystemPromptMutationCount: 0,
        varChanged: true,
      })
      expect(typeof assembly?.requestId).toBe('string')
      expect(assembly?.durationMs).toBeGreaterThanOrEqual(0)
      expect(assembly?.promptMs).toBeGreaterThanOrEqual(0)
      expect(assembly?.databaseLoadMs).toBeGreaterThanOrEqual(0)
      expectPromptAssemblyStageTimings(assembly)

      const emission = metrics.find((entry) => entry.metric === 'generation_prompt_emission')
      expect(emission).toMatchObject({
        status: 'ok',
        chatId: 'chat-1',
        characterId: 'char-1',
        mode: 'send',
        durable: false,
        compactPromptEvent: false,
        shouldDispatch: true,
        revision: 2,
        persistedRevision: 2,
        promptHash: assembly?.promptHash,
        promptRowCount: assembly?.promptRowCount,
        promptRoleSequence: assembly?.promptRoleSequence,
        promptRows: assembly?.promptRows,
        promptEventHasFormated: true,
        promptEventHasMessages: true,
        promptEventHasLorebookActivation: true,
        promptEventHasPromptInfo: true,
      })

      const prompt = parseEvents(res.body).find((event) => event.type === 'prompt')
      expect(Array.isArray(prompt?.data.formated)).toBe(true)
      const emittedSummary = summarizePromptRows(prompt!.data.formated as never)
      expect(emittedSummary.promptHash).toBe(assembly?.promptHash)
      expect(emittedSummary.promptHash).toBe(emission?.promptHash)
      expect(emittedSummary.rows).toEqual(assembly?.promptRows)
      expect(emittedSummary.rows).toEqual(emission?.promptRows)

      const metricsJson = JSON.stringify(metrics)
      expect(metricsJson).not.toContain(sentinel)

      const persistence = metrics.find((entry) => entry.metric === 'generation_assembly_persistence')
      expect(persistence).toMatchObject({
        status: 'ok',
        chatId: 'chat-1',
        mode: 'send',
        revision: 2,
        eventType: 'chat.scriptstate.updated',
        chatVarMutationCount: 1,
        persistMessages: false,
        hasVarWrite: true,
      })
      expect(persistence?.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  it('does not write full prompt sidecars when only protocol metrics are enabled', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, fixtureDatabase)

    await withProtocolMetrics(async (metrics) => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/chat',
        headers: { 'risu-auth': assertion },
        payload: { ...basePayload, userMessage: 'SIDEcar disabled sentinel' },
      })
      expect(res.statusCode).toBe(200)

      const emission = metrics.find((entry) => entry.metric === 'generation_prompt_emission')
      expect(emission?.fullPromptSidecar).toBeUndefined()
      expect(existsSync(path.join(harness.dataDir, 'trace', 'generation'))).toBe(false)
    })
  })

  it('writes opt-in full prompt sidecars without putting prompt text in metrics', async () => {
    await restartHarness({}, { fullPrompt: true, maxGzipBytes: 10 * 1024 * 1024 })
    const { assertion } = await setupAuthedClient(harness.app)
    const sentinel = 'FULL_PROMPT_SIDECAR_SENTINEL'
    await seedDatabase(harness.app, assertion, { ...fixtureDatabase, mainPrompt: `MAIN ${sentinel}` })

    await withProtocolMetrics(async (metrics, rawMetricLines) => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/chat',
        headers: { 'risu-auth': assertion },
        payload: { ...basePayload, userMessage: 'hi' },
      })
      expect(res.statusCode).toBe(200)

      const emission = metrics.find((entry) => entry.metric === 'generation_prompt_emission')
      expect(emission?.fullPromptSidecar).toMatchObject({
        status: 'written',
        path: expect.stringMatching(/^trace\/generation\/prompt-.+\.json\.gz$/),
        bytes: expect.any(Number),
        gzipBytes: expect.any(Number),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
      const sidecar = readGenerationSidecar(harness.dataDir, emission?.fullPromptSidecar)
      expect(JSON.stringify(sidecar)).toContain(sentinel)
      expect(rawMetricLines.join('\n')).not.toContain(sentinel)
    })
  })

  it('omits full prompt sidecars over the gzip cap without writing a file', async () => {
    await restartHarness({}, { fullPrompt: true, maxGzipBytes: 1 })
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, fixtureDatabase)

    await withProtocolMetrics(async (metrics) => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/chat',
        headers: { 'risu-auth': assertion },
        payload: { ...basePayload, userMessage: 'cap overflow sentinel' },
      })
      expect(res.statusCode).toBe(200)

      const emission = metrics.find((entry) => entry.metric === 'generation_prompt_emission')
      expect(emission?.fullPromptSidecar).toMatchObject({
        status: 'omitted',
        reason: 'max_gzip_bytes_exceeded',
        maxGzipBytes: 1,
      })
      expect(existsSync(path.join(harness.dataDir, 'trace', 'generation'))).toBe(false)
    })
  })

  it('uses authoritative prompt rows for sidecars when compact prompt events are requested', async () => {
    await restartHarness({}, { fullPrompt: true, maxGzipBytes: 10 * 1024 * 1024 })
    const { assertion } = await setupAuthedClient(harness.app)
    const sentinel = 'COMPACT_PROMPT_AUTH_ROWS_SENTINEL'
    await seedDatabase(harness.app, assertion, { ...fixtureDatabase, mainPrompt: `MAIN ${sentinel}` })

    await withProtocolMetrics(async (metrics) => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/chat',
        headers: { 'risu-auth': assertion },
        payload: {
          ...basePayload,
          userMessage: 'hi',
          clientCapabilities: { compactPromptEvent: true },
        },
      })
      expect(res.statusCode).toBe(200)
      const prompt = parseEvents(res.body).find((event) => event.type === 'prompt')
      expect(prompt?.data.messages).toBeUndefined()

      const emission = metrics.find((entry) => entry.metric === 'generation_prompt_emission')
      expect(emission?.compactPromptEvent).toBe(true)
      const sidecar = readGenerationSidecar(harness.dataDir, emission?.fullPromptSidecar)
      expect(JSON.stringify(sidecar)).toContain(sentinel)
    })
  })

  it('reviews representative generation prompt metric families for next-slice selection', async () => {
    await withProtocolMetrics(async (metrics) => {
      const samples: Array<{ label: string; metrics: ProtocolMetric[] }> = []
      const collect = (label: string, from: number): ProtocolMetric[] => {
        const slice = metrics.slice(from)
        samples.push({ label, metrics: slice })
        return slice
      }
      const postChat = async (assertion: string, payload: Record<string, unknown>) => {
        const res = await harness.app.inject({
          method: 'POST',
          url: '/api/v1/generate/chat',
          headers: { 'risu-auth': assertion },
          payload,
        })
        expect(res.statusCode).toBe(200)
        return res
      }

      let auth = await setupAuthedClient(harness.app)
      await seedDatabase(harness.app, auth.assertion, fixtureDatabase)
      let before = metrics.length
      await postChat(auth.assertion, basePayload)
      const plain = collect('plain-send', before)
      const plainAssembly = plain.find((entry) => entry.metric === 'generation_prompt_assembly')
      expect(plainAssembly).toMatchObject({
        status: 'ok',
        mode: 'send',
        databaseLoadCount: 1,
      })
      expectPromptAssemblyStageTimings(plainAssembly)
      expect(plain.find((entry) => entry.metric === 'generation_assembly_persistence')).toMatchObject({
        status: 'skipped',
        mode: 'send',
        persistMessages: false,
        hasVarWrite: false,
      })
      expect(plain.some((entry) => entry.metric === 'command_mutation')).toBe(false)

      const chatVarDb = structuredClone(fixtureDatabase) as typeof fixtureDatabase & {
        characters: Array<(typeof fixtureDatabase.characters)[number] & { triggerscript?: unknown }>
      }
      chatVarDb.characters[0].triggerscript = [
        {
          comment: '',
          type: 'start',
          conditions: [],
          effect: [{ type: 'setvar', operator: '=', var: 'score', value: '9' }],
        },
      ]
      await seedDatabase(harness.app, auth.assertion, chatVarDb)
      before = metrics.length
      await postChat(auth.assertion, basePayload)
      const chatVar = collect('chat-var-side-effect', before)
      expectPromptAssemblyStageTimings(chatVar.find((entry) => entry.metric === 'generation_prompt_assembly'))
      expect(chatVar.find((entry) => entry.metric === 'generation_assembly_persistence')).toMatchObject({
        status: 'ok',
        mode: 'send',
        eventType: 'chat.scriptstate.updated',
        persistMessages: false,
        hasVarWrite: true,
      })
      expect(chatVar.find((entry) => entry.metric === 'command_mutation')).toMatchObject({
        type: 'chat.scriptstate.updated',
        mutationPath: 'targeted-assembly',
        writtenTables: [...BROAD_WRITE_TABLES],
      })
      assertCommandMetricGate(chatVar.find((entry) => entry.metric === 'command_mutation') as CommandMutationMetric)

      await seedDatabase(
        harness.app,
        auth.assertion,
        dbWithSubmitLua(
          `
            listenEdit('editInput', function(id, data, meta)
              return data .. ' [EDITINPUT]'
            end)
          `,
          ['main', 'description', 'chats', 'lastChat'],
        ),
      )
      before = metrics.length
      await postChat(auth.assertion, basePayload)
      const transcriptRewrite = collect('editinput-transcript-rewrite', before)
      expectPromptAssemblyStageTimings(transcriptRewrite.find((entry) => entry.metric === 'generation_prompt_assembly'))
      expect(transcriptRewrite.find((entry) => entry.metric === 'generation_assembly_persistence')).toMatchObject({
        status: 'ok',
        mode: 'send',
        eventType: 'generation.assemblyPersisted',
        persistMessages: true,
        hasVarWrite: false,
      })
      expect(transcriptRewrite.find((entry) => entry.metric === 'command_mutation')).toMatchObject({
        type: 'generation.assemblyPersisted',
        mutationPath: 'targeted-assembly',
        writtenTables: ['messages'],
      })
      assertCommandMetricGate(
        transcriptRewrite.find((entry) => entry.metric === 'command_mutation') as CommandMutationMetric,
      )

      await seedDatabase(
        harness.app,
        auth.assertion,
        dbWithSubmitLua(`
          function onInput(triggerId)
            addChat(triggerId, 'char', 'INPUT-LUA-ROW')
            setState(triggerId, 'inputseen', 1)
          end
        `),
      )
      before = metrics.length
      await postChat(auth.assertion, basePayload)
      const combinedSideEffects = collect('input-trigger-transcript-and-chat-var', before)
      expectPromptAssemblyStageTimings(
        combinedSideEffects.find((entry) => entry.metric === 'generation_prompt_assembly'),
      )
      expect(combinedSideEffects.find((entry) => entry.metric === 'generation_assembly_persistence')).toMatchObject({
        status: 'ok',
        mode: 'send',
        eventType: 'generation.assemblyPersisted',
        persistMessages: true,
        hasVarWrite: true,
      })
      expect(combinedSideEffects.find((entry) => entry.metric === 'command_mutation')).toMatchObject({
        type: 'generation.assemblyPersisted',
        mutationPath: 'targeted-assembly',
      })
      assertCommandMetricGate(
        combinedSideEffects.find((entry) => entry.metric === 'command_mutation') as CommandMutationMetric,
      )

      await seedDatabase(harness.app, auth.assertion, fixtureDatabase)
      before = metrics.length
      const preview = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/preview-prompt',
        headers: { 'risu-auth': auth.assertion, 'x-risu-caller': 'preview-prompt' },
        payload: {
          chatId: 'chat-1',
          characterId: 'char-1',
          clientCapabilities: { compactPromptEvent: true },
        },
      })
      expect(preview.statusCode).toBe(200)
      const previewMetrics = collect('preview-prompt', before)
      const previewAssembly = previewMetrics.find((entry) => entry.metric === 'generation_prompt_assembly')
      expect(previewAssembly).toMatchObject({
        status: 'ok',
        chatId: 'chat-1',
        characterId: 'char-1',
        mode: 'preview_prompt',
        xRisuCaller: 'preview-prompt',
        durable: false,
        compactPromptEvent: true,
        databaseLoadCount: 1,
      })
      expectPromptAssemblyStageTimings(previewAssembly)
      expect(previewMetrics.some((entry) => entry.metric === 'generation_assembly_persistence')).toBe(false)

      await restartHarness({
        dispatchProvider: () => {
          async function* source(): AsyncGenerator<CompletionStreamFrame> {
            yield { kind: 'token', content: 'Durable hello' }
            yield { kind: 'done', finishReason: 'stop' }
          }
          return source()
        },
      })
      auth = await setupAuthedClient(harness.app)
      await seedDatabase(harness.app, auth.assertion, fixtureDatabase)
      before = metrics.length
      const durableRes = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/chat',
        headers: { 'risu-auth': auth.assertion, 'x-risu-caller': 'chat-generate' },
        payload: { ...basePayload, durable: true },
      })
      expect(durableRes.statusCode).toBe(200)
      const durable = collect('durable-generation', before)
      const durableAssembly = durable.find((entry) => entry.metric === 'generation_prompt_assembly')
      expect(durableAssembly).toMatchObject({
        status: 'ok',
        chatId: 'chat-1',
        characterId: 'char-1',
        mode: 'send',
        xRisuCaller: 'chat-generate',
        durable: true,
        databaseLoadCount: 1,
        promptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        promptRows: expect.any(Array),
      })
      expect(typeof durableAssembly?.generationId).toBe('string')
      expect(durableAssembly?.durableJobId).toBe(durableAssembly?.generationId)
      expectPromptAssemblyStageTimings(durableAssembly)
      const durableEmission = durable.find((entry) => entry.metric === 'generation_prompt_emission')
      expect(durableEmission).toMatchObject({
        status: 'ok',
        chatId: 'chat-1',
        characterId: 'char-1',
        mode: 'send',
        xRisuCaller: 'chat-generate',
        durable: true,
        durableJobId: durableAssembly?.durableJobId,
        generationId: durableAssembly?.generationId,
        promptHash: durableAssembly?.promptHash,
        promptRowCount: durableAssembly?.promptRowCount,
        promptRoleSequence: durableAssembly?.promptRoleSequence,
        promptRows: durableAssembly?.promptRows,
        shouldDispatch: true,
      })
      expect(durable.find((entry) => entry.metric === 'generation_assembly_persistence')).toMatchObject({
        status: 'skipped',
        mode: 'send',
      })
      expect(durable.find((entry) => entry.metric === 'generation_persistence')).toMatchObject({
        status: 'ok',
      })
      const durablePersistMetric = durable.find(
        (entry) => entry.metric === 'command_mutation' && entry.type === 'generation.persisted',
      )
      expect(durablePersistMetric).toMatchObject({
        mutationPath: 'targeted-generation',
        dbJsonWriteMs: 0,
        writtenTables: ['messages'],
      })
      assertCommandMetricGate(durablePersistMetric as CommandMutationMetric)

      if (process.env.RISU_GENERATION_METRIC_SUMMARY === '1') {
        console.log(
          JSON.stringify(
            samples.map(({ label, metrics: slice }) => ({
              label,
              promptAssembly: metricSummary(slice.find((entry) => entry.metric === 'generation_prompt_assembly')),
              assemblyPersistence: metricSummary(
                slice.find((entry) => entry.metric === 'generation_assembly_persistence'),
              ),
              generationPersistence: metricSummary(slice.find((entry) => entry.metric === 'generation_persistence')),
              commandMutation: metricSummary(slice.find((entry) => entry.metric === 'command_mutation')),
            })),
            null,
            2,
          ),
        )
      }
    })
  })

  // The server Lua VM runs the `editRequest` hook during assembly, mirroring the
  // browser's `runLuaEditTrigger(char,'editRequest',formated)`.
  function dbWithEditRequestLua(code: string): unknown {
    const db = structuredClone(fixtureDatabase) as typeof fixtureDatabase & {
      characters: Array<(typeof fixtureDatabase.characters)[number] & { triggerscript?: unknown }>
    }
    db.characters[0].triggerscript = [
      { comment: '', type: 'request', conditions: [], effect: [{ type: 'triggerlua', code }] },
    ]
    return db
  }

  it('runs a Lua editRequest hook that rewrites the assembled prompt rows (slice 3b)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    // Suffix every rendered row. The regex-only baseline leaves 'MAIN' untouched
    // (see the plain-fixture send above); the Lua hook makes it 'MAIN [LUA]'.
    await seedDatabase(
      harness.app,
      assertion,
      dbWithEditRequestLua(`
        listenEdit('editRequest', function(id, data, meta)
          for i = 1, #data do
            data[i].content = data[i].content .. ' [LUA]'
          end
          return data
        end)
      `),
    )

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    const events = parseEvents(res.body)
    const prompt = events.find((e) => e.type === 'prompt')!
    const messages = prompt.data.messages as Array<{ role: string; content: string }>
    expect(messages.length).toBeGreaterThan(0)
    // The 'MAIN' row was rewritten in place (not duplicated), proving the hook
    // ran over the final server-assembled rows.
    expect(messages.some((m) => m.content === 'MAIN [LUA]')).toBe(true)
    expect(messages.some((m) => m.content === 'MAIN')).toBe(false)
    expect(messages.every((m) => typeof m.content === 'string' && m.content.endsWith(' [LUA]'))).toBe(true)
  })

  it('persists a Lua editRequest setChatVar write via the assembly chat-var delta (slice 3b)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    // The hook's var engine is bound to the same db chat scriptstate the route
    // persists, so a `setChatVar`/`setState` during the hook lands in the
    // assembly chat-var delta and bumps the revision (no extra browser re-POST).
    await seedDatabase(
      harness.app,
      assertion,
      dbWithEditRequestLua(`
        listenEdit('editRequest', function(id, data, meta)
          setState(id, 'turns', 3)
          return data
        end)
      `),
    )

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    const events = parseEvents(res.body)
    const patch = events.find((e) => e.type === 'message_patch')?.data.patch as
      | {
          chatVarMutations?: Array<{ key: string; before: unknown; after: unknown }>
          varChanged?: boolean
        }
      | undefined
    // `setState(id,'turns',3)` writes the JSON-encoded value under the `__`-prefixed
    // key; the var engine stores it at `$__turns` in scriptstate.
    expect(patch?.varChanged).toBe(true)
    expect(patch?.chatVarMutations).toEqual([{ key: '$__turns', before: null, after: '3' }])

    const info = events.find((e) => e.type === 'info')
    expect(info?.data.revision).toBe(2)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    expect(bootstrap.json().database.characters[0].chats[0].scriptstate).toEqual({ $__turns: '3' })
  })

  // Byte-parity vs the local golden. The browser fixture sweep
  // (`src/ts/process/__fixtures__`) computes its `editrequest-trigger` golden with
  // a *mocked* `runLuaEditTrigger` that appends a fixed marker row whenever a char
  // has a triggerscript. Here the real server Lua VM runs Lua that appends the
  // same row — so the server reproduces the golden marker byte-for-byte. (This
  // lives in the node-env server suite because wasmoon cannot initialize under the
  // browser suite's jsdom environment; see the note in
  // `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`.)
  it('reproduces the local golden editRequest marker row byte-for-byte (slice 3b)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(
      harness.app,
      assertion,
      dbWithEditRequestLua(`
        listenEdit('editRequest', function(id, data, meta)
          data[#data + 1] = { role = 'system', content = '[edit-request marker]', memo = 'edit-request-marker' }
          return data
        end)
      `),
    )

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    const events = parseEvents(res.body)
    const prompt = events.find((e) => e.type === 'prompt')!
    const formated = prompt.data.formated as Array<Record<string, unknown>>
    const serverMarker = formated.find((row) => row.content === '[edit-request marker]')

    // Load the committed local golden and pull its editRequest marker row.
    const goldenPath = fileURLToPath(
      new URL('../../../src/ts/process/__fixtures__/expected/editrequest-trigger.json', import.meta.url),
    )
    const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as {
      providerCalls: Array<{ formated: Array<Record<string, unknown>> }>
    }
    const goldenMarker = golden.providerCalls[0].formated.find((row) => row.content === '[edit-request marker]')
    expect(goldenMarker).toBeDefined()
    expect(serverMarker).toEqual(goldenMarker)
  })

  // Lua `editprocess` is a browser no-op, so a `triggerlua` char must assemble
  // history identically to the same char without it. The Lua here would rewrite
  // any body it processed, so the marker's absence proves the no-op is faithful.
  it('runs Lua editprocess through the runtime as a no-op at parity (slice 3b)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)

    const editProcessLua = `
      function editprocess(id)
        return 'EDITPROCESS-MUTATED'
      end
    `

    const collect = async (): Promise<Array<{ role: string; content: unknown }>> => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/chat',
        headers: { 'risu-auth': assertion },
        payload: basePayload,
      })
      expect(res.statusCode).toBe(200)
      const prompt = parseEvents(res.body).find((e) => e.type === 'prompt')!
      return prompt.data.messages as Array<{ role: string; content: unknown }>
    }

    // Baseline: a history body ('PROC-BODY') + the fixture first message
    // ('Greetings.'), no Lua. Re-seeding before the second send resets the
    // transcript (the first send appended `userMessage`), so both assemble from
    // the same starting point.
    await seedDatabase(harness.app, assertion, dbWithHistoryMessage('PROC-BODY'))
    const baseline = await collect()

    // Same char + the editprocess-defining triggerlua.
    await seedDatabase(
      harness.app,
      assertion,
      dbWithHistoryMessage('PROC-BODY', {
        triggerscript: [
          {
            comment: '',
            type: 'request',
            conditions: [],
            effect: [{ type: 'triggerlua', code: editProcessLua }],
          },
        ],
      }),
    )
    const withLua = await collect()

    // Byte-identical assembled rows: the editprocess no-op rewrote nothing.
    expect(withLua).toEqual(baseline)
    // Both the per-message body and the first message survive verbatim…
    expect(withLua.some((m) => m.content === 'PROC-BODY')).toBe(true)
    expect(withLua.some((m) => m.content === 'Greetings.')).toBe(true)
    // …and the would-be editprocess rewrite never surfaced anywhere.
    expect(withLua.every((m) => !String(m.content).includes('EDITPROCESS-MUTATED'))).toBe(true)
  })

  // The marker rides on a *history* user message (the `chats` slot); the
  // appended `userMessage` would land in the unrendered `lastChat` slot given
  // this fixture's `['main','description','chats']` order.
  function dbWithHistoryMessage(data: string, extraChar: Record<string, unknown> = {}): unknown {
    const db = structuredClone(fixtureDatabase) as typeof fixtureDatabase & {
      characters: Array<Record<string, unknown>>
    }
    Object.assign(db.characters[0], extraChar)
    ;(db.characters[0].chats as Array<{ message: unknown[] }>)[0].message = [
      { role: 'user', data, chatId: 'msg-marker' },
    ]
    return db
  }

  // Submit-time input trigger + `editinput`.
  //
  // The server runs the chat-screen submit handler's input trigger and
  // `editinput` transform before assembly, then owns the post-`editinput`
  // transcript write. These tests live in node because wasmoon cannot init under
  // the browser suite's jsdom.

  /** A char whose `triggerlua` defines the submit-time hook (`onInput` for the
   * input trigger, `listenEdit('editInput', …)` for editinput). `type: 'input'`
   * is cosmetic — a `triggerlua` first effect bypasses the mode filter. */
  function dbWithSubmitLua(code: string, formatOrder?: string[]): unknown {
    const db = structuredClone(fixtureDatabase) as typeof fixtureDatabase & {
      characters: Array<(typeof fixtureDatabase.characters)[number] & { triggerscript?: unknown }>
      formatingOrder: string[]
    }
    if (formatOrder) db.formatingOrder = formatOrder
    db.characters[0].triggerscript = [
      { comment: '', type: 'input', conditions: [], effect: [{ type: 'triggerlua', code }] },
    ]
    return db
  }

  async function sendBase(assertion: string): Promise<PromptChatFrame[]> {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    return parseEvents(res.body)
  }

  // Read persisted chat messages via hydration; bootstrap ships message-free stubs.
  async function persistedMessages(
    assertion: string,
    chatId = 'chat-1',
  ): Promise<Array<{ role: string; data: string; chatId: string; [k: string]: unknown }>> {
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/projection/chatMessages?id=${encodeURIComponent(chatId)}`,
      headers: { 'risu-auth': assertion },
    })
    expect(res.statusCode).toBe(200)
    return res.json().message
  }

  // Preserved reroll candidates surfaced on the hydration endpoint.
  async function persistedAlternates(
    assertion: string,
    chatId = 'chat-1',
  ): Promise<Array<{ role: string; data: string; chatId: string; [k: string]: unknown }>> {
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/projection/chatMessages?id=${encodeURIComponent(chatId)}`,
      headers: { 'risu-auth': assertion },
    })
    expect(res.statusCode).toBe(200)
    return res.json().alternates
  }

  async function bootstrapChat(assertion: string): Promise<{
    message: Array<{ role: string; data: string }>
    scriptstate?: Record<string, unknown>
  }> {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(res.statusCode).toBe(200)
    // Chat metadata (incl. scriptstate) comes from the stub bootstrap; message[]
    // is hydrated separately.
    const chat = res.json().database.characters[0].chats[0]
    return { ...chat, message: await persistedMessages(assertion, chat.id) }
  }

  it('runs a Lua input trigger that rewrites the transcript + persists it (slice 3b-4)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    // `onInput` fires only during the submit-time input-trigger run (the start
    // trigger leaves `triggerlua` a no-op). It appends a char row to the
    // transcript (before the user message) and writes a chat var.
    await seedDatabase(
      harness.app,
      assertion,
      dbWithSubmitLua(`
        function onInput(triggerId)
          addChat(triggerId, 'char', 'INPUT-LUA-ROW')
          setState(triggerId, 'inputseen', 1)
        end
      `),
    )

    resetChatMessageDiffInstrumentation()
    const events = await sendBase(assertion)
    expect(getChatMessageDiffInstrumentation()).toMatchObject({
      stableEqualCalls: 0,
      stableEqualStringifies: 0,
      appendFastPathRows: 2,
    })

    // Assembled prompt: the input trigger's char row renders in the `chats` slot.
    const prompt = events.find((e) => e.type === 'prompt')!
    const messages = prompt.data.messages as Array<{ role: string; content: string }>
    expect(messages.some((m) => m.content === 'INPUT-LUA-ROW')).toBe(true)

    // Route owns the post-input-trigger transcript write: the persisted chat has
    // the added char row followed by the user message.
    const chat = await bootstrapChat(assertion)
    expect(chat.message.map((m) => ({ role: m.role, data: m.data }))).toEqual([
      { role: 'char', data: 'INPUT-LUA-ROW' },
      { role: 'user', data: 'hi' },
    ])
    // The trigger's `setState` write rode the same chat-var delta + revision bump.
    expect(chat.scriptstate).toEqual({ $__inputseen: '1' })
    const info = events.find((e) => e.type === 'info')
    expect(info?.data.revision).toBe(2)
  })

  it('runs a Lua editinput hook that rewrites the submitted user message (slice 3b-4)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    // `editInput` listeners transform the user text string. Render `lastChat` so
    // the rewritten user row also shows up in the assembled prompt.
    await seedDatabase(
      harness.app,
      assertion,
      dbWithSubmitLua(
        `
        listenEdit('editInput', function(id, data, meta)
          return data .. ' [EDITINPUT]'
        end)
      `,
        ['main', 'description', 'chats', 'lastChat'],
      ),
    )

    const events = await sendBase(assertion)

    // Assembled prompt: the transformed user message renders (lastChat slot).
    const prompt = events.find((e) => e.type === 'prompt')!
    const messages = prompt.data.messages as Array<{ role: string; content: string }>
    expect(messages.some((m) => m.content === 'hi [EDITINPUT]')).toBe(true)
    expect(messages.some((m) => m.content === 'hi')).toBe(false)

    // The message_patch carries the editinput replace_all and the persisted
    // transcript reflects the post-editinput rewrite.
    const patch = events.find((e) => e.type === 'message_patch')?.data.patch as {
      messageMutations?: Array<{
        type: string
        source: string
        messages?: Array<{ role: string; data: string }>
      }>
    }
    const editinputMutation = patch.messageMutations?.find((m) => m.source === 'editinput')
    expect(editinputMutation?.type).toBe('replace_all')
    expect(editinputMutation?.messages?.at(-1)).toMatchObject({
      role: 'user',
      data: 'hi [EDITINPUT]',
    })

    const chat = await bootstrapChat(assertion)
    expect(chat.message.map((m) => ({ role: m.role, data: m.data }))).toEqual([
      { role: 'user', data: 'hi [EDITINPUT]' },
    ])
  })

  it('M1: no-var editinput transcript persistence emits a composite assembly event', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(
      harness.app,
      assertion,
      dbWithSubmitLua(
        `
        listenEdit('editInput', function(id, data, meta)
          return data .. ' [EDITINPUT]'
        end)
      `,
        ['main', 'description', 'chats', 'lastChat'],
      ),
    )

    await sendBase(assertion)

    const db = openDatabase(harness.dataDir)
    try {
      const event = listPersistedCommandEventHistory(db).find(
        (candidate) => candidate.type === 'generation.assemblyPersisted',
      )
      expect(event).toMatchObject({
        type: 'generation.assemblyPersisted',
        resource: 'generationAssembly',
        id: 'chat-1',
        parentId: 'char-1',
      })
    } finally {
      db.close()
    }
  })

  it('runs a regex editinput script that rewrites the submitted user message (slice 3b-4)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    // The regex `editinput` path (no Lua) is already at parity; the route now runs
    // it over the submitted user text and persists the result.
    const db = structuredClone(fixtureDatabase) as typeof fixtureDatabase & {
      characters: Array<(typeof fixtureDatabase.characters)[number] & { customscript?: unknown }>
    }
    db.characters[0].customscript = [{ in: 'hi', out: 'HELLO', type: 'editinput', flag: '', ableFlag: false }]
    await seedDatabase(harness.app, assertion, db)

    await sendBase(assertion)

    const chat = await bootstrapChat(assertion)
    expect(chat.message.map((m) => ({ role: m.role, data: m.data }))).toEqual([{ role: 'user', data: 'HELLO' }])
  })

  it('runs the regex from the chat-selected prompt preset, including legacy regex aliases', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const db = structuredClone(fixtureDatabase) as typeof fixtureDatabase & {
      modelPresets: Array<Record<string, unknown>>
      modelPresetsId: number
      promptPresets: Array<Record<string, unknown>>
      promptPresetsId: number
      characters: Array<
        (typeof fixtureDatabase.characters)[number] & {
          chats: Array<(typeof fixtureDatabase.characters)[number]['chats'][number] & { generationSettings?: unknown }>
        }
      >
    }
    db.modelPresets = [
      {
        id: DEFAULT_TEST_MODEL_PRESET_ID,
        name: 'Default Model',
        maxContext: 100_000,
        maxResponse: 50,
      },
    ]
    db.modelPresetsId = 0
    db.promptPresets = [
      {
        id: 'global-prompt',
        name: 'Global Prompt',
        regex: [{ in: 'hi', out: 'GLOBAL', type: 'editinput', flag: '', ableFlag: false }],
      },
      {
        id: 'chat-prompt',
        name: 'Chat Prompt',
        regex: [{ in: 'hi', out: 'CHAT', type: 'editinput', flag: '', ableFlag: false }],
        presetRegex: [],
      },
    ]
    db.promptPresetsId = 0
    db.characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: DEFAULT_TEST_PERSONA_ID,
      modelPresetId: DEFAULT_TEST_MODEL_PRESET_ID,
      promptPresetId: 'chat-prompt',
      jailbreakToggle: false,
      sidebarToggles: {},
    }
    await seedDatabase(harness.app, assertion, db)

    await sendBase(assertion)

    const chat = await bootstrapChat(assertion)
    expect(chat.message.map((m) => ({ role: m.role, data: m.data }))).toEqual([{ role: 'user', data: 'CHAT' }])
  })

  it('L9/v4-L7: unsafe imported regex stops before provider dispatch and assistant persistence', async () => {
    let providerCalls = 0
    await restartHarness({
      dispatchProvider: () => {
        providerCalls++
        async function* source(): AsyncGenerator<CompletionStreamFrame> {
          yield { kind: 'token', content: 'should not dispatch' }
          yield { kind: 'done', finishReason: 'stop' }
        }
        return source()
      },
    })
    const { assertion } = await setupAuthedClient(harness.app)
    const db = structuredClone(fixtureDatabase) as typeof fixtureDatabase & {
      aiModel: string
      characters: Array<
        (typeof fixtureDatabase.characters)[number] & {
          globalLore?: unknown
          chats: Array<(typeof fixtureDatabase.characters)[number]['chats'][number]>
        }
      >
    }
    db.aiModel = 'echo_model'
    db.characters[0].globalLore = [
      {
        key: '/(a+)+$/',
        secondkey: '',
        insertorder: 100,
        comment: 'unsafe regex lore',
        content: 'Never dispatches.',
        mode: 'normal',
        alwaysActive: false,
        selective: false,
        useRegex: true,
      },
    ]
    db.characters[0].chats = [
      {
        ...db.characters[0].chats[0],
        message: [{ role: 'user', data: 'a'.repeat(32) + '!', chatId: 'seed-user' }] as never,
      },
    ]
    await seedDatabase(harness.app, assertion, db)

    const events = await sendBase(assertion)

    expect(events.map((e) => e.type)).toEqual(['stage', 'stage', 'stage', 'error', 'done'])
    expect(events.find((e) => e.type === 'prompt')).toBeUndefined()
    expect(events.find((e) => e.type === 'info')).toBeUndefined()
    expect(String(events.find((e) => e.type === 'error')?.data.error)).toMatch(
      /bounded regex rejected: lorebook useRegex key: complexity screen/,
    )
    expect(providerCalls).toBe(0)
    const persisted = await persistedMessages(assertion)
    expect(persisted.map((m) => ({ role: m.role, data: m.data }))).toEqual([
      { role: 'user', data: 'a'.repeat(32) + '!' },
    ])
  })

  it('L9/v4-L7: valid imported lorebook and customscript regexes preserve generation output', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const db = structuredClone(fixtureDatabase) as typeof fixtureDatabase & {
      aiModel: string
      echoMessage: string
      echoDelay: number
      characters: Array<
        (typeof fixtureDatabase.characters)[number] & {
          customscript?: unknown
          globalLore?: unknown
        }
      >
    }
    db.aiModel = 'echo_model'
    db.echoMessage = 'server echo reply'
    db.echoDelay = 0
    db.characters[0].customscript = [{ in: 'h(i)', out: 'H$1', type: 'editinput', flag: '', ableFlag: false }]
    db.characters[0].globalLore = [
      {
        key: '/^Hi$/i',
        secondkey: '',
        insertorder: 100,
        comment: 'valid regex lore',
        content: 'Bounded regex lore body.',
        mode: 'normal',
        alwaysActive: false,
        selective: false,
        useRegex: true,
      },
    ]
    await seedDatabase(harness.app, assertion, db)

    const events = await sendBase(assertion)

    const prompt = events.find((e) => e.type === 'prompt')!
    const activation = prompt.data.lorebookActivation as {
      actives?: Array<{ prompt: string; source: string }>
    }
    expect(activation.actives).toEqual([
      expect.objectContaining({
        prompt: 'Bounded regex lore body.',
        source: 'valid regex lore',
      }),
    ])
    expect(events.at(-2)).toEqual({ type: 'token', data: { content: 'server echo reply' } })
    expect(events.at(-1)?.data).toMatchObject({ result: 'server echo reply' })
    const persisted = await persistedMessages(assertion)
    expect(persisted.map((m) => ({ role: m.role, data: m.data }))).toEqual([
      { role: 'user', data: 'Hi' },
      { role: 'char', data: 'server echo reply' },
    ])
  })

  it('leaves a plain send transcript to the browser (no route message write) (slice 3b-4)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    // No input trigger / editinput → `submitTranscriptChanged` is false, so the
    // route writes no transcript (the browser persists the raw user row exactly
    // as before). The seeded empty transcript is therefore unchanged server-side.
    await seedDatabase(harness.app, assertion, fixtureDatabase)

    const events = await sendBase(assertion)

    // The browser-facing message_patch still carries the user-message append…
    const patch = events.find((e) => e.type === 'message_patch')?.data.patch as {
      messageMutations?: Array<{ source: string }>
    }
    expect(patch.messageMutations?.some((m) => m.source === 'user_message')).toBe(true)
    expect(patch.messageMutations?.some((m) => m.source === 'editinput' || m.source === 'input_trigger')).toBe(false)
    // …but the route persisted nothing (no revision bump, transcript untouched).
    const info = events.find((e) => e.type === 'info')
    expect(info?.data.revision).toBeUndefined()
    const chat = await bootstrapChat(assertion)
    expect(chat.message).toEqual([])
  })

  it('inlines server-owned inlay assets into the assembled prompt multimodals (slice 3a)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const bytes = Buffer.from('server-inlay-bytes')
    const upload = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { 'risu-auth': assertion, 'content-type': 'image/png' },
      payload: bytes,
    })
    expect(upload.statusCode).toBe(201)
    const assetId = upload.json().assetId as string
    await seedDatabase(harness.app, assertion, dbWithHistoryMessage(`look {{inlayeddata::${assetId}}}`))

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)

    const prompt = parseEvents(res.body).find((e) => e.type === 'prompt')!
    const formated = prompt.data.formated as Array<{
      role: string
      content: unknown
      multimodals?: unknown
    }>
    const userRow = formated.find(
      (row) => row.role === 'user' && typeof row.content === 'string' && row.content.includes('look'),
    )
    // `processInlays` resolved the id from the server asset store and pushed bytes…
    expect(userRow?.multimodals).toEqual([
      { type: 'image', base64: `data:image/png;base64,${bytes.toString('base64')}` },
    ])
    // …and stripped the marker from the row text.
    expect(userRow?.content).not.toContain(`{{inlayeddata::${assetId}}}`)
  })

  it('maps legacy request inlayAssetRefs to server-owned bytes without base64 payloads', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const bytes = Buffer.from('legacy-inlay-bytes')
    const upload = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { 'risu-auth': assertion, 'content-type': 'image/png' },
      payload: bytes,
    })
    expect(upload.statusCode).toBe(201)
    const assetId = upload.json().assetId as string
    await seedDatabase(harness.app, assertion, dbWithHistoryMessage('look {{inlayeddata::abc}}'))

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: {
        ...basePayload,
        inlayAssetRefs: [{ id: 'abc', assetId }],
      },
    })
    expect(res.statusCode).toBe(200)

    const prompt = parseEvents(res.body).find((e) => e.type === 'prompt')!
    const formated = prompt.data.formated as Array<{
      role: string
      content: unknown
      multimodals?: unknown
    }>
    const userRow = formated.find(
      (row) => row.role === 'user' && typeof row.content === 'string' && row.content.includes('look'),
    )
    expect(userRow?.multimodals).toEqual([
      { type: 'image', base64: `data:image/png;base64,${bytes.toString('base64')}` },
    ])
  })

  it('inlines a stored {{asset_prompt::}} asset into the prompt multimodals (slice 3a)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const assetBytes = Buffer.from('fixture-asset-bytes')
    const upload = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { 'risu-auth': assertion, 'content-type': 'image/png' },
      payload: assetBytes,
    })
    expect(upload.statusCode).toBe(201)
    const assetId = upload.json().assetId as string

    await seedDatabase(
      harness.app,
      assertion,
      dbWithHistoryMessage('show {{asset_prompt::hero}}', {
        additionalAssets: [['hero', assetId, '']],
      }),
    )

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)

    const prompt = parseEvents(res.body).find((e) => e.type === 'prompt')!
    const formated = prompt.data.formated as Array<{
      role: string
      content: unknown
      multimodals?: unknown
    }>
    const userRow = formated.find(
      (row) => row.role === 'user' && typeof row.content === 'string' && row.content.includes('show'),
    )
    // `processAssetPrompts` mapped the name → reference → store bytes, re-wrapped
    // as a png data URI (byte-parity with the browser's readImage path).
    expect(userRow?.multimodals).toEqual([
      { type: 'image', base64: `data:image/png;base64,${assetBytes.toString('base64')}` },
    ])
    expect(userRow?.content).not.toContain('{{asset_prompt::hero}}')
  })

  // `buildInlayViewInstruction` appends a static `system` row from `newGenData`
  // when `inlayViewScreen` is set. No request field is needed; the config is
  // already on the loaded character.
  function dbWithInlayView(view: 'emotion' | 'imggen', extra: Record<string, unknown>): unknown {
    const db = structuredClone(fixtureDatabase) as typeof fixtureDatabase & {
      characters: Array<Record<string, unknown>>
    }
    Object.assign(db.characters[0], { inlayViewScreen: true, viewScreen: view, ...extra })
    return db
  }

  it('emits the emotion view instruction with {{slot}} → emotionImages (slice 3c)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(
      harness.app,
      assertion,
      dbWithInlayView('emotion', {
        newGenData: {
          prompt: '',
          negative: '',
          instructions: '',
          emotionInstructions: 'Pick an emotion from: {{slot}}',
        },
        emotionImages: [
          ['happy', 'h.png'],
          ['sad', 's.png'],
        ],
      }),
    )

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    const prompt = parseEvents(res.body).find((e) => e.type === 'prompt')!
    const messages = prompt.data.messages as Array<{ role: string; content: string }>
    // The `{{slot}}` token was replaced by the comma-joined emotionImages names,
    // and the row rides as a system row (postEverything).
    expect(messages).toContainEqual({ role: 'system', content: 'Pick an emotion from: happy, sad' })
  })

  it('emits the imggen view instruction verbatim (slice 3c)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(
      harness.app,
      assertion,
      dbWithInlayView('imggen', {
        newGenData: {
          prompt: '',
          negative: '',
          instructions: 'Generate an image of the current scene.',
          emotionInstructions: '',
        },
      }),
    )

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    const prompt = parseEvents(res.body).find((e) => e.type === 'prompt')!
    const messages = prompt.data.messages as Array<{ role: string; content: string }>
    expect(messages).toContainEqual({
      role: 'system',
      content: 'Generate an image of the current scene.',
    })
  })

  // With `inlayViewScreen` unset, no instruction row is appended.
  it('omits the view instruction when inlayViewScreen is unset (slice 3c)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, fixtureDatabase)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    const prompt = parseEvents(res.body).find((e) => e.type === 'prompt')!
    const messages = prompt.data.messages as Array<{ role: string; content: string }>
    expect(messages.some((m) => m.content.includes('emotion') || m.content.includes('Generate an image'))).toBe(false)
  })

  it('emits stop-trigger mutations and restoration before the terminal error', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const db = structuredClone(fixtureDatabase) as typeof fixtureDatabase & {
      characters: Array<(typeof fixtureDatabase.characters)[number] & { triggerscript?: unknown }>
    }
    ;(db.characters[0].chats[0] as any).message = [{ role: 'user', data: 'before stop', chatId: 'msg-before-stop' }]
    ;(db.characters[0].chats[0] as any).scriptstate = { $score: '1' }
    db.characters[0].triggerscript = [
      {
        comment: '',
        type: 'start',
        conditions: [],
        effect: [
          { type: 'setvar', operator: '=', var: 'score', value: '9' },
          { type: 'impersonate', role: 'char', value: 'mutated before stop' },
          { type: 'stop' },
        ],
      },
    ]
    await seedDatabase(harness.app, assertion, db)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: { ...basePayload, clientCapabilities: { compactPromptEvent: true } },
    })
    expect(res.statusCode).toBe(200)

    const events = parseEvents(res.body)
    expect(events.map((e) => e.type)).toEqual(['stage', 'stage', 'stage', 'message_patch', 'error', 'done'])
    const patch = events[3].data.patch as {
      varChanged?: boolean
      chatVarMutations?: unknown[]
      messageMutations?: Array<{ type?: string; source?: string; firstChangedIndex?: number; messages?: unknown[] }>
    }
    expect(patch.varChanged).toBe(true)
    expect(patch.chatVarMutations).toEqual([{ key: '$score', before: '1', after: '9' }])
    expect(patch.messageMutations?.map((m) => [m.type, m.source])).toEqual([
      ['append', 'user_message'],
      ['replace_all', 'start_trigger'],
    ])
    expect(patch.messageMutations?.at(-1)).toMatchObject({
      firstChangedIndex: 2,
      messages: [{ role: 'char', data: 'mutated before stop' }],
    })
    expect(events[4]).toEqual({
      type: 'error',
      data: {
        error: 'Generation was stopped by a start trigger.',
        reason: 'trigger_stop',
        restoration: {
          chatId: 'chat-1',
          characterId: 'char-1',
          selectedCharID: 0,
          chatPage: 0,
          messages: [{ role: 'user', data: 'before stop', chatId: 'msg-before-stop' }],
          scriptstate: { $score: '1' },
        },
      },
    })
  })

  it('emits a context-window error when history cannot fit after trimming', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      maxContext: 1,
      maxResponse: 50,
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: { ...basePayload, clientCapabilities: { compactPromptEvent: true } },
    })
    expect(res.statusCode).toBe(200)

    const error = parseEvents(res.body).find((event) => event.type === 'error')
    expect(error?.data).toMatchObject({
      reason: 'history_context_overflow',
      error: expect.stringContaining(
        'Chat history could not fit within the model context window after trimming older messages',
      ),
    })
    expect(String(error?.data.error)).toContain('context limit 1')
  })

  it('emits a final prompt overflow error when pinned rows exceed the context window', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const db = dbWithEditRequestLua(`
      listenEdit('editRequest', function(id, data, meta)
        for i = 1, #data do
          if data[i].role == 'system' then
            data[i].content = data[i].content .. string.rep(' overflow', 2000)
            break
          end
        end
        return data
      end)
    `) as typeof fixtureDatabase & { maxContext: number; maxResponse: number }
    db.maxContext = 200
    db.maxResponse = 1
    await seedDatabase(harness.app, assertion, db)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: { ...basePayload, clientCapabilities: { compactPromptEvent: true } },
    })
    expect(res.statusCode).toBe(200)

    const error = parseEvents(res.body).find((event) => event.type === 'error')
    expect(error?.data).toMatchObject({
      reason: 'overflow',
      error: expect.stringContaining(
        'Prompt is too large for the model context window after trimming removable history',
      ),
    })
    expect(String(error?.data.error)).toContain('context limit 200')
  })

  it('keeps preview-mode assembly read-only even when triggers set variables', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const db = structuredClone(fixtureDatabase) as typeof fixtureDatabase & {
      characters: Array<(typeof fixtureDatabase.characters)[number] & { triggerscript?: unknown }>
    }
    db.characters[0].triggerscript = [
      {
        comment: '',
        type: 'start',
        conditions: [],
        effect: [{ type: 'setvar', operator: '=', var: 'score', value: '9' }],
      },
    ]
    await seedDatabase(harness.app, assertion, db)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: { chatId: 'chat-1', characterId: 'char-1', mode: 'preview' },
    })
    expect(res.statusCode).toBe(200)
    expect(parseEvents(res.body).find((e) => e.type === 'prompt')).toBeDefined()

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().database.characters[0].chats[0].scriptstate).toBeUndefined()
  })

  it('keeps preview-mode lorebook sticky writes read-only (L4)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const db = structuredClone(fixtureDatabase) as typeof fixtureDatabase & {
      characters: Array<
        (typeof fixtureDatabase.characters)[number] & {
          globalLore?: unknown[]
        }
      >
    }
    db.characters[0].globalLore = [
      {
        id: 'preview-lore-keep',
        key: 'cat',
        secondkey: '',
        insertorder: 100,
        comment: 'Preview sticky lore',
        content: '@@keep_activate_after_match\nPreview sticky lore.',
        mode: 'normal',
        alwaysActive: false,
        selective: false,
      },
    ]
    ;(db.characters[0].chats[0] as any).message = [
      { role: 'user', data: 'cat in preview transcript', chatId: 'preview-msg-1' },
    ]
    await seedDatabase(harness.app, assertion, db)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: { chatId: 'chat-1', characterId: 'char-1', mode: 'preview' },
    })
    expect(res.statusCode).toBe(200)
    const events = parseEvents(res.body)
    expect(events.find((e) => e.type === 'prompt')).toBeDefined()
    const patch = events.find((e) => e.type === 'message_patch')?.data.patch as
      | { chatVarMutations?: Array<{ key: string; before: unknown; after: unknown }> }
      | undefined
    expect(patch?.chatVarMutations).toEqual([{ key: '$__internal_ka_preview-lore-keep', before: null, after: 'true' }])

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().database.characters[0].chats[0].scriptstate).toBeUndefined()
  })

  it('does not persist when a non-active writer sends /chat (423 before the C-A1 write)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const db = structuredClone(fixtureDatabase) as typeof fixtureDatabase & {
      characters: Array<(typeof fixtureDatabase.characters)[number] & { triggerscript?: unknown }>
    }
    db.characters[0].triggerscript = [
      {
        comment: '',
        type: 'start',
        conditions: [],
        effect: [{ type: 'setvar', operator: '=', var: 'score', value: '9' }],
      },
    ]
    await seedDatabase(harness.app, assertion, db)

    // A first browser session claims the active-writer role via bootstrap.
    const claim = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-a' },
    })
    expect(claim.statusCode).toBe(200)
    expect(claim.json().revision).toBe(1)

    // A stale session's send is rejected by the active-writer guard before
    // assembly runs, so no chat-var write is persisted.
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-b' },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(423)
    expect(res.json()).toMatchObject({ error: 'active_writer_stale' })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion, 'risu-writer-session': 'writer-a' },
    })
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().database.characters[0].chats[0].scriptstate).toBeUndefined()
  })

  it('emits an SSE error (not a 400) when the character is unknown', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, fixtureDatabase)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: { ...basePayload, characterId: 'nope' },
    })
    expect(res.statusCode).toBe(200)
    const events = parseEvents(res.body)
    const error = events.find((e) => e.type === 'error')
    expect(error).toBeDefined()
    expect(String(error!.data.error)).toMatch(/character not found/)
    expect(events.find((e) => e.type === 'prompt')).toBeUndefined()
    // Telemetry rides only on the success path.
    expect(events.find((e) => e.type === 'info')).toBeUndefined()
    expect(events.at(-1)?.type).toBe('done')
  })

  it('emits an SSE error when no database is persisted', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    const events = parseEvents(res.body)
    const error = events.find((e) => e.type === 'error')
    expect(String(error!.data.error)).toMatch(/database not found/)
    expect(events.at(-1)?.type).toBe('done')
  })

  it('assembles a prompt for preview_prompt mode without userMessage', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, fixtureDatabase)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: { chatId: 'chat-1', characterId: 'char-1', mode: 'preview_prompt' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')
    const events = parseEvents(res.body)
    expect(events.find((e) => e.type === 'prompt')).toBeDefined()
  })

  it('streams provider tokens after prompt metadata through the chat SSE taxonomy', async () => {
    await restartHarness({
      dispatchProvider: ({ input, result, signal }) => {
        expect(input.mode).toBe('send')
        expect(result.prompt.messages?.length).toBeGreaterThan(0)
        expect(signal.aborted).toBe(false)
        async function* source(): AsyncGenerator<CompletionStreamFrame> {
          yield { kind: 'token', content: 'Hel' }
          yield { kind: 'token', content: 'lo' }
          yield { kind: 'done', finishReason: 'stop' }
        }
        return source()
      },
    })
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, fixtureDatabase)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)

    const events = parseEvents(res.body)
    expect(events.map((e) => e.type)).toEqual([
      'stage',
      'stage',
      'stage',
      'prompt',
      'message_patch',
      'stage',
      'info',
      'token',
      'token',
      'done',
    ])
    expect(events.at(-3)?.type).toBe('token')
    expect(events.at(-2)?.type).toBe('token')
    expect(events.at(-1)?.type).toBe('done')
    expect(events.at(-1)?.data).toMatchObject({ result: 'Hello' })
    expect(typeof events.at(-1)?.data.generationId).toBe('string')
  })

  it('lets an imported incomplete chat be configured and then sent through server generation', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await importRisuSaveDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      aiModel: 'echo_model',
      echoMessage: 'configured import reply',
      echoDelay: 0,
      modelPresets: [{ id: 'model-import', name: 'Import Model', aiModel: 'echo_model' }],
      promptPresets: [{ id: 'prompt-import', name: 'Import Prompt' }],
      modelPresetsId: 0,
      promptPresetsId: 0,
      personas: [
        {
          id: 'persona-import',
          name: 'Import Persona',
          icon: '',
          personaPrompt: '',
          note: '',
        },
      ],
      selectedPersona: 0,
      characters: [
        {
          ...fixtureDatabase.characters[0],
          chaId: 'char-import',
          chats: [
            {
              id: 'chat-import',
              message: [],
              note: '',
              name: 'Imported Chat',
              localLore: [],
            },
          ],
        },
      ],
    })

    const importedBootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(importedBootstrap.statusCode).toBe(200)
    expect(importedBootstrap.json().database.characters[0].chats[0].generationSettings).toBeUndefined()

    const blocked = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: {
        chatId: 'chat-import',
        characterId: 'char-import',
        mode: 'send',
        userMessage: 'hello imported chat',
      },
    })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().error).toBe('chat_generation_settings_incomplete')

    const configuredSettings = {
      configured: true,
      personaId: 'persona-import',
      modelPresetId: 'model-import',
      promptPresetId: 'prompt-import',
      jailbreakToggle: false,
      sidebarToggles: {},
    }
    const configured = await harness.app.inject({
      method: 'PUT',
      url: '/api/v1/commands/chats/chat-import/generation-settings',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        generationSettings: configuredSettings,
      },
    })
    expect(configured.statusCode).toBe(200)

    const sent = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: {
        chatId: 'chat-import',
        characterId: 'char-import',
        mode: 'send',
        userMessage: 'hello imported chat',
      },
    })
    expect(sent.statusCode).toBe(200)
    const events = parseEvents(sent.body)
    expect(events.find((event) => event.type === 'prompt')).toBeDefined()
    expect(events.find((event) => event.type === 'info')).toBeDefined()
    expect(events.at(-2)).toEqual({ type: 'token', data: { content: 'configured import reply' } })
    expect(doneFrame(events).postGeneration?.revision).toBe(configured.json().revision + 1)
    await expect(persistedMessages(assertion, 'chat-import')).resolves.toEqual([
      expect.objectContaining({ role: 'char', data: 'configured import reply' }),
    ])
  })

  it('uses the production server dispatcher for generating modes', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      aiModel: 'echo_model',
      echoMessage: 'server echo reply',
      echoDelay: 0,
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)

    const events = parseEvents(res.body)
    expect(events.map((e) => e.type)).toEqual([
      'stage',
      'stage',
      'stage',
      'prompt',
      'message_patch',
      'stage',
      'info',
      'token',
      'done',
    ])
    const info = events.find((e) => e.type === 'info')!
    expect(typeof info.data.generationId).toBe('string')
    expect(info.data.generationInfo).toMatchObject({
      model: 'echo_model',
      generationId: info.data.generationId,
      outputTokens: 50,
      maxContext: 100_000,
    })
    expect(events.at(-2)).toEqual({ type: 'token', data: { content: 'server echo reply' } })
    expect(events.at(-1)?.data).toMatchObject({
      result: 'server echo reply',
      generationId: info.data.generationId,
      generationInfo: {
        model: 'echo_model',
        generationId: info.data.generationId,
      },
    })
    // The inline path persists the assistant message server-side, so the `done`
    // frame carries the bumped revision and the chat shows the persisted reply.
    const done = events.at(-1)!.data as { postGeneration?: { revision?: number } }
    expect(done.postGeneration?.revision).toBe(2)

    const persisted = await persistedMessages(assertion)
    expect(persisted.at(-1)).toMatchObject({ role: 'char', data: 'server echo reply' })
  })

  // Server post-generation pass (output trigger + editoutput).
  //
  // After provider completion, the server runs the run-var pass, the `'output'`
  // trigger, and `editoutput` over the generated text. The chat-var delta is
  // persisted and surfaced, with final text / resend, on `done.postGeneration`.

  /** A server-dispatch echo db with char overrides. */
  function dbWithServerDispatch(charOverride: Record<string, unknown>): unknown {
    return {
      ...fixtureDatabase,
      aiModel: 'echo_model',
      echoMessage: 'server echo reply',
      echoDelay: 0,
      characters: [{ ...fixtureDatabase.characters[0], ...charOverride }],
    }
  }

  function doneFrame(events: PromptChatFrame[]): {
    result?: string
    postGeneration?: {
      finalText?: string
      revision?: number
      resendChat?: boolean
      agentPresetError?: {
        error: string
        message: string
        stepId?: string
      }
      messagePatch?: {
        varChanged?: boolean
        chatVarMutations?: Array<{ key: string; before: unknown; after: unknown }>
        messageMutations?: unknown[]
      }
    }
  } {
    const done = events.at(-1)
    expect(done?.type).toBe('done')
    return done!.data as ReturnType<typeof doneFrame>
  }

  it('persists an output-trigger scriptstate delta server-side and surfaces it on done (A2)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(
      harness.app,
      assertion,
      dbWithServerDispatch({
        triggerscript: [
          {
            comment: '',
            type: 'output',
            conditions: [],
            effect: [{ type: 'setvar', operator: '=', var: 'mood', value: 'happy' }],
          },
        ],
      }),
    )

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    const events = parseEvents(res.body)
    const done = doneFrame(events)

    // The output trigger's `setvar` rode the post-gen message_patch + bumped the
    // revision. The completion text is unchanged (no editoutput), so no finalText.
    expect(done.postGeneration?.messagePatch?.varChanged).toBe(true)
    expect(done.postGeneration?.messagePatch?.chatVarMutations).toEqual([
      { key: '$mood', before: null, after: 'happy' },
    ])
    expect(done.postGeneration?.finalText).toBeUndefined()
    // Assembly had no chat-var write (no start trigger), so info.revision is unset;
    // the post-gen write is the first persist → revision 1 → 2.
    expect(events.find((e) => e.type === 'info')?.data.revision).toBeUndefined()
    expect(done.postGeneration?.revision).toBe(2)

    // Durable: bootstrap shows the post-gen scriptstate write + bumped revision.
    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    expect(bootstrap.json().revision).toBe(2)
    expect(bootstrap.json().database.characters[0].chats[0].scriptstate).toEqual({ $mood: 'happy' })
  })

  it('notifies the push service after durable post-generation persistence', async () => {
    const sendChatCompletionNotification = vi.fn(async () => {})
    await restartHarness({
      pushNotifications: {
        publicKey: () => 'test-public-key',
        upsertSubscription: vi.fn(),
        deleteSubscription: vi.fn(),
        sendChatCompletionNotification,
      },
    })
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, dbWithServerDispatch({}))

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: { ...basePayload, durable: true },
    })
    expect(res.statusCode).toBe(200)
    expect(doneFrame(parseEvents(res.body)).postGeneration?.revision).toBe(2)
    expect(sendChatCompletionNotification).toHaveBeenCalledWith({ characterId: 'char-1', chatId: 'chat-1' })
  })

  it('surfaces low-level output-trigger resend on done without a post-generation patch (A-16)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(
      harness.app,
      assertion,
      dbWithServerDispatch({
        lowLevelAccess: true,
        triggerscript: [
          {
            comment: '',
            type: 'output',
            conditions: [],
            effect: [{ type: 'sendAIprompt' }],
          },
        ],
      }),
    )

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    const events = parseEvents(res.body)
    const done = doneFrame(events)

    expect(done.postGeneration?.resendChat).toBe(true)
    expect(done.postGeneration?.messagePatch).toBeUndefined()
    expect(done.postGeneration?.finalText).toBeUndefined()
    expect(done.postGeneration?.revision).toBe(2)
  })

  it('H1: durable DELETE cancel uses abort terminal path without post-generation', async () => {
    let providerSawAbort = false
    await restartHarness({
      dispatchProvider: ({ signal }) => {
        async function* source(): AsyncGenerator<CompletionStreamFrame> {
          yield { kind: 'token', content: 'partial reply' }
          await new Promise<void>((resolve) => {
            if (signal.aborted) {
              providerSawAbort = true
              resolve()
              return
            }
            signal.addEventListener(
              'abort',
              () => {
                providerSawAbort = true
                resolve()
              },
              { once: true },
            )
          })
          if (signal.aborted) return
          yield { kind: 'done', finishReason: 'stop' }
        }
        return source()
      },
    })
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...(dbWithServerDispatch({
        triggerscript: [
          {
            comment: '',
            type: 'output',
            conditions: [],
            effect: [{ type: 'setvar', operator: '=', var: 'mood', value: 'cancelled' }],
          },
        ],
      }) as Record<string, unknown>),
      ttsAutoSpeech: true,
    })
    const baseUrl = await listenHarness()
    const submitController = new AbortController()
    let observerController: AbortController | undefined

    try {
      const res = await fetch(`${baseUrl}/api/v1/generate/chat`, {
        method: 'POST',
        headers: authHeaders(assertion, { 'content-type': 'application/json' }),
        body: JSON.stringify({ ...basePayload, durable: true }),
        signal: submitController.signal,
      })
      expect(res.status).toBe(200)

      let jobId = ''
      const initialEvents = await readStreamingEvents(res, (event) => {
        if (event.type === 'job_accepted') jobId = String(event.data.jobId)
        return event.type === 'token'
      })
      expect(jobId).not.toBe('')
      expect(initialEvents.some((event) => event.type === 'token')).toBe(true)

      observerController = new AbortController()
      const observer = await fetch(`${baseUrl}/api/v1/generate/chat/${encodeURIComponent(jobId)}/stream`, {
        headers: authHeaders(assertion),
        signal: observerController.signal,
      })
      expect(observer.status).toBe(200)
      const observerEventsPromise = readStreamingEvents(observer, (event) => event.type === 'done')

      const del = await fetch(`${baseUrl}/api/v1/generate/chat/${encodeURIComponent(jobId)}`, {
        method: 'DELETE',
        headers: authHeaders(assertion),
      })
      expect(del.status).toBe(200)
      expect(await del.json()).toEqual({ success: true })

      const observerEvents = await observerEventsPromise
      const doneFrames = observerEvents.filter((event) => event.type === 'done')
      expect(doneFrames).toHaveLength(1)
      expect(doneFrames[0]?.data.result).toBe('partial reply')
      expect(Object.hasOwn(doneFrames[0]!.data, 'postGeneration')).toBe(false)
      expect(observerEvents.some((event) => event.type === 'side_effect')).toBe(false)
      expect(providerSawAbort).toBe(true)

      const bootstrap = await harness.app.inject({
        method: 'GET',
        url: '/api/v1/bootstrap',
        headers: { 'risu-auth': assertion },
      })
      expect(bootstrap.statusCode).toBe(200)
      expect(bootstrap.json().database.characters[0].chats[0].scriptstate).toBeUndefined()
    } finally {
      submitController.abort()
      observerController?.abort()
    }
  }, 8000)

  it('K1: chat-variable generation finalization keeps broad writes and reports truthful metrics', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(
      harness.app,
      assertion,
      dbWithServerDispatch({
        triggerscript: [
          {
            comment: '',
            type: 'output',
            conditions: [],
            effect: [{ type: 'setvar', operator: '=', var: 'mood', value: 'happy' }],
          },
        ],
      }),
    )

    await withProtocolMetrics(async (metrics) => {
      const before = metrics.length
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/chat',
        headers: { 'risu-auth': assertion },
        payload: basePayload,
      })
      expect(res.statusCode).toBe(200)
      const done = doneFrame(parseEvents(res.body))
      expect(done.postGeneration?.messagePatch?.chatVarMutations).toEqual([
        { key: '$mood', before: null, after: 'happy' },
      ])
      expect(done.postGeneration?.revision).toBe(2)

      const commandMetric = metrics
        .slice(before)
        .find((entry) => entry.metric === 'command_mutation' && entry.type === 'generation.persisted')
      expect(commandMetric).toMatchObject({
        mutationPath: 'targeted-generation',
        dbJsonWriteMs: 0,
        writtenTables: [...BROAD_WRITE_TABLES, 'messages'].sort(),
      })
      expect(commandMetric?.loadMs).toBeGreaterThanOrEqual(0)
      expect(commandMetric?.totalMs).toBeGreaterThanOrEqual(0)
    })

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    expect(bootstrap.json().database.characters[0].chats[0].scriptstate).toEqual({ $mood: 'happy' })
  })

  it('runs the pre-trigger run-var pass server-side over the completion text (A2)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    // The echo completion carries a `{{setvar}}` the run-var pass evaluates + strips,
    // mirroring `applyOutputTrigger`'s pre-trigger run-var pass over the new turn.
    await seedDatabase(harness.app, assertion, {
      ...(dbWithServerDispatch({}) as Record<string, unknown>),
      echoMessage: 'reply {{setvar::seen::1}}done',
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    const done = doneFrame(parseEvents(res.body))

    // The run-var pass stripped the `{{setvar}}` from the final text and persisted
    // the chat-var write.
    expect(done.postGeneration?.finalText).toBe('reply done')
    expect(done.postGeneration?.messagePatch?.chatVarMutations).toEqual([{ key: '$seen', before: null, after: '1' }])
    expect(done.postGeneration?.revision).toBe(2)

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.json().database.characters[0].chats[0].scriptstate).toEqual({ $seen: '1' })
  })

  it('runs a regex editoutput script server-side: the final text reflects the transform (A2)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(
      harness.app,
      assertion,
      dbWithServerDispatch({
        customscript: [{ comment: '', in: 'reply', out: 'REPLY', type: 'editoutput', flag: '', ableFlag: false }],
      }),
    )

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    const events = parseEvents(res.body)
    const done = doneFrame(events)

    // The raw streamed text is unchanged; server-owned `editoutput` rides on
    // `finalText`. The inline path persists the transformed message server-side,
    // so the revision bumps and bootstrap shows the editoutput-applied text.
    // No chat-var write, so no messagePatch.
    expect(done.result).toBe('server echo reply')
    expect(done.postGeneration?.finalText).toBe('server echo REPLY')
    expect(done.postGeneration?.revision).toBe(2)
    expect(done.postGeneration?.messagePatch).toBeUndefined()

    const persisted = await persistedMessages(assertion)
    expect(persisted.at(-1)).toMatchObject({ role: 'char', data: 'server echo REPLY' })
  })

  it('runs after-main Agent Preset modifiers before persisting the assistant row', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...(dbWithServerDispatch({
        customscript: [{ comment: '', in: 'reply', out: 'REPLY', type: 'editoutput', flag: '', ableFlag: false }],
        chats: [
          {
            id: 'chat-1',
            message: [],
            note: '',
            name: 'Chat',
            localLore: [],
            generationSettings: {
              configured: true,
              personaId: DEFAULT_TEST_PERSONA_ID,
              modelPresetId: DEFAULT_TEST_MODEL_PRESET_ID,
              promptPresetId: DEFAULT_TEST_PROMPT_PRESET_ID,
              agentPresetId: 'ap_after',
              jailbreakToggle: false,
              sidebarToggles: {},
            },
          },
        ],
      }) as Record<string, unknown>),
      modelProfiles: [
        {
          id: 'debug-after',
          name: 'Debug After',
          providerId: 'debug-echo',
          modelId: 'debug-echo',
          providerOptions: {
            baseUrl: 'debug://agent-after',
            requestModel: 'agent-after-model',
          },
        },
      ],
      agentPresets: [
        {
          id: 'ap_after',
          name: 'After Agent',
          enabled: true,
          version: 1,
          steps: [
            {
              id: 'aps_before',
              name: 'Before Research',
              enabled: true,
              phase: 'beforeMain',
              dependencies: [],
              instruction: 'Research context for the response.',
              model: { mode: 'modelProfile', profileId: 'debug-after' },
              runtime: { maxInputChars: 2_000, maxOutputChars: 500, timeoutMs: 5_000 },
              inputScopes: [],
              outputKey: 'research',
              outputFormat: 'text',
              destination: 'intermediate',
              failurePolicy: { mode: 'required' },
            },
            {
              id: 'aps_after',
              name: 'After Rewrite',
              enabled: true,
              phase: 'afterMain',
              dependencies: [],
              instruction: 'Rewrite the final answer.',
              model: { mode: 'modelProfile', profileId: 'debug-after' },
              runtime: { maxInputChars: 2_000, maxOutputChars: 500, timeoutMs: 5_000 },
              inputScopes: ['mainDraft'],
              outputKey: 'rewrite',
              outputFormat: 'text',
              destination: 'finalOutput',
              failurePolicy: { mode: 'required' },
            },
          ],
        },
      ],
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    const events = parseEvents(res.body)
    const done = doneFrame(events)
    const agentProgress = events.filter((event) => event.type === 'agent_preset_progress')

    for (const phase of ['beforeMain', 'afterMain']) {
      const phaseProgress = agentProgress.filter((event) => event.data.phase === phase)
      expect(phaseProgress[0]?.data).toMatchObject({
        chatId: 'chat-1',
        presetId: 'ap_after',
        presetName: 'After Agent',
        phase,
        status: 'started',
        completedSteps: 0,
        totalSteps: 1,
      })
      expect(phaseProgress).toContainEqual(
        expect.objectContaining({
          data: expect.objectContaining({
            phase,
            status: 'running',
            completedSteps: 0,
            activeSteps: [expect.objectContaining({ stepName: expect.any(String) })],
          }),
        }),
      )
      expect(phaseProgress.at(-1)?.data).toMatchObject({
        phase,
        status: 'finished',
        completedSteps: 1,
        totalSteps: 1,
        activeSteps: [],
      })
    }

    expect(done.result).toBe('server echo reply')
    expect(done.postGeneration?.finalText).toContain('"requestModel": "agent-after-model"')
    expect(done.postGeneration?.revision).toBe(2)

    const persisted = await persistedMessages(assertion)
    const assistant = persisted.at(-1)
    expect(assistant?.data).toContain('"requestModel": "agent-after-model"')
    const agentPresetInfo = assistant?.generationInfo as { agentPreset?: Record<string, unknown> } | undefined
    expect(agentPresetInfo?.agentPreset).toMatchObject({
      presetId: 'ap_after',
      finalTextModified: true,
      mainOutputPreview: 'server echo REPLY',
    })
  })

  it('hydrates projected module stubs from the server module table before assembly runtime', async () => {
    await seedDatabase(harness.app, 'unused', {
      ...fixtureDatabase,
      modules: [
        {
          id: 'gigatrans-lite',
          name: 'GigaTrans Lite',
          description: '',
          trigger: [{ id: 'module-output', type: 'output', conditions: [], effect: [] }],
          regex: [{ id: 'module-regex', comment: '', in: 'foo', out: 'bar', type: 'editoutput' }],
          lorebook: [{ id: 'module-lore', key: 'foo', comment: 'Module Lore', content: 'body' }],
          assets: [['label', 'asset-id', 'png']],
        },
      ],
    })

    const db = openDatabase(harness.dataDir)
    try {
      const projected = {
        modules: [{ id: 'gigatrans-lite', name: 'GigaTrans Lite', description: '' }],
      }
      hydrateAssemblyModuleBodies(db, projected)

      expect(projected.modules[0]).toMatchObject({
        id: 'gigatrans-lite',
        trigger: [{ id: 'module-output' }],
        regex: [{ id: 'module-regex' }],
        lorebook: [{ id: 'module-lore' }],
        assets: [['label', 'asset-id', 'png']],
      })
    } finally {
      db.close()
    }
  })

  it('runs a chat-attached module output triggerlua over the generated assistant row', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...(dbWithServerDispatch({
        chats: [
          {
            ...fixtureDatabase.characters[0].chats[0],
            modules: ['gigatrans-lite'],
          },
        ],
      }) as Record<string, unknown>),
      modules: [
        {
          id: 'gigatrans-lite',
          name: 'GigaTrans Lite',
          description: '',
          trigger: [
            {
              id: 'module-output',
              comment: '',
              type: 'output',
              conditions: [],
              effect: [
                {
                  type: 'triggerlua',
                  code: `
                    function onOutput(id)
                      local index = getChatLength(id) - 1
                      local last = getChat(id, index)
                      setChat(id, index, last.data .. ' [GT]')
                    end
                  `,
                },
              ],
            },
          ],
        },
      ],
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    const done = doneFrame(parseEvents(res.body))

    expect(done.result).toBe('server echo reply')
    expect(done.postGeneration?.finalText).toBe('server echo reply [GT]')
    expect(done.postGeneration?.revision).toBe(2)

    const persisted = await persistedMessages(assertion)
    expect(persisted.at(-1)).toMatchObject({ role: 'char', data: 'server echo reply [GT]' })
  })

  it('reports character-owned output Lua execution diagnostics', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const luaCode = `
      function onOutput(id)
        local index = getChatLength(id) - 1
        local last = getChat(id, index)
        setChat(id, index, last.data .. ' [CHAR]')
      end
    `
    await seedDatabase(
      harness.app,
      assertion,
      dbWithServerDispatch({
        triggerscript: [
          {
            id: 'character-output',
            comment: 'character output hook',
            type: 'output',
            conditions: [],
            effect: [{ type: 'triggerlua', code: luaCode }],
          },
        ],
      }),
    )

    await withProtocolMetrics(async (metrics, rawMetricLines) => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/chat',
        headers: { 'risu-auth': assertion },
        payload: basePayload,
      })
      expect(res.statusCode).toBe(200)
      const done = doneFrame(parseEvents(res.body))

      expect(done.result).toBe('server echo reply')
      expect(done.postGeneration?.finalText).toBe('server echo reply [CHAR]')

      const outputSelection = metrics.find(
        (entry) => entry.metric === 'generation_trigger_selection' && entry.mode === 'output',
      )
      expect(outputSelection).toMatchObject({
        triggerCount: 1,
        selectedTriggerCount: 1,
        triggerLuaEffectCount: 1,
        selectedTriggerLuaEffectCount: 1,
        characterTriggerCount: 1,
        selectedCharacterTriggerCount: 1,
        moduleTriggerCount: 0,
      })

      const ownerMetric = (metric: string, mode: string): ProtocolMetric | undefined =>
        metrics.find(
          (entry) =>
            entry.metric === metric &&
            entry.mode === mode &&
            (entry as unknown as Record<string, unknown>).ownerType === 'character',
        )
      const runtime = ownerMetric('generation_lua_runtime', 'output') as Record<string, unknown> | undefined
      expect(runtime).toMatchObject({
        mode: 'output',
        ownerType: 'character',
        ownerId: 'char-1',
        ownerName: 'Tess',
        triggerId: 'character-output',
        triggerIndex: 0,
        triggerComment: 'character output hook',
        triggerType: 'output',
        effectIndex: 0,
        effectType: 'triggerlua',
        handlerRegistered: true,
        resultShape: 'null',
      })
      expect(typeof runtime?.codeSha256).toBe('string')
      expect(runtime?.codeBytes).toBeGreaterThan(0)

      const effect = ownerMetric('generation_trigger_lua_effect', 'output') as Record<string, unknown> | undefined
      expect(effect).toMatchObject({
        status: 'ok',
        mode: 'output',
        luaMode: 'output',
        ownerType: 'character',
        ownerId: 'char-1',
        ownerName: 'Tess',
        triggerId: 'character-output',
        triggerIndex: 0,
        triggerComment: 'character output hook',
        triggerType: 'output',
        effectIndex: 0,
        effectType: 'triggerlua',
        messageCountBefore: 2,
        messageCountAfter: 2,
        messageCountDelta: 0,
        transcriptChanged: true,
        lastMessageChanged: true,
        lastMessageRoleBefore: 'char',
        lastMessageRoleAfter: 'char',
      })
      expect(typeof effect?.codeSha256).toBe('string')
      expect(effect?.codeBytes).toBeGreaterThan(0)
      expect(typeof effect?.transcriptSha256Before).toBe('string')
      expect(typeof effect?.transcriptSha256After).toBe('string')
      expect(effect?.transcriptSha256Before).not.toBe(effect?.transcriptSha256After)
      expect(typeof effect?.lastMessageSha256Before).toBe('string')
      expect(typeof effect?.lastMessageSha256After).toBe('string')
      expect(effect?.lastMessageSha256Before).not.toBe(effect?.lastMessageSha256After)

      const rawMetrics = rawMetricLines.join('\n')
      expect(rawMetrics).not.toContain('function onOutput')
      expect(rawMetrics).not.toContain('server echo reply [CHAR]')
    })
  })

  it('writes post-generation Lua flow metrics and body sidecar for editOutput/onOutput', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const luaCode = `
      listenEdit('editOutput', function(id, data, meta)
        log('editOutput sees: ' .. data)
        local ok, blocked = pcall(function()
          return LLM(id, {{ role = 'user', content = 'blocked prompt' }}, false)
        end)
        if ok and blocked ~= nil then
          return data .. ' [UNEXPECTED-LLM]'
        end
        return data .. ' [EDIT]'
      end)

      onOutput = async(function(id)
        log('onOutput start')
        local index = getChatLength(id) - 1
        local last = getChat(id, index)
        local result = axLLM(id, {{ role = 'user', content = 'aux prompt' }}, false)
        local aux = 'missing'
        if result and result.success then
          aux = result.result
        end
        setChat(id, index, last.data .. ' [OUT:' .. aux .. ']')
      end)
    `
    await seedDatabase(harness.app, assertion, {
      ...(dbWithServerDispatch({
        lowLevelAccess: true,
        triggerscript: [
          {
            id: 'character-postgen-trace',
            comment: 'post-generation trace hook',
            type: 'output',
            conditions: [],
            effect: [{ type: 'triggerlua', code: luaCode }],
          },
        ],
      }) as Record<string, unknown>),
      modelRoles: { scriptAux: 'echo_model' },
    })

    await withProtocolMetrics(async (metrics, rawMetricLines) => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      let res: Awaited<ReturnType<typeof harness.app.inject>>
      try {
        res = await harness.app.inject({
          method: 'POST',
          url: '/api/v1/generate/chat',
          headers: { 'risu-auth': assertion },
          payload: basePayload,
        })
      } finally {
        logSpy.mockRestore()
      }
      expect(res.statusCode).toBe(200)
      const done = doneFrame(parseEvents(res.body))
      expect(done.postGeneration?.finalText).toBe('server echo reply [EDIT] [OUT:server echo reply]')

      const metric = metrics.find((entry) => entry.metric === 'generation_lua_post_generation_trace')
      expect(metric).toMatchObject({
        status: 'ok',
        chatId: 'chat-1',
        characterId: 'char-1',
        mode: 'send',
        durable: false,
        runCount: 2,
        hostEventCount: 5,
        logCount: 2,
        llmAttemptCount: 1,
        llmBlockedCount: 1,
        axLlmAttemptCount: 1,
        axLlmCompletedCount: 1,
        setChatCount: 1,
        setChatChangedCount: 1,
        transcriptChanged: true,
        editOutputTextChanged: true,
      })
      expect(metric?.runs?.map((run) => run.phase)).toEqual(['editOutput', 'onOutput'])
      expect(metric?.runs?.[0]).toMatchObject({
        phase: 'editOutput',
        llmAttemptCount: 1,
        llmBlockedCount: 1,
        editOutputTextChanged: true,
        transcriptChanged: false,
      })
      expect(metric?.runs?.[1]).toMatchObject({
        phase: 'onOutput',
        axLlmAttemptCount: 1,
        axLlmCompletedCount: 1,
        setChatCount: 1,
        setChatChangedCount: 1,
        transcriptChanged: true,
      })

      const sidecar = readGenerationSidecar(harness.dataDir, metric?.bodySidecar) as {
        runs: Array<{
          phase: string
          editOutputTextBefore?: string
          editOutputTextAfter?: string
          chatBefore: Array<{ role: string; body: string }>
          chatAfter: Array<{ role: string; body: string }>
          hostEvents: Array<Record<string, unknown>>
        }>
      }
      expect(sidecar.runs[0]).toMatchObject({
        phase: 'editOutput',
        editOutputTextBefore: 'server echo reply',
        editOutputTextAfter: 'server echo reply [EDIT]',
      })
      expect(sidecar.runs[0].hostEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'log', fn: 'log', value: 'editOutput sees: server echo reply' }),
          expect.objectContaining({ type: 'llm', fn: 'LLM', status: 'blocked' }),
        ]),
      )
      expect(sidecar.runs[1].chatBefore.at(-1)).toMatchObject({
        role: 'char',
        body: 'server echo reply [EDIT]',
      })
      expect(sidecar.runs[1].chatAfter.at(-1)).toMatchObject({
        role: 'char',
        body: 'server echo reply [EDIT] [OUT:server echo reply]',
      })
      expect(sidecar.runs[1].hostEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'log', fn: 'log', value: 'onOutput start' }),
          expect.objectContaining({ type: 'llm', fn: 'axLLM', status: 'completed', success: true }),
          expect.objectContaining({ type: 'chat', fn: 'setChat', status: 'changed' }),
        ]),
      )

      const rawMetrics = rawMetricLines.join('\n')
      expect(rawMetrics).not.toContain('server echo reply [EDIT] [OUT:server echo reply]')
      expect(rawMetrics).not.toContain('blocked prompt')
      expect(rawMetrics).not.toContain('function(id, data, meta)')
    })
  })

  it('lets chat-attached module output Lua read module lorebooks before axLLM translation', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const legacyCharacter = {
      ...fixtureDatabase.characters[0],
      chats: [
        {
          ...fixtureDatabase.characters[0].chats[0],
          modules: ['gigatrans-lite'],
        },
      ],
    } as Record<string, unknown>
    delete legacyCharacter.type

    await seedDatabase(harness.app, assertion, {
      ...(dbWithServerDispatch({}) as Record<string, unknown>),
      characters: [legacyCharacter],
      modelRoles: { scriptAux: 'echo_model' },
      modules: [
        {
          id: 'gigatrans-lite',
          name: 'GigaTrans Lite',
          description: '',
          lowLevelAccess: true,
          lorebook: [
            {
              comment: 'translation-preset',
              key: '',
              secondkey: '',
              mode: 'normal',
              insertorder: 100,
              alwaysActive: false,
              selective: false,
              content: 'preset body',
            },
          ],
          trigger: [
            {
              id: 'module-output',
              comment: '',
              type: 'output',
              conditions: [],
              effect: [
                {
                  type: 'triggerlua',
                  code: `
                    onOutput = async(function(id)
                      local index = getChatLength(id) - 1
                      local books = getLoreBooks(id, 'translation-preset')
                      if not books or #books == 0 then
                        setChat(id, index, 'missing preset')
                        return
                      end
                      local result = axLLM(id, {{ role = 'user', content = books[1].content }}, false)
                      if not result or not result.success then
                        setChat(id, index, 'llm failed: ' .. tostring(result and result.result))
                        return
                      end
                      setChat(id, index, books[1].content .. ' -> ' .. result.result)
                    end)
                  `,
                },
              ],
            },
          ],
        },
      ],
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    const done = doneFrame(parseEvents(res.body))

    expect(done.result).toBe('server echo reply')
    expect(done.postGeneration?.finalText).toBe('preset body -> server echo reply')
    expect(done.postGeneration?.revision).toBe(2)

    const persisted = await persistedMessages(assertion)
    expect(persisted.at(-1)).toMatchObject({ role: 'char', data: 'preset body -> server echo reply' })
  })

  // The inline continue / regenerate paths are server-persisted too; the browser
  // issues zero generation-result commands.
  function seedChatWithMessages(
    assertion: string,
    messages: Array<Record<string, unknown>>,
    echoMessage: string,
  ): Promise<number> {
    return seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      aiModel: 'echo_model',
      echoMessage,
      echoDelay: 0,
      characters: [
        {
          ...fixtureDatabase.characters[0],
          chats: [{ id: 'chat-1', message: messages, note: '', name: 'Chat', localLore: [] }],
        },
      ],
    })
  }

  it('persists a continue result server-side, extending the last row in place', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedChatWithMessages(
      assertion,
      [
        { role: 'user', data: 'tell me a story', chatId: 'msg-user-1' },
        { role: 'char', data: 'Once upon a time', chatId: 'msg-char-1', saying: 'char-1' },
      ],
      ' and they lived happily.',
    )

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: { chatId: 'chat-1', characterId: 'char-1', mode: 'continue' },
    })
    expect(res.statusCode).toBe(200)
    expect(doneFrame(parseEvents(res.body)).postGeneration?.revision).toBe(2)

    const persisted = await persistedMessages(assertion)
    // Extended the SAME assistant row (chatId preserved); no duplicate appended.
    expect(persisted).toHaveLength(2)
    expect(persisted[1].chatId).toBe('msg-char-1')
    expect(persisted[1].data).toContain('Once upon a time')
    expect(persisted[1].data).toContain('and they lived happily')
  })

  it('persists a regenerate result server-side, replacing the target message', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedChatWithMessages(
      assertion,
      [
        { role: 'user', data: 'greet me', chatId: 'msg-user-1' },
        { role: 'char', data: 'old reply', chatId: 'msg-char-1', saying: 'char-1' },
      ],
      'a brand new reply',
    )

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: {
        chatId: 'chat-1',
        characterId: 'char-1',
        mode: 'regenerate',
        regenerateMessageId: 'msg-char-1',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(doneFrame(parseEvents(res.body)).postGeneration?.revision).toBe(2)

    const persisted = await persistedMessages(assertion)
    // The old target was REPLACED (not duplicated): the char row carries the new
    // text under a fresh generation id, and the old reply is gone.
    expect(persisted).toHaveLength(2)
    expect(persisted[0]).toMatchObject({ role: 'user', chatId: 'msg-user-1' })
    expect(persisted[1].role).toBe('char')
    expect(persisted[1].data).toContain('a brand new reply')
    expect(persisted[1].chatId).not.toBe('msg-char-1')
    expect(persisted.some((m) => m.data === 'old reply')).toBe(false)
  })

  it('appends a regenerate result when the requested target was already truncated', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedChatWithMessages(
      assertion,
      [{ role: 'user', data: 'greet me', chatId: 'msg-user-1' }],
      'a brand new reply',
    )

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: {
        chatId: 'chat-1',
        characterId: 'char-1',
        mode: 'regenerate',
        regenerateMessageId: 'stale-msg-char-1',
      },
    })
    expect(res.statusCode).toBe(200)
    const done = doneFrame(parseEvents(res.body))
    expect(done.postGeneration?.revision).toBe(2)

    const persisted = await persistedMessages(assertion)
    expect(persisted).toHaveLength(2)
    expect(persisted[0]).toMatchObject({ role: 'user', chatId: 'msg-user-1' })
    expect(persisted[1]).toMatchObject({ role: 'char', data: 'a brand new reply' })
    expect(persisted[1].chatId).not.toBe('stale-msg-char-1')
    expect(await persistedAlternates(assertion)).toHaveLength(0)
  })

  // The reroll buffer preserves both the replaced candidate and the new one as
  // alternates, accumulates further regenerates by uid, and clears on send.
  it('preserves both the replaced and the new candidate as alternates, accumulates, and clears on send (Phase 6c)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedChatWithMessages(
      assertion,
      [
        { role: 'user', data: 'greet me', chatId: 'msg-user-1' },
        { role: 'char', data: 'old reply', chatId: 'msg-char-1', saying: 'char-1' },
      ],
      'a brand new reply',
    )

    const regenerate = (targetId: string): Promise<{ statusCode: number }> =>
      harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/chat',
        headers: { 'risu-auth': assertion },
        payload: {
          chatId: 'chat-1',
          characterId: 'char-1',
          mode: 'regenerate',
          regenerateMessageId: targetId,
        },
      })

    // First regenerate: the displaced "old reply" AND the new active "a brand new
    // reply" are both preserved — swiping away from the new candidate must survive.
    expect((await regenerate('msg-char-1')).statusCode).toBe(200)
    let active = await persistedMessages(assertion)
    expect(active.at(-1)!.data).toContain('a brand new reply')
    let alternates = await persistedAlternates(assertion)
    expect(alternates).toHaveLength(2)
    expect(alternates.some((m) => m.data === 'old reply')).toBe(true)
    expect(alternates.some((m) => m.data.includes('a brand new reply'))).toBe(true)

    // Second regenerate (target = the now-active candidate): candidates accumulate —
    // the previously-active one is already buffered (deduped), the new one is added.
    expect((await regenerate(active.at(-1)!.chatId)).statusCode).toBe(200)
    alternates = await persistedAlternates(assertion)
    expect(alternates).toHaveLength(3)
    expect(alternates.filter((m) => m.data === 'old reply')).toHaveLength(1)
    expect(alternates.filter((m) => m.data.includes('a brand new reply'))).toHaveLength(2)
    // The active transcript stays a single char row (no duplication).
    active = await persistedMessages(assertion)
    expect(active.filter((m) => m.role === 'char')).toHaveLength(1)

    // A send confirms the turn → the reroll buffer is dropped.
    const send = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: { chatId: 'chat-1', characterId: 'char-1', mode: 'send', userMessage: 'again' },
    })
    expect(send.statusCode).toBe(200)
    expect(await persistedAlternates(assertion)).toHaveLength(0)
  })

  it('runs a Lua editOutput hook server-side over the completion (A2 / slice 3b VM)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(
      harness.app,
      assertion,
      dbWithServerDispatch({
        triggerscript: [
          {
            comment: '',
            type: 'output',
            conditions: [],
            effect: [
              {
                type: 'triggerlua',
                code: `
                  listenEdit('editOutput', function(id, data, meta)
                    return data .. ' [LUA-OUT]'
                  end)
                `,
              },
            ],
          },
        ],
      }),
    )

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    const done = doneFrame(parseEvents(res.body))
    // The Lua `editOutput` listener ran on the server VM over the completion text.
    expect(done.postGeneration?.finalText).toBe('server echo reply [LUA-OUT]')
  })

  it('warns and persists raw provider text when server Lua editOutput fails', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(
      harness.app,
      assertion,
      dbWithServerDispatch({
        triggerscript: [
          {
            comment: '',
            type: 'output',
            conditions: [],
            effect: [
              {
                type: 'triggerlua',
                code: `
                  listenEdit('editOutput', function(id, data, meta)
                    error('lua edit output failed')
                  end)
                `,
              },
            ],
          },
        ],
      }),
    )

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    const events = parseEvents(res.body)
    expect(events.find((event) => event.type === 'warning')?.data).toMatchObject({
      message: 'server post-generation derivation failed; persisted the raw provider text.',
    })
    const done = doneFrame(events)
    expect(done.postGeneration?.revision).toBe(2)
    expect(done.postGeneration?.finalText).toBeUndefined()

    const persisted = await persistedMessages(assertion)
    expect(persisted.at(-1)).toMatchObject({ role: 'char', data: 'server echo reply' })
  })

  it('emits a metadata-only raw fallback metric when Lua onOutput fails', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(
      harness.app,
      assertion,
      dbWithServerDispatch({
        triggerscript: [
          {
            comment: '',
            type: 'output',
            conditions: [],
            effect: [
              {
                type: 'triggerlua',
                code: `
                  function onOutput(triggerId)
                    error('lua output trigger failed hard')
                  end
                `,
              },
            ],
          },
        ],
      }),
    )

    await withProtocolMetrics(async (metrics) => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/chat',
        headers: { 'risu-auth': assertion },
        payload: basePayload,
      })
      expect(res.statusCode).toBe(200)
      const events = parseEvents(res.body)
      expect(events.find((event) => event.type === 'warning')?.data).toMatchObject({
        message: 'server post-generation derivation failed; persisted the raw provider text.',
      })

      const fallback = metrics.find((entry) => entry.metric === 'generation_post_generation_fallback')
      expect(fallback).toMatchObject({
        fallbackType: 'raw_provider_text',
        chatId: 'chat-1',
        characterId: 'char-1',
        mode: 'send',
        targetSnapshotKind: 'tail',
        targetSnapshotTranscriptLength: 0,
        completionLength: 'server echo reply'.length,
        completionBytes: Buffer.byteLength('server echo reply', 'utf8'),
        completionSha256: createHash('sha256').update('server echo reply', 'utf8').digest('hex'),
        source: 'lua_output_trigger',
      })
      expect(typeof fallback?.generationId).toBe('string')
      expect(String(fallback?.error)).toContain('Lua output trigger failed')
      expect(JSON.stringify(fallback)).not.toContain('server echo reply')
      expect(Object.hasOwn(fallback ?? {}, 'completionText')).toBe(false)
      expect(Object.hasOwn(fallback ?? {}, 'promptInfo')).toBe(false)
      expect(Object.hasOwn(fallback ?? {}, 'userMessage')).toBe(false)
    })
  })

  it('attributes module onOutput Lua fallback metrics without logging code or completion text', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const leakedCompletion = 'server echo reply'
    await seedDatabase(harness.app, assertion, {
      ...(dbWithServerDispatch({}) as Record<string, unknown>),
      enabledModules: ['mod-output-lua'],
      modules: [
        {
          id: 'mod-output-lua',
          name: 'Output Lua Module',
          description: '',
          lowLevelAccess: true,
          trigger: [
            {
              comment: 'module output hook',
              type: 'output',
              conditions: [],
              effect: [
                {
                  type: 'triggerlua',
                  code: `
                    function onOutput(triggerId)
                      local lastMessage = getChat(triggerId, -1)
                      error(lastMessage.data)
                    end
                  `,
                },
              ],
            },
          ],
        },
      ],
    })

    await withProtocolMetrics(async (metrics, rawMetricLines) => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/chat',
        headers: { 'risu-auth': assertion },
        payload: basePayload,
      })
      expect(res.statusCode).toBe(200)
      const events = parseEvents(res.body)
      expect(events.find((event) => event.type === 'warning')?.data).toMatchObject({
        message: 'server post-generation derivation failed; persisted the raw provider text.',
      })

      const fallback = metrics.find((entry) => entry.metric === 'generation_post_generation_fallback')
      const fallbackFields = fallback as Record<string, unknown> | undefined
      expect(fallback).toMatchObject({
        fallbackType: 'raw_provider_text',
        chatId: 'chat-1',
        characterId: 'char-1',
        mode: 'send',
        source: 'lua_output_trigger',
        ownerType: 'module',
        ownerId: 'mod-output-lua',
        ownerName: 'Output Lua Module',
        triggerIndex: 0,
        triggerComment: 'module output hook',
        triggerType: 'output',
        effectIndex: 0,
        effectType: 'triggerlua',
        luaMode: 'output',
        luaLowLevelAccess: true,
      })
      expect(typeof fallbackFields?.luaCodeSha256).toBe('string')
      expect(fallbackFields?.luaCodeBytes).toBeGreaterThan(0)
      expect(String(fallback?.error)).toContain('Lua output trigger failed')
      expect(fallbackFields?.luaErrorKind).toBe('lua_error')
      expect(Object.hasOwn(fallback ?? {}, 'luaError')).toBe(false)
      expect(JSON.stringify(fallback)).not.toContain(leakedCompletion)
      expect(Object.hasOwn(fallback ?? {}, 'completionText')).toBe(false)
      expect(Object.hasOwn(fallback ?? {}, 'code')).toBe(false)
      expect(Object.hasOwn(fallback ?? {}, 'promptInfo')).toBe(false)

      const rawMetrics = rawMetricLines.join('\n')
      expect(rawMetrics).not.toContain(leakedCompletion)
      expect(rawMetrics).not.toContain('function onOutput')
      expect(rawMetrics).not.toContain('lastMessage.data')

      const runtime = metrics.find(
        (entry) =>
          entry.metric === 'generation_lua_runtime' &&
          entry.mode === 'output' &&
          (entry as unknown as Record<string, unknown>).ownerId === 'mod-output-lua',
      )
      expect(runtime).toMatchObject({
        mode: 'output',
        ownerType: 'module',
        ownerId: 'mod-output-lua',
        ownerName: 'Output Lua Module',
        triggerIndex: 0,
        triggerComment: 'module output hook',
        triggerType: 'output',
        effectIndex: 0,
        effectType: 'triggerlua',
        lowLevelAccess: true,
        errorKind: 'lua_error',
      })
      expect(Object.hasOwn(runtime ?? {}, 'error')).toBe(false)
      expect(JSON.stringify(runtime)).not.toContain(leakedCompletion)

      const persisted = await persistedMessages(assertion)
      expect(persisted.at(-1)).toMatchObject({ role: 'char', data: leakedCompletion })
    })
  })

  it.each([
    {
      label: 'NovelAI text',
      database: { aiModel: 'novelai' },
      error: 'unsupported /chat provider: NovelAI text generation must use local dispatch',
    },
    {
      label: 'NovelList',
      database: { aiModel: 'novellist' },
      error: 'unsupported /chat provider: NovelList must use local dispatch',
    },
    {
      label: 'plugin legacy',
      database: { aiModel: 'custom' },
      error: 'unsupported /chat provider: plugin providers must use local dispatch',
    },
    {
      label: 'plugin V3',
      database: { aiModel: 'pluginmodel:::provider-a' },
      error: 'unsupported /chat provider: plugin providers must use local dispatch',
    },
    {
      label: 'local WebLLM',
      database: { aiModel: 'hf:::Xenova/opt-350m' },
      error: 'unsupported /chat provider: local WebLLM models must use local dispatch',
    },
    {
      label: 'unknown OpenAI-compatible model',
      database: { aiModel: 'unregistered-local-model' },
      error:
        'unsupported /chat provider: unknown OpenAI-compatible model "unregistered-local-model" cannot be dispatched by the server',
    },
  ])('emits an explicit unsupported-provider error for $label without provider tokens', async ({ database, error }) => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      ...database,
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)

    const events = parseEvents(res.body)
    expect(events.map((e) => e.type)).toEqual([
      'stage',
      'stage',
      'stage',
      'prompt',
      'message_patch',
      'stage',
      'info',
      'error',
      'done',
    ])
    expect(events.some((e) => e.type === 'token')).toBe(false)
    expect(events.at(-2)).toEqual({
      type: 'error',
      data: {
        error,
        reason: 'provider_dispatch_exception',
        restoration: {
          chatId: 'chat-1',
          characterId: 'char-1',
          selectedCharID: 0,
          chatPage: 0,
          messages: [],
        },
      },
    })
    expect(typeof events.at(-1)?.data.generationId).toBe('string')
  })

  it('emits a typed tts side_effect before done when auto speech is enabled', async () => {
    await restartHarness({
      dispatchProvider: () => {
        async function* source(): AsyncGenerator<CompletionStreamFrame> {
          yield { kind: 'token', content: 'spoken reply' }
          yield { kind: 'done', finishReason: 'stop' }
        }
        return source()
      },
    })
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      ttsAutoSpeech: true,
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)

    const events = parseEvents(res.body)
    expect(events.map((e) => e.type)).toEqual([
      'stage',
      'stage',
      'stage',
      'prompt',
      'message_patch',
      'stage',
      'info',
      'token',
      'side_effect',
      'done',
    ])
    expect(events.at(-2)).toEqual({
      type: 'side_effect',
      data: {
        kind: 'tts',
        payload: { text: 'spoken reply', characterId: 'char-1' },
      },
    })
  })

  it('maps provider transport failures to error then done after prompt metadata', async () => {
    await restartHarness({
      dispatchProvider: () => {
        async function* source(): AsyncGenerator<CompletionStreamFrame> {
          yield { kind: 'token', content: 'partial' }
          throw new Error('provider exploded')
        }
        return source()
      },
    })
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, fixtureDatabase)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)

    const events = parseEvents(res.body)
    expect(events.map((e) => e.type)).toEqual([
      'stage',
      'stage',
      'stage',
      'prompt',
      'message_patch',
      'stage',
      'info',
      'token',
      'error',
      'done',
    ])
    expect(events.at(-2)).toEqual({
      type: 'error',
      data: {
        error: 'provider exploded',
        reason: 'provider_stream_exception',
        restoration: {
          chatId: 'chat-1',
          characterId: 'char-1',
          selectedCharID: 0,
          chatPage: 0,
          messages: [],
        },
      },
    })
    expect(events.at(-1)?.type).toBe('done')
    expect(typeof events.at(-1)?.data.generationId).toBe('string')
  })
})

describe('Phase 7-11h POST /api/v1/generate/preview-prompt', () => {
  const previewPayload = { chatId: 'chat-1', characterId: 'char-1' }

  it('returns 401 without auth once a password is set', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { password: 'hunter2' },
    })
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/preview-prompt',
      payload: previewPayload,
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a body missing chatId with 400', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/preview-prompt',
      headers: { 'risu-auth': assertion },
      payload: { characterId: 'char-1' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'chatId is required' })
  })

  it('rejects a body missing characterId with 400', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/preview-prompt',
      headers: { 'risu-auth': assertion },
      payload: { chatId: 'chat-1' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'characterId is required' })
  })

  it('returns the assembled prompt as JSON for a seeded database', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, fixtureDatabase)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/preview-prompt',
      headers: { 'risu-auth': assertion },
      payload: previewPayload,
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    const body = res.json()
    expect(Array.isArray(body.messages)).toBe(true)
    expect(body.messages.length).toBeGreaterThan(0)
    expect(body.promptInfo).toBeDefined()
    // Full rows ride on the JSON payload too.
    expect(Array.isArray(body.formated)).toBe(true)
    expect(body.formated.length).toBe(body.messages.length)
    expect((body as Record<string, unknown>).biases).toBeUndefined()
  })

  it('L6: returns only promptInfo.promptText from preview JSON for compact-capable clients', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, fixtureDatabase)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/preview-prompt',
      headers: { 'risu-auth': assertion },
      payload: {
        ...previewPayload,
        clientCapabilities: { compactPromptEvent: true },
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Object.keys(body)).toEqual(['promptInfo'])
    expect(Object.keys(body.promptInfo)).toEqual(['promptText'])
    expect(typeof body.promptInfo.promptText).toBe('string')
    expect(Object.prototype.hasOwnProperty.call(body, 'messages')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(body, 'formated')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(body, 'lorebookActivation')).toBe(false)
  })

  it('returns a structured generation settings 409 body before opening SSE for durable chat', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      characters: [
        {
          ...fixtureDatabase.characters[0],
          chats: [
            {
              ...fixtureDatabase.characters[0].chats[0],
              generationSettings: undefined,
            },
          ],
        },
      ],
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: { ...basePayload, durable: true },
    })
    expect(res.statusCode).toBe(409)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.body).not.toContain('job_accepted')
    const body = res.json()
    expect(body).toMatchObject({
      statusCode: 409,
      error: 'chat_generation_settings_incomplete',
      message: 'Chat generation settings are incomplete',
      chatId: 'chat-1',
    })
    expect(body.missing.map((reason: { code: string }) => reason.code)).toContain('settings_missing')

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    expect(bootstrap.json().activeGenerationJobs).toEqual([])
  })

  it.each([
    {
      label: 'missing active durable profile',
      database: {
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'missing-profile' } },
      },
      reason: 'profile-not-found',
    },
    {
      label: 'model-less active durable profile',
      database: {
        modelProfiles: [{ id: 'empty-profile', name: 'Empty Profile' }],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'empty-profile' } },
      },
      reason: 'profile-model-missing',
    },
    {
      label: 'unsupported active durable profile',
      database: {
        modelProfiles: [
          {
            id: 'unsupported-profile',
            name: 'Unsupported Profile',
            providerId: 'not-a-provider',
            modelId: 'gpt-5',
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'unsupported-profile' } },
      },
      reason: 'unsupported-provider-id',
    },
    {
      label: 'incomplete first-class active durable profile',
      database: {
        modelProfiles: [
          {
            id: 'incomplete-profile',
            name: 'Incomplete Profile',
            providerId: 'openai',
            modelId: 'gpt-5',
          },
        ],
        modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'incomplete-profile' } },
      },
      reason: 'api-key-missing',
    },
  ])('returns JSON before SSE/provider dispatch for $label', async (testCase) => {
    const dispatchProvider = vi.fn()
    await restartHarness({ dispatchProvider })
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      ...testCase.database,
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })

    expect(res.statusCode).toBe(400)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.body).not.toContain('event:')
    expect(res.json().error).toContain(testCase.reason)
    expect(res.json().error).toContain('Model profile')
    expect(dispatchProvider).not.toHaveBeenCalled()
  })

  it('rejects a bad active durable profile before durable job acceptance', async () => {
    const dispatchProvider = vi.fn()
    await restartHarness({ dispatchProvider })
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'missing-profile' } },
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: { ...basePayload, durable: true },
    })

    expect(res.statusCode).toBe(400)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.body).not.toContain('job_accepted')
    expect(res.json().error).toContain('profile-not-found')
    expect(dispatchProvider).not.toHaveBeenCalled()

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    expect(bootstrap.json().activeGenerationJobs).toEqual([])
  })

  it('allows durable compatibility profiles through chat generation', async () => {
    const dispatchProvider = vi.fn(() =>
      (async function* (): AsyncGenerator<CompletionStreamFrame> {
        yield { kind: 'token', content: 'compat ok' }
        yield { kind: 'done', finishReason: 'stop' }
      })(),
    )
    await restartHarness({ dispatchProvider })
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      modelProfiles: [{ id: 'compat-profile', name: 'Compat Profile', modelId: 'echo_model' }],
      modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'compat-profile' } },
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')
    expect(dispatchProvider).toHaveBeenCalledTimes(1)
    expect(parseEvents(res.body).at(-1)?.data).toMatchObject({ result: 'compat ok' })
  })

  it("dispatches with the active chat's preset overlay instead of request or global preset", async () => {
    let providerBody: Record<string, unknown> | undefined
    let authorization: string | undefined
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      providerBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      const headers = init?.headers as Record<string, string> | undefined
      authorization = headers?.authorization
      return new Response(
        JSON.stringify({
          model: 'gpt-5.4',
          choices: [{ message: { content: 'chat preset reply' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      aiModel: 'echo_model',
      echoMessage: 'global echo reply',
      openAIKey: 'sk-global',
      temperature: 11,
      maxContext: 1111,
      maxResponse: 11,
      modelPresets: [
        {
          id: 'model-global',
          name: 'Global Model',
          aiModel: 'echo_model',
          echoMessage: 'global echo reply',
          openAIKey: 'sk-global',
          temperature: 11,
          maxContext: 1111,
          maxResponse: 11,
        },
        {
          id: 'model-chat',
          name: 'Chat Model',
          aiModel: 'gpt-5.4',
          openAIKey: 'sk-chat',
          temperature: 73,
          maxContext: 3737,
          maxResponse: 37,
        },
      ],
      promptPresets: [{ id: 'prompt-chat', name: 'Chat Prompt' }],
      modelPresetsId: 0,
      promptPresetsId: 0,
      characters: [
        {
          ...fixtureDatabase.characters[0],
          chats: [
            {
              ...fixtureDatabase.characters[0].chats[0],
              generationSettings: {
                configured: true,
                personaId: DEFAULT_TEST_PERSONA_ID,
                modelPresetId: 'model-chat',
                promptPresetId: 'prompt-chat',
                jailbreakToggle: false,
                sidebarToggles: {},
              },
            },
          ],
        },
      ],
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)

    const events = parseEvents(res.body)
    const info = events.find((event) => event.type === 'info')
    expect(info?.data.generationInfo).toMatchObject({
      model: 'gpt-5.4',
      outputTokens: 37,
      maxContext: 3737,
    })
    expect(providerBody).toMatchObject({
      model: 'gpt-5.4',
      temperature: 0.73,
      max_tokens: 37,
    })
    expect(authorization).toBe('Bearer sk-chat')
    expect(events.at(-1)?.data).toMatchObject({ result: 'chat preset reply' })
  })

  it('lets prompt presets override selected model preset parameters and Prompt Others fields', async () => {
    let providerBody: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      providerBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return new Response(
        JSON.stringify({
          model: 'gpt-5.4',
          choices: [{ message: { content: 'prompt override reply' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      modelPresets: [
        {
          id: 'model-chat',
          name: 'Chat Model',
          aiModel: 'reverse_proxy',
          forceReplaceUrl: 'https://proxy.example/v1/chat/completions',
          proxyKey: 'sk-chat',
          customProxyRequestModel: 'model-from-model-preset',
          temperature: 11,
          maxContext: 1111,
          maxResponse: 11,
          additionalParams: [['top_p', '0.9']],
        },
      ],
      promptPresets: [
        {
          id: 'prompt-chat',
          name: 'Chat Prompt',
          overrideModelParameters: true,
          temperature: 44,
          maxContext: 4444,
          maxResponse: 44,
          additionalParams: [['top_p', '0.5']],
        },
      ],
      modelPresetsId: 0,
      promptPresetsId: 0,
      characters: [
        {
          ...fixtureDatabase.characters[0],
          chats: [
            {
              ...fixtureDatabase.characters[0].chats[0],
              generationSettings: {
                configured: true,
                personaId: DEFAULT_TEST_PERSONA_ID,
                modelPresetId: 'model-chat',
                promptPresetId: 'prompt-chat',
                jailbreakToggle: false,
                sidebarToggles: {},
              },
            },
          ],
        },
      ],
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)

    const info = parseEvents(res.body).find((event) => event.type === 'info')
    expect(info?.data.generationInfo).toMatchObject({
      outputTokens: 44,
      maxContext: 4444,
    })
    expect(providerBody).toMatchObject({
      model: 'model-from-model-preset',
      temperature: 0.44,
      max_tokens: 44,
      top_p: 0.5,
    })
  })

  it('applies profile-bound runtime fields from the active chat model preset before assembly dispatch', async () => {
    let dispatchedDatabase: Record<string, unknown> | undefined
    const dispatchProvider = vi.fn(({ database }) => {
      dispatchedDatabase = structuredClone(database) as Record<string, unknown>
      return (async function* (): AsyncGenerator<CompletionStreamFrame> {
        yield { kind: 'token', content: 'profile runtime reply' }
        yield { kind: 'done', finishReason: 'stop' }
      })()
    })
    await restartHarness({ dispatchProvider })
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      aiModel: 'echo_model',
      maxContext: 1111,
      maxResponse: 11,
      temperature: 11,
      top_p: 0.9,
      useStreaming: true,
      modelPresets: [
        {
          id: 'model-profile-runtime',
          name: 'Profile Runtime Model',
          modelProfiles: [
            {
              id: 'profile-runtime',
              name: 'Profile Runtime',
              providerId: 'custom-api',
              modelId: 'custom-api',
              providerOptions: {
                baseUrl: 'https://profile-runtime.example.com/v1',
                requestModel: 'profile-runtime-wire-model',
              },
              runtimeOptions: {
                maxContext: 2222,
                maxResponse: 22,
                temperature: 66,
                topP: 0.42,
                useStreaming: false,
                extractJson: 'json',
                jsonSchemaEnabled: true,
                jsonSchema: '{"type":"object"}',
                strictJsonSchema: true,
                modelTools: ['search'],
                enableCustomFlags: true,
                customFlags: [LLMFlags.hasImageInput],
              },
            },
          ],
          modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'profile-runtime' } },
        },
      ],
      promptPresets: [{ id: 'prompt-chat', name: 'Chat Prompt' }],
      characters: [
        {
          ...fixtureDatabase.characters[0],
          chats: [
            {
              ...fixtureDatabase.characters[0].chats[0],
              generationSettings: {
                configured: true,
                personaId: DEFAULT_TEST_PERSONA_ID,
                modelPresetId: 'model-profile-runtime',
                promptPresetId: 'prompt-chat',
                jailbreakToggle: false,
                sidebarToggles: {},
              },
            },
          ],
        },
      ],
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })

    expect(res.statusCode).toBe(200)
    expect(dispatchProvider).toHaveBeenCalledTimes(1)
    expect(dispatchedDatabase).toMatchObject({
      aiModel: 'custom-api',
      maxContext: 2222,
      maxResponse: 22,
      temperature: 66,
      top_p: 0.42,
      useStreaming: false,
      extractJson: 'json',
      jsonSchemaEnabled: true,
      jsonSchema: '{"type":"object"}',
      strictJsonSchema: true,
      modelTools: ['search'],
      enableCustomFlags: true,
      customFlags: [LLMFlags.hasImageInput],
    })
    const info = parseEvents(res.body).find((event) => event.type === 'info')
    expect(info?.data.generationInfo).toMatchObject({
      model: 'custom-api',
      outputTokens: 22,
      maxContext: 2222,
    })
  })

  it('lets prompt parameter overrides win over profile-bound runtime fields', async () => {
    let dispatchedDatabase: Record<string, unknown> | undefined
    const dispatchProvider = vi.fn(({ database }) => {
      dispatchedDatabase = structuredClone(database) as Record<string, unknown>
      return (async function* (): AsyncGenerator<CompletionStreamFrame> {
        yield { kind: 'token', content: 'prompt profile override reply' }
        yield { kind: 'done', finishReason: 'stop' }
      })()
    })
    await restartHarness({ dispatchProvider })
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      maxContext: 1111,
      maxResponse: 11,
      temperature: 11,
      top_p: 0.9,
      modelPresets: [
        {
          id: 'model-profile-runtime',
          name: 'Profile Runtime Model',
          modelProfiles: [
            {
              id: 'profile-runtime',
              name: 'Profile Runtime',
              providerId: 'custom-api',
              modelId: 'custom-api',
              providerOptions: {
                baseUrl: 'https://profile-runtime.example.com/v1',
                requestModel: 'profile-runtime-wire-model',
              },
              runtimeOptions: {
                maxContext: 2222,
                maxResponse: 22,
                temperature: 66,
                topP: 0.42,
                useStreaming: false,
              },
            },
          ],
          modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'profile-runtime' } },
        },
      ],
      promptPresets: [
        {
          id: 'prompt-chat',
          name: 'Chat Prompt',
          overrideModelParameters: true,
          maxContext: 4444,
          maxResponse: 44,
          temperature: 33,
          top_p: 0.24,
        },
      ],
      characters: [
        {
          ...fixtureDatabase.characters[0],
          chats: [
            {
              ...fixtureDatabase.characters[0].chats[0],
              generationSettings: {
                configured: true,
                personaId: DEFAULT_TEST_PERSONA_ID,
                modelPresetId: 'model-profile-runtime',
                promptPresetId: 'prompt-chat',
                jailbreakToggle: false,
                sidebarToggles: {},
              },
            },
          ],
        },
      ],
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })

    expect(res.statusCode).toBe(200)
    expect(dispatchProvider).toHaveBeenCalledTimes(1)
    expect(dispatchedDatabase).toMatchObject({
      aiModel: 'custom-api',
      maxContext: 4444,
      maxResponse: 44,
      temperature: 33,
      top_p: 0.24,
      useStreaming: false,
    })
    const info = parseEvents(res.body).find((event) => event.type === 'info')
    expect(info?.data.generationInfo).toMatchObject({
      model: 'custom-api',
      outputTokens: 44,
      maxContext: 4444,
    })
  })

  it('omits disabled temperature and unsupported bias fields from default OpenAI dispatch', async () => {
    const captured: Array<{ url: string; body: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      captured.push({
        url,
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      })
      return new Response(
        JSON.stringify({
          model: 'gpt-5.4',
          choices: [{ message: { content: 'openai reply' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      aiModel: 'gpt-5.4',
      openAIKey: 'sk-test',
      temperature: -1000,
      bias: [['forbidden', -100]],
      characters: [
        {
          ...fixtureDatabase.characters[0],
          bias: [['{{char}}', 50]],
        },
      ],
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)

    const providerBody = captured.find((call) => call.url.endsWith('/chat/completions'))?.body
    expect(providerBody).toBeDefined()
    expect(providerBody?.temperature).toBeUndefined()
    expect(providerBody?.logit_bias).toBeUndefined()
    expect(providerBody?.biases).toBeUndefined()

    const prompt = parseEvents(res.body).find((e) => e.type === 'prompt')
    expect(prompt).toBeDefined()
    expect((prompt!.data as Record<string, unknown>).biases).toBeUndefined()
  })

  it('preserves active temperature in default OpenAI dispatch', async () => {
    let providerBody: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      providerBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      aiModel: 'gpt-5.4',
      openAIKey: 'sk-test',
      temperature: 80,
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    expect(providerBody?.temperature).toBe(0.8)
  })

  it('omits disabled Horde sampler fields and preserves active Horde sampler fields', async () => {
    const submitBodies: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/generate/text/async')) {
        submitBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
        return new Response(JSON.stringify({ id: `job-${submitBodies.length}` }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.endsWith('/generate/text/status/job-1')) {
        return new Response(JSON.stringify({ done: true, generations: [{ text: 'disabled response' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.endsWith('/generate/text/status/job-2')) {
        return new Response(JSON.stringify({ done: true, generations: [{ text: 'active response' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      throw new Error(`unexpected Horde URL: ${url}`)
    })
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      aiModel: 'horde:::koboldcpp/Mistral-7B',
      instructChatTemplate: 'chatml',
      temperature: -1000,
      top_k: -1000,
      top_p: -1000,
    })

    const disabled = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(disabled.statusCode).toBe(200)
    const disabledParams = submitBodies[0]?.params as Record<string, unknown>
    expect(disabledParams.temperature).toBeUndefined()
    expect(disabledParams.top_k).toBeUndefined()
    expect(disabledParams.top_p).toBeUndefined()

    await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      aiModel: 'horde:::koboldcpp/Mistral-7B',
      instructChatTemplate: 'chatml',
      temperature: 80,
      top_k: 40,
      top_p: 0.9,
    })
    const active = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(active.statusCode).toBe(200)
    const activeParams = submitBodies[1]?.params as Record<string, unknown>
    expect(activeParams.temperature).toBe(0.8)
    expect(activeParams.top_k).toBe(40)
    expect(activeParams.top_p).toBe(0.9)
  })

  it('returns 404 (not an SSE error) when the character is unknown', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, fixtureDatabase)

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/preview-prompt',
      headers: { 'risu-auth': assertion },
      payload: { chatId: 'chat-1', characterId: 'nope' },
    })
    expect(res.statusCode).toBe(404)
    expect(String(res.json().error)).toMatch(/character not found/)
  })

  it('returns the structured generation settings 409 body for preview-prompt', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      characters: [
        {
          ...fixtureDatabase.characters[0],
          chats: [
            {
              ...fixtureDatabase.characters[0].chats[0],
              generationSettings: undefined,
            },
          ],
        },
      ],
    })

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/preview-prompt',
      headers: { 'risu-auth': assertion },
      payload: previewPayload,
    })
    expect(res.statusCode).toBe(409)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.json()).toMatchObject({
      statusCode: 409,
      error: 'chat_generation_settings_incomplete',
      message: 'Chat generation settings are incomplete',
      chatId: 'chat-1',
      staleSidebarToggleKeys: [],
    })
    expect(res.json().missing.map((reason: { code: string }) => reason.code)).toContain('settings_missing')
  })

  it('keeps deleted preset and persona references scoped to affected configured chats', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    let revision = await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      selectedPersona: 1,
      modelPresetsId: 0,
      promptPresetsId: 1,
      personas: [
        {
          id: 'persona-survivor',
          name: 'Survivor Persona',
          icon: '',
          personaPrompt: 'Survivor persona prompt',
          note: '',
        },
        {
          id: 'persona-deleted',
          name: 'Deleted Persona',
          icon: '',
          personaPrompt: 'Deleted persona prompt',
          note: '',
        },
      ],
      modelPresets: [
        {
          id: 'model-survivor',
          name: 'Survivor Model Preset',
          maxContext: 100_000,
          maxResponse: 50,
        },
      ],
      promptPresets: [
        {
          id: 'prompt-survivor',
          name: 'Survivor Prompt Preset',
          mainPrompt: 'SURVIVOR MAIN',
        },
        {
          id: 'prompt-deleted',
          name: 'Deleted Prompt Preset',
          mainPrompt: 'DELETED MAIN',
        },
      ],
      characters: [
        {
          ...fixtureDatabase.characters[0],
          chats: [
            configuredChat('chat-ok', {
              personaId: 'persona-survivor',
              modelPresetId: 'model-survivor',
              promptPresetId: 'prompt-survivor',
            }),
            configuredChat('chat-deleted-preset', {
              personaId: 'persona-survivor',
              modelPresetId: 'model-survivor',
              promptPresetId: 'prompt-deleted',
            }),
            configuredChat('chat-deleted-persona', {
              personaId: 'persona-deleted',
              modelPresetId: 'model-survivor',
              promptPresetId: 'prompt-survivor',
            }),
          ],
        },
      ],
    })

    const deletePreset = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/prompt-presets/prompt-deleted',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision },
    })
    expect(deletePreset.statusCode).toBe(200)
    expect(deletePreset.json()).toMatchObject({
      promptPresetId: 'prompt-deleted',
      selectedPromptPresetId: 'prompt-survivor',
    })
    revision = deletePreset.json().revision as number

    const deletePersona = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/commands/personas/persona-deleted',
      headers: { 'risu-auth': assertion },
      payload: { baseRevision: revision },
    })
    expect(deletePersona.statusCode).toBe(200)
    expect(deletePersona.json()).toMatchObject({
      personaId: 'persona-deleted',
      selectedPersonaId: 'persona-survivor',
    })

    const preview = (chatId: string) =>
      harness.app.inject({
        method: 'POST',
        url: '/api/v1/generate/preview-prompt',
        headers: { 'risu-auth': assertion },
        payload: { chatId, characterId: 'char-1' },
      })

    const ok = await preview('chat-ok')
    expect(ok.statusCode).toBe(200)

    const deletedPreset = await preview('chat-deleted-preset')
    expect(deletedPreset.statusCode).toBe(409)
    expectMissingCodes(deletedPreset.json(), ['prompt_preset_missing'], ['persona_missing'])
    expect(deletedPreset.json().missing).toContainEqual(
      expect.objectContaining({
        code: 'prompt_preset_missing',
        promptPresetId: 'prompt-deleted',
      }),
    )

    const deletedPersona = await preview('chat-deleted-persona')
    expect(deletedPersona.statusCode).toBe(409)
    expectMissingCodes(deletedPersona.json(), ['persona_missing'], ['prompt_preset_missing'])
    expect(deletedPersona.json().missing).toContainEqual(
      expect.objectContaining({
        code: 'persona_missing',
        personaId: 'persona-deleted',
      }),
    )

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    const chats = bootstrap.json().database.characters[0].chats as Array<{
      id: string
      generationSettings?: Record<string, unknown>
    }>
    const deletedPresetSettings = chats.find((chat) => chat.id === 'chat-deleted-preset')?.generationSettings
    const deletedPersonaSettings = chats.find((chat) => chat.id === 'chat-deleted-persona')?.generationSettings
    expect(deletedPresetSettings).toMatchObject({
      personaId: 'persona-survivor',
      modelPresetId: 'model-survivor',
      promptPresetId: 'prompt-deleted',
    })
    expect(deletedPersonaSettings).toMatchObject({
      personaId: 'persona-deleted',
      modelPresetId: 'model-survivor',
      promptPresetId: 'prompt-survivor',
    })
  })

  it('makes an otherwise configured chat incomplete when its selected preset displays a new required toggle', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const revision = await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      modelPresets: [{ id: 'model-a', name: 'Model A' }],
      promptPresets: [{ id: 'prompt-a', name: 'Prompt A' }],
      personas: [
        {
          id: 'persona-a',
          name: 'Persona A',
          icon: '',
          personaPrompt: '',
          note: '',
        },
      ],
      characters: [
        {
          ...fixtureDatabase.characters[0],
          chats: [
            {
              ...fixtureDatabase.characters[0].chats[0],
              generationSettings: {
                configured: true,
                personaId: 'persona-a',
                modelPresetId: 'model-a',
                promptPresetId: 'prompt-a',
                jailbreakToggle: false,
                sidebarToggles: {},
              },
            },
          ],
        },
      ],
    })

    const before = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/preview-prompt',
      headers: { 'risu-auth': assertion },
      payload: previewPayload,
    })
    expect(before.statusCode).toBe(200)

    const patchedPreset = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/commands/prompt-presets/prompt-a',
      headers: { 'risu-auth': assertion },
      payload: {
        baseRevision: revision,
        patch: { customPromptTemplateToggle: 'mode=Mode' },
      },
    })
    expect(patchedPreset.statusCode).toBe(200)

    const after = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/preview-prompt',
      headers: { 'risu-auth': assertion },
      payload: previewPayload,
    })
    expect(after.statusCode).toBe(409)
    expect(after.json()).toMatchObject({
      statusCode: 409,
      error: 'chat_generation_settings_incomplete',
      chatId: 'chat-1',
      staleSidebarToggleKeys: [],
    })
    expect(after.json().missing).toContainEqual(
      expect.objectContaining({
        code: 'sidebar_toggle_missing',
        toggleKey: 'mode',
      }),
    )
  })

  it('returns 404 when no database is persisted', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/preview-prompt',
      headers: { 'risu-auth': assertion },
      payload: previewPayload,
    })
    expect(res.statusCode).toBe(404)
    expect(String(res.json().error)).toMatch(/database not found/)
  })
})

function configuredChat(
  id: string,
  settings: { personaId: string; modelPresetId: string; promptPresetId: string },
): Record<string, unknown> {
  return {
    id,
    message: [],
    note: '',
    name: id,
    localLore: [],
    generationSettings: {
      configured: true,
      personaId: settings.personaId,
      modelPresetId: settings.modelPresetId,
      promptPresetId: settings.promptPresetId,
      jailbreakToggle: false,
      sidebarToggles: {},
    },
  }
}

function expectMissingCodes(
  body: { missing?: Array<{ code?: string }> },
  expected: string[],
  unexpected: string[],
): void {
  const codes = body.missing?.map((reason) => reason.code) ?? []
  for (const code of expected) {
    expect(codes).toContain(code)
  }
  for (const code of unexpected) {
    expect(codes).not.toContain(code)
  }
}
