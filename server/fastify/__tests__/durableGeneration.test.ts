import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { buildApp } from '../src/app.js'
import { createCommandEventSink, type CommandEventSink } from '../src/commands/events.js'
import { openDatabase } from '../src/db.js'
import type { CompletionStreamFrame } from '../src/generation/frames.js'
import {
  enqueueGenerationFinalizationRetry,
  markGenerationFinalizationRetryFailure,
  pruneTerminalGenerationFinalizationRetries,
} from '../src/generationFinalizationRetry.js'
import { retryQueuedGenerationFinalizations, type ChatProviderDispatcher } from '../src/routes/generationChat.js'
import { setupAuthedClient } from './helpers/auth.js'

// Durable generation lives on a detached job whose lifecycle is not tied to the
// request connection, so these use a real listening server + `fetch`. `app.inject`
// buffers the whole response and cannot model a mid-stream disconnect / reattach.

interface Harness {
  app: FastifyInstance
  dataDir: string
  baseUrl: string
}

type JsonRecord = Record<string, unknown>

// The injected provider is swapped per test through this stable indirection, so the
// app is built once per test with a provider that delegates to the current impl.
let providerImpl: ChatProviderDispatcher = () => {
  async function* g(): AsyncGenerator<CompletionStreamFrame> {
    yield { kind: 'done', finishReason: 'stop' }
  }
  return g()
}
let failNextGenerationPersistEvent = false

const DURABLE_PERSONA_ID = 'durable-persona'
const DURABLE_MODEL_PRESET_ID = 'durable-model-preset'
const DURABLE_PROMPT_PRESET_ID = 'durable-prompt-preset'
const durablePromptSettings = {
  assistantPrefill: '',
  postEndInnerFormat: '',
  sendChatAsSystem: false,
  sendName: false,
  utilOverride: false,
}

const openControllers = new Set<AbortController>()

function newController(): AbortController {
  const controller = new AbortController()
  openControllers.add(controller)
  return controller
}

async function startHarness(generationChatOverrides: Record<string, unknown> = {}): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-durable-'))
  const commandEvents = createRetryTestCommandSink()
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      importMaxBytes: Infinity,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
    generationChat: {
      dispatchProvider: (ctx) => providerImpl(ctx),
      finalizationRetry: { intervalMs: 10 },
      ...generationChatOverrides,
    },
    commandEvents,
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const addr = app.server.address() as AddressInfo
  return { app, dataDir, baseUrl: `http://127.0.0.1:${addr.port}` }
}

function createRetryTestCommandSink(): CommandEventSink {
  const inner = createCommandEventSink()
  return {
    emit(event) {
      if (event.type === 'generation.persisted' && failNextGenerationPersistEvent) {
        failNextGenerationPersistEvent = false
        throw new Error('transient generation event delivery failure')
      }
      inner.emit(event)
    },
    list: () => inner.list(),
    clear: () => inner.clear(),
    subscribe: (listener) => inner.subscribe(listener),
  }
}

function durableGenerationSettings(): Record<string, unknown> {
  return {
    configured: true,
    personaId: DURABLE_PERSONA_ID,
    modelPresetId: DURABLE_MODEL_PRESET_ID,
    promptPresetId: DURABLE_PROMPT_PRESET_ID,
    jailbreakToggle: false,
    sidebarToggles: {},
  }
}

function durableChat(messages: Array<Record<string, unknown>> = []): Record<string, unknown> {
  return {
    id: 'chat-1',
    message: messages,
    note: '',
    name: 'Chat',
    localLore: [],
    generationSettings: durableGenerationSettings(),
  }
}

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
      chats: [durableChat()],
    },
  ],
  selectedPersona: 0,
  personas: [
    {
      id: DURABLE_PERSONA_ID,
      name: 'Durable User',
      personaPrompt: 'durable persona prompt',
      icon: '',
      note: '',
    },
  ],
  modelPresetsId: 0,
  promptPresetsId: 0,
  botPresets: [],
  modelPresets: [
    {
      id: DURABLE_MODEL_PRESET_ID,
      name: 'Durable Model Preset',
      maxContext: 100_000,
      maxResponse: 50,
    },
  ],
  promptPresets: [
    {
      id: DURABLE_PROMPT_PRESET_ID,
      name: 'Durable Prompt Preset',
      mainPrompt: 'MAIN',
      formatingOrder: ['main', 'description', 'chats'],
      promptSettings: durablePromptSettings,
      customPromptTemplateToggle: '',
    },
  ],
  modules: [],
  enabledModules: [],
  formatingOrder: ['main', 'description', 'chats'],
  promptSettings: durablePromptSettings,
  mainPrompt: 'MAIN',
  maxContext: 100_000,
  maxResponse: 50,
}

let harness: Harness
let assertion: string

interface GenerationFinalizationRetryTestRow {
  generation_id: string
  chat_id: string
  status: string
  failure_count: number
  last_error: string | null
  terminal_error: string | null
}

beforeEach(async () => {
  failNextGenerationPersistEvent = false
  providerImpl = () => {
    async function* g(): AsyncGenerator<CompletionStreamFrame> {
      yield { kind: 'done', finishReason: 'stop' }
    }
    return g()
  }
  harness = await startHarness()
  ;({ assertion } = await setupAuthedClient(harness.app))
  await seedDatabase(fixtureDatabase)
})

afterEach(async () => {
  for (const controller of openControllers) controller.abort()
  openControllers.clear()
  await harness.app.close()
  rmSync(harness.dataDir, { recursive: true, force: true })
})

async function seedDatabase(database: unknown): Promise<void> {
  await seedDatabaseForHarness(harness, assertion, database)
}

async function seedDatabaseForHarness(target: Harness, targetAssertion: string, database: unknown): Promise<number> {
  const res = await fetch(`${target.baseUrl}/api/v1/import/risusave`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'risu-auth': targetAssertion },
    body: JSON.stringify({ database }),
  })
  expect(res.status).toBe(200)
  const imported = (await res.json()) as { revision: number }
  return configureImportedCurrentChatGenerationSettings(target, targetAssertion, database, imported.revision)
}

async function configureImportedCurrentChatGenerationSettings(
  target: Harness,
  targetAssertion: string,
  database: unknown,
  baseRevision: number,
): Promise<number> {
  const chatSettings = activeChatGenerationSettings(database)
  if (!chatSettings) return baseRevision

  const res = await fetch(
    `${target.baseUrl}/api/v1/commands/chats/${encodeURIComponent(chatSettings.chatId)}/generation-settings`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'risu-auth': targetAssertion },
      body: JSON.stringify({
        baseRevision,
        generationSettings: {
          ...chatSettings.generationSettings,
          configured: true,
        },
      }),
    },
  )
  expect(res.status).toBe(200)
  return ((await res.json()) as { revision: number }).revision
}

function activeChatGenerationSettings(database: unknown): { chatId: string; generationSettings: JsonRecord } | null {
  if (!isJsonRecord(database)) return null
  const characters = Array.isArray(database.characters) ? database.characters : []
  const currentCharIndex = Number.isInteger(database.currentChar as number) ? (database.currentChar as number) : 0
  const character = findRecordAt(characters, currentCharIndex) ?? findRecordAt(characters, 0)
  if (!character) return null

  const chats = Array.isArray(character.chats) ? character.chats : []
  const chatPage = Number.isInteger(character.chatPage as number) ? (character.chatPage as number) : 0
  const chat = findRecordAt(chats, chatPage) ?? findRecordAt(chats, 0)
  if (!chat || typeof chat.id !== 'string') return null
  const generationSettings = chat.generationSettings
  if (!isJsonRecord(generationSettings)) return null
  if (!generationSettingReferencesExist(database, generationSettings)) return null

  return {
    chatId: chat.id,
    generationSettings,
  }
}

function generationSettingReferencesExist(database: JsonRecord, settings: JsonRecord): boolean {
  return (
    typeof settings.personaId === 'string' &&
    collectionHasId(database.personas, settings.personaId) &&
    typeof settings.modelPresetId === 'string' &&
    collectionHasId(database.modelPresets, settings.modelPresetId) &&
    typeof settings.promptPresetId === 'string' &&
    collectionHasId(database.promptPresets, settings.promptPresetId)
  )
}

function collectionHasId(collection: unknown, id: string): boolean {
  return Array.isArray(collection) && collection.some((row) => isJsonRecord(row) && row.id === id)
}

function findRecordAt(collection: unknown[], index: number): JsonRecord | null {
  const value = collection[index]
  return isJsonRecord(value) ? value : null
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'risu-auth': assertion, ...extra }
}

interface ParsedEvent {
  type: string
  data: Record<string, unknown>
}

function parseSseBlock(block: string): ParsedEvent | null {
  const trimmed = block.replace(/\r/g, '')
  if (trimmed.trim().length === 0) return null
  const [evLine, dataLine] = trimmed.split('\n')
  if (!evLine?.startsWith('event: ')) return null
  try {
    return {
      type: evLine.slice('event: '.length),
      data: JSON.parse((dataLine ?? 'data: {}').slice('data: '.length)) as Record<string, unknown>,
    }
  } catch {
    return null
  }
}

/**
 * Read SSE frames until `until` returns true (then return, leaving the connection
 * open for the caller to drop), or until the stream ends. Swallows the read error
 * a mid-stream abort raises.
 */
async function readSse(res: Response, until: (ev: ParsedEvent) => boolean): Promise<ParsedEvent[]> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events: ParsedEvent[] = []
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const ev = parseSseBlock(block)
        if (ev) {
          events.push(ev)
          if (until(ev)) return events
        }
      }
    }
  } catch {
    // reader aborted / connection dropped
  }
  return events
}

function postDurable(
  body: Record<string, unknown>,
  init: { signal?: AbortSignal; writerSession?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = authHeaders({ 'content-type': 'application/json' })
  if (init.writerSession) headers['risu-writer-session'] = init.writerSession
  return fetch(`${harness.baseUrl}/api/v1/generate/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      chatId: 'chat-1',
      characterId: 'char-1',
      mode: 'send',
      userMessage: 'hi',
      durable: true,
      ...body,
    }),
    signal: init.signal,
  })
}

/**
 * A provider that streams `before`, then blocks until either `release()` is called
 * (then streams `after` + done) or the job's signal aborts (then throws, like a real
 * provider whose fetch was aborted) — giving deterministic control over the
 * mid-stream window without timing races.
 */
function makeGatedProvider(opts: { before: string; after?: string }): {
  dispatchProvider: ChatProviderDispatcher
  release: () => void
} {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const dispatchProvider: ChatProviderDispatcher = (ctx) => {
    const signal = ctx.signal
    async function* gen(): AsyncGenerator<CompletionStreamFrame> {
      yield { kind: 'token', content: opts.before }
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(new Error('aborted'))
          return
        }
        const onAbort = (): void => reject(new Error('aborted'))
        signal.addEventListener('abort', onAbort, { once: true })
        void gate.then(() => {
          signal.removeEventListener('abort', onAbort)
          resolve()
        })
      })
      if (opts.after !== undefined) yield { kind: 'token', content: opts.after }
      yield { kind: 'done', finishReason: 'stop' }
    }
    return gen()
  }
  return { dispatchProvider, release }
}

async function bootstrap(): Promise<{
  activeGenerationJobs: Array<{
    chatId: string
    jobId: string
    mode?: 'send' | 'continue' | 'regenerate'
    regenerateMessageId?: string
  }>
  database: {
    characters: Array<{
      chats: Array<{
        message: Array<Record<string, unknown>>
        scriptstate?: Record<string, unknown>
      }>
    }>
  }
  revision: number
}> {
  const res = await fetch(`${harness.baseUrl}/api/v1/bootstrap`, { headers: authHeaders() })
  expect(res.status).toBe(200)
  return (await res.json()) as never
}

async function chatHydration(boot: Awaited<ReturnType<typeof bootstrap>>): Promise<{
  message: Array<Record<string, unknown>>
  alternates: Array<Record<string, unknown>>
}> {
  // The bootstrap ships chat stubs; read persisted messages via per-chat hydration.
  const chat = boot.database.characters[0]?.chats[0] as { id?: string } | undefined
  if (!chat?.id) return { message: [], alternates: [] }
  const res = await fetch(`${harness.baseUrl}/api/v1/projection/chatMessages?id=${encodeURIComponent(chat.id)}`, {
    headers: authHeaders(),
  })
  expect(res.status).toBe(200)
  return (await res.json()) as {
    message: Array<Record<string, unknown>>
    alternates: Array<Record<string, unknown>>
  }
}

async function chatMessages(boot: Awaited<ReturnType<typeof bootstrap>>): Promise<Array<Record<string, unknown>>> {
  return (await chatHydration(boot)).message
}

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 5000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const value = await fn()
    if (value !== undefined) return value
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

async function waitForAssistantMessage(): Promise<Record<string, unknown>> {
  return waitFor(async () => {
    const boot = await bootstrap()
    return (await chatMessages(boot)).find((m) => m.role === 'char')
  })
}

/** Re-seed the fixture chat with an explicit transcript (for continue / regenerate). */
async function seedChatWithMessages(messages: Array<Record<string, unknown>>): Promise<void> {
  await seedDatabase({
    ...fixtureDatabase,
    characters: [
      {
        ...fixtureDatabase.characters[0],
        chats: [durableChat(messages)],
      },
    ],
  })
}

/** Cancel a running durable job over the DELETE route. */
async function cancelJob(jobId: string): Promise<void> {
  const del = await fetch(`${harness.baseUrl}/api/v1/generate/chat/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  expect(del.status).toBe(200)
}

function generationFinalizationRetryRows(): GenerationFinalizationRetryTestRow[] {
  const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'), { readOnly: true })
  try {
    return db
      .prepare(
        `
          SELECT generation_id, chat_id, status, failure_count, last_error, terminal_error
          FROM generation_finalization_retries
          ORDER BY generation_id ASC
        `,
      )
      .all() as unknown as GenerationFinalizationRetryTestRow[]
  } finally {
    db.close()
  }
}

function commandEventTypeCount(type: string): number {
  const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'), { readOnly: true })
  try {
    const row = db.prepare('SELECT COUNT(*) AS count FROM command_events WHERE type = ?').get(type) as
      | { count: number }
      | undefined
    return row?.count ?? 0
  } finally {
    db.close()
  }
}

function retryQueuedFinalizationsOnce(): ReturnType<typeof retryQueuedGenerationFinalizations> {
  const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
  try {
    return retryQueuedGenerationFinalizations({
      db,
      dataDir: harness.dataDir,
      eventSink: createCommandEventSink(),
      maxPerSweep: 10,
    })
  } finally {
    db.close()
  }
}

function jobIdFromEvents(events: ParsedEvent[]): string {
  const jobId = events.find((ev) => ev.type === 'job_accepted')?.data.jobId
  expect(typeof jobId).toBe('string')
  return jobId as string
}

async function waitForTerminalFinalization(generationId: string): Promise<GenerationFinalizationRetryTestRow> {
  return waitFor(async () => {
    const row = generationFinalizationRetryRows().find((retry) => retry.generation_id === generationId)
    return row?.status === 'terminal' ? row : undefined
  })
}

async function patchMessage(messageId: string, patch: Record<string, unknown>): Promise<void> {
  const boot = await bootstrap()
  const res = await fetch(`${harness.baseUrl}/api/v1/commands/messages/${encodeURIComponent(messageId)}`, {
    method: 'PATCH',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ baseRevision: boot.revision, patch }),
  })
  expect(res.status).toBe(200)
}

async function patchChatScriptstate(patch: Record<string, string | number | boolean>): Promise<void> {
  const boot = await bootstrap()
  const res = await fetch(`${harness.baseUrl}/api/v1/commands/chats/chat-1/scriptstate`, {
    method: 'PATCH',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ baseRevision: boot.revision, patch }),
  })
  expect(res.status).toBe(200)
}

async function appendMessage(message: Record<string, unknown>): Promise<void> {
  const boot = await bootstrap()
  const res = await fetch(`${harness.baseUrl}/api/v1/commands/chats/chat-1/messages`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ baseRevision: boot.revision, message }),
  })
  expect(res.status).toBe(200)
}

async function truncateChat(afterMessageId: string | null): Promise<void> {
  const boot = await bootstrap()
  const res = await fetch(`${harness.baseUrl}/api/v1/commands/chats/chat-1/messages/truncate`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ baseRevision: boot.revision, afterMessageId }),
  })
  expect(res.status).toBe(200)
}

function seedGenerationFinalizationRetryRow(
  db: DatabaseSync,
  generationId: string,
  status: 'pending' | 'terminal',
  updatedAt: string,
): void {
  enqueueGenerationFinalizationRetry(db, {
    generationId,
    chatId: 'chat-1',
    mode: 'send',
    message: {
      role: 'char',
      data: `message for ${generationId}`,
      chatId: generationId,
    } as never,
    chatVarMutations: [],
  })
  if (status === 'terminal') {
    markGenerationFinalizationRetryFailure(db, generationId, 'terminal fixture failure', true)
  }
  db.prepare('UPDATE generation_finalization_retries SET updated_at = ? WHERE generation_id = ?').run(
    updatedAt,
    generationId,
  )
}

describe('Durable generation (Milestone 1)', () => {
  // The generation survives the client drop and persists with no client present.
  it('keeps generating after the client drops mid-stream and persists the result (EC-D1)', async () => {
    const gated = makeGatedProvider({ before: 'Hel', after: 'lo' })
    providerImpl = gated.dispatchProvider

    const controller = newController()
    const res = await postDurable({}, { signal: controller.signal })
    let jobId = ''
    await readSse(res, (ev) => {
      if (ev.type === 'job_accepted') jobId = ev.data.jobId as string
      return ev.type === 'token'
    })
    expect(jobId.length).toBeGreaterThan(0)

    // Drop the client mid-stream, then let the provider finish server-side.
    controller.abort()
    gated.release()

    const message = await waitForAssistantMessage()
    expect(message.role).toBe('char')
    expect(message.data).toBe('Hello')
    expect(message.chatId).toBe(jobId)
    // Persisted exactly once; generationId makes the write idempotent.
    const boot = await bootstrap()
    expect((await chatMessages(boot)).filter((m) => m.role === 'char')).toHaveLength(1)
  })

  it('retries a transient finalization failure without duplicating the assistant row', async () => {
    failNextGenerationPersistEvent = true
    providerImpl = () => {
      async function* g(): AsyncGenerator<CompletionStreamFrame> {
        yield { kind: 'token', content: 'retry me' }
        yield { kind: 'done', finishReason: 'stop' }
      }
      return g()
    }

    const controller = newController()
    const res = await postDurable({}, { signal: controller.signal })
    const events = await readSse(res, (ev) => ev.type === 'error' || ev.type === 'done')
    expect(events.some((e) => e.type === 'error')).toBe(true)

    await waitFor(async () => {
      const rows = generationFinalizationRetryRows()
      return rows.length === 0 ? true : undefined
    })
    const messages = await chatMessages(await bootstrap())
    const assistantMessages = messages.filter((m) => m.role === 'char')
    expect(assistantMessages).toHaveLength(1)
    expect(assistantMessages[0].data).toBe('retry me')
    controller.abort()
  })

  it('replays an already-persisted chat-var finalization retry as a no-op', async () => {
    await harness.app.close()
    rmSync(harness.dataDir, { recursive: true, force: true })
    harness = await startHarness({ finalizationRetry: false })
    ;({ assertion } = await setupAuthedClient(harness.app))
    failNextGenerationPersistEvent = true
    providerImpl = () => {
      async function* g(): AsyncGenerator<CompletionStreamFrame> {
        yield { kind: 'token', content: 'reply text' }
        yield { kind: 'done', finishReason: 'stop' }
      }
      return g()
    }
    await seedDatabase({
      ...fixtureDatabase,
      characters: [
        {
          ...fixtureDatabase.characters[0],
          triggerscript: [
            {
              comment: '',
              type: 'output',
              conditions: [],
              effect: [{ type: 'setvar', operator: '=', var: 'mood', value: 'happy' }],
            },
          ],
        },
      ],
    })

    const controller = newController()
    const res = await postDurable({}, { signal: controller.signal })
    const events = await readSse(res, (ev) => ev.type === 'error' || ev.type === 'done')
    expect(events.some((event) => event.type === 'error')).toBe(true)
    const jobId = jobIdFromEvents(events)

    await waitFor(async () => {
      const row = generationFinalizationRetryRows().find((retry) => retry.generation_id === jobId)
      return row?.status === 'pending' ? row : undefined
    })
    expect(commandEventTypeCount('generation.persisted')).toBe(1)
    const failedBoot = await bootstrap()
    expect(failedBoot.database.characters[0].chats[0].scriptstate).toEqual({ $mood: 'happy' })
    expect((await chatMessages(failedBoot)).filter((message) => message.role === 'char')).toHaveLength(1)

    await patchChatScriptstate({ $mood: 'user-edited' })
    const editedBoot = await bootstrap()
    const revisionBeforeRetry = editedBoot.revision
    expect(editedBoot.database.characters[0].chats[0].scriptstate).toEqual({ $mood: 'user-edited' })

    expect(retryQueuedFinalizationsOnce()).toEqual({
      attempted: 1,
      persisted: 1,
      terminal: 0,
      retryable: 0,
    })
    expect(generationFinalizationRetryRows()).toEqual([])

    const retriedBoot = await bootstrap()
    expect(retriedBoot.revision).toBe(revisionBeforeRetry)
    expect(retriedBoot.database.characters[0].chats[0].scriptstate).toEqual({ $mood: 'user-edited' })
    const assistantMessages = (await chatMessages(retriedBoot)).filter((message) => message.role === 'char')
    expect(assistantMessages).toHaveLength(1)
    expect(assistantMessages[0]).toMatchObject({ data: 'reply text', chatId: jobId })
    expect(commandEventTypeCount('generation.persisted')).toBe(1)
    controller.abort()
  })

  it('L2: prunes only terminal finalization retries older than retention', () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-generation-retention-'))
    const db = openDatabase(dataDir)
    try {
      seedGenerationFinalizationRetryRow(db, 'terminal-old', 'terminal', '2026-06-01T00:00:00.000Z')
      seedGenerationFinalizationRetryRow(db, 'terminal-recent', 'terminal', '2026-06-05T12:00:00.000Z')
      seedGenerationFinalizationRetryRow(db, 'pending-old', 'pending', '2026-06-01T00:00:00.000Z')

      expect(
        pruneTerminalGenerationFinalizationRetries(db, {
          now: '2026-06-06T00:00:00.000Z',
          retentionMs: 24 * 60 * 60 * 1000,
        }),
      ).toBe(1)

      expect(
        (
          db
            .prepare(
              `
                SELECT generation_id
                FROM generation_finalization_retries
                ORDER BY generation_id ASC
              `,
            )
            .all() as Array<{ generation_id: string }>
        ).map((row) => row.generation_id),
      ).toEqual(['pending-old', 'terminal-recent'])
    } finally {
      db.close()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('L2: app finalization retry sweep also removes retained terminal history', async () => {
    const db = new DatabaseSync(path.join(harness.dataDir, 'risu.db'))
    try {
      seedGenerationFinalizationRetryRow(db, 'terminal-app-old', 'terminal', '2020-01-01T00:00:00.000Z')
      seedGenerationFinalizationRetryRow(db, 'terminal-app-recent', 'terminal', new Date().toISOString())
    } finally {
      db.close()
    }

    await waitFor(async () => {
      const rows = generationFinalizationRetryRows()
      return rows.some((row) => row.generation_id === 'terminal-app-old') ? undefined : rows
    })

    expect(generationFinalizationRetryRows().map((row) => row.generation_id)).toEqual(['terminal-app-recent'])
  })

  // Drop the initial connection after it received prompt/info, reattach to the
  // still-running job, then let it produce the remaining tokens and terminal done.
  it('reattaches to an in-flight generation with prompt/info replayed (EC-D3)', async () => {
    const gated = makeGatedProvider({ before: 'Hel', after: 'lo' })
    providerImpl = gated.dispatchProvider

    const controller = newController()
    const res = await postDurable({}, { signal: controller.signal })
    let jobId = ''
    const initialEvents = await readSse(res, (ev) => {
      if (ev.type === 'job_accepted') jobId = ev.data.jobId as string
      return ev.type === 'token'
    })
    expect(jobId.length).toBeGreaterThan(0)
    expect(initialEvents.some((e) => e.type === 'prompt')).toBe(true)
    expect(initialEvents.some((e) => e.type === 'info')).toBe(true)
    // Drop the initial connection while the job is still gated (in-flight).
    controller.abort()

    // Reattach to the in-flight job, THEN release the remaining tokens — they stream
    // live to the reattached viewer.
    const reController = newController()
    const re = await fetch(`${harness.baseUrl}/api/v1/generate/chat/${encodeURIComponent(jobId)}/stream`, {
      headers: authHeaders(),
      signal: reController.signal,
    })
    expect(re.status).toBe(200)
    gated.release()
    const reEvents = await readSse(re, (ev) => ev.type === 'done')
    expect(reEvents[0]?.type).toBe('job_accepted')
    expect(reEvents.some((e) => e.type === 'prompt')).toBe(true)
    expect(reEvents.some((e) => e.type === 'info')).toBe(true)
    expect(reEvents.some((e) => e.type === 'token' && e.data.content === 'Hel')).toBe(true)
    expect(reEvents.some((e) => e.type === 'token' && e.data.content === 'lo')).toBe(true)
    expect(reEvents.at(-1)?.type).toBe('done')
    reController.abort()

    // The job ran to completion server-side and persisted the full result.
    const message = await waitForAssistantMessage()
    expect(message.data).toBe('Hello')
  })

  // Resume-after-reload: a fresh client (no in-memory jobId) discovers the running
  // job from bootstrap `activeGenerationJobs` and reattaches.
  it('surfaces a running generation in bootstrap activeGenerationJobs and frees it at completion', async () => {
    const gated = makeGatedProvider({ before: 'Hel', after: 'lo' })
    providerImpl = gated.dispatchProvider

    const controller = newController()
    const res = await postDurable({}, { signal: controller.signal })
    let jobId = ''
    await readSse(res, (ev) => {
      if (ev.type === 'job_accepted') jobId = ev.data.jobId as string
      return ev.type === 'token'
    })

    const boot = await bootstrap()
    // The projection carries the generating mode so reload-resume renders correctly.
    expect(boot.activeGenerationJobs).toContainEqual({ chatId: 'chat-1', jobId, mode: 'send' })

    // A fresh client reattaches via the discovered id.
    const reController = newController()
    const re = await fetch(`${harness.baseUrl}/api/v1/generate/chat/${encodeURIComponent(jobId)}/stream`, {
      headers: authHeaders(),
      signal: reController.signal,
    })
    gated.release()
    const reEvents = await readSse(re, (ev) => ev.type === 'done')
    expect(reEvents.at(-1)?.type).toBe('done')

    // The submission lock clears at completion, so bootstrap no longer lists it.
    await waitFor(async () => {
      const after = await bootstrap()
      return after.activeGenerationJobs.length === 0 ? true : undefined
    })
    controller.abort()
    reController.abort()
  })

  // Reattaching to an already-completed in-grace job must close server-side
  // instead of dangling the socket until the client hangs up.
  it('closes the connection itself when reattaching to an already-completed job (no leak)', async () => {
    providerImpl = () => {
      async function* g(): AsyncGenerator<CompletionStreamFrame> {
        yield { kind: 'token', content: 'final text' }
        yield { kind: 'done', finishReason: 'stop' }
      }
      return g()
    }

    const controllerA = newController()
    const resA = await postDurable({}, { signal: controllerA.signal })
    let jobId = ''
    await readSse(resA, (ev) => {
      if (ev.type === 'job_accepted') jobId = ev.data.jobId as string
      return ev.type === 'done'
    })
    controllerA.abort()
    await waitForAssistantMessage()

    // Reattach to the done (in-grace) job and read until the STREAM ENDS. The server
    // must close it on its own; if it leaks, readSse hangs to the test timeout.
    const reController = newController()
    const re = await fetch(`${harness.baseUrl}/api/v1/generate/chat/${encodeURIComponent(jobId)}/stream`, {
      headers: authHeaders(),
      signal: reController.signal,
    })
    const reEvents = await readSse(re, () => false)
    expect(reEvents.some((e) => e.type === 'job_accepted')).toBe(true)
    reController.abort()
  }, 8000)

  // Explicit cancel must push a terminal frame so a reattached observer's stream
  // ends cleanly.
  it('emits a terminal done to a reattached observer when the job is cancelled', async () => {
    const gated = makeGatedProvider({ before: 'partial' }) // never released
    providerImpl = gated.dispatchProvider

    const controllerA = newController()
    const resA = await postDurable({}, { signal: controllerA.signal })
    let jobId = ''
    await readSse(resA, (ev) => {
      if (ev.type === 'job_accepted') jobId = ev.data.jobId as string
      return ev.type === 'token'
    })

    const obsController = newController()
    const obs = await fetch(`${harness.baseUrl}/api/v1/generate/chat/${encodeURIComponent(jobId)}/stream`, {
      headers: authHeaders(),
      signal: obsController.signal,
    })
    const obsEventsPromise = readSse(obs, (ev) => ev.type === 'done')

    const del = await fetch(`${harness.baseUrl}/api/v1/generate/chat/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    expect(del.status).toBe(200)

    const obsEvents = await obsEventsPromise
    expect(obsEvents.at(-1)?.type).toBe('done')
    controllerA.abort()
    obsController.abort()
  }, 8000)

  it('rejects a second durable send while a generation is running for the chat (409)', async () => {
    const gated = makeGatedProvider({ before: 'one' })
    providerImpl = gated.dispatchProvider

    const controller = newController()
    const res1 = await postDurable({}, { signal: controller.signal })
    await readSse(res1, (ev) => ev.type === 'token')

    const res2 = await postDurable({})
    expect(res2.status).toBe(409)
    expect((await res2.json()).error).toBe('generation_in_progress')

    gated.release()
    controller.abort()
  })

  it('rejects a durable send from a stale (non-active) writer with 423', async () => {
    // writer-a claims the active-writer role via bootstrap.
    const claim = await fetch(`${harness.baseUrl}/api/v1/bootstrap`, {
      headers: authHeaders({ 'risu-writer-session': 'writer-a' }),
    })
    expect(claim.status).toBe(200)

    const res = await postDurable({}, { writerSession: 'writer-b' })
    expect(res.status).toBe(423)
    expect((await res.json()).error).toBe('active_writer_stale')

    // Nothing was started — bootstrap shows no active job and an empty transcript.
    const boot = await bootstrap()
    expect(boot.activeGenerationJobs).toEqual([])
    expect(await chatMessages(boot)).toEqual([])
  })

  // Explicit cancel aborts dispatch; a streaming cancel persists the
  // accumulated-so-far text raw.
  it('cancels a running generation via DELETE and persists the streamed-so-far text', async () => {
    const gated = makeGatedProvider({ before: 'partial reply' }) // never released
    providerImpl = gated.dispatchProvider

    const controller = newController()
    const res = await postDurable({}, { signal: controller.signal })
    let jobId = ''
    await readSse(res, (ev) => {
      if (ev.type === 'job_accepted') jobId = ev.data.jobId as string
      return ev.type === 'token'
    })

    const del = await fetch(`${harness.baseUrl}/api/v1/generate/chat/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    expect(del.status).toBe(200)
    expect((await del.json()).success).toBe(true)

    const message = await waitForAssistantMessage()
    expect(message.data).toBe('partial reply')
    controller.abort()
  })

  it('lets a new writer cancel a prior writer’s generation (writer handoff)', async () => {
    // writer-a claims, starts a generation, then "disconnects".
    await fetch(`${harness.baseUrl}/api/v1/bootstrap`, {
      headers: authHeaders({ 'risu-writer-session': 'writer-a' }),
    })
    const gated = makeGatedProvider({ before: 'partial' })
    providerImpl = gated.dispatchProvider
    const controller = newController()
    const res = await postDurable({}, { signal: controller.signal, writerSession: 'writer-a' })
    let jobId = ''
    await readSse(res, (ev) => {
      if (ev.type === 'job_accepted') jobId = ev.data.jobId as string
      return ev.type === 'token'
    })
    controller.abort()

    // writer-b becomes the active writer and cancels the abandoned job.
    await fetch(`${harness.baseUrl}/api/v1/bootstrap`, {
      headers: authHeaders({ 'risu-writer-session': 'writer-b' }),
    })
    const del = await fetch(`${harness.baseUrl}/api/v1/generate/chat/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
      headers: authHeaders({ 'risu-writer-session': 'writer-b' }),
    })
    expect(del.status).toBe(200)

    // After cancel the chat accepts a new generation (the slot is free).
    await waitFor(async () => {
      const boot = await bootstrap()
      return boot.activeGenerationJobs.length === 0 ? true : undefined
    })
  })

  // The durable path runs the post-gen pass, persists the scriptstate delta and
  // assistant message, and folds the bumped revision onto done.postGeneration.
  it('runs the A2 post-gen pass on the durable path and persists the derived result (EC-D1/A2)', async () => {
    providerImpl = () => {
      async function* g(): AsyncGenerator<CompletionStreamFrame> {
        yield { kind: 'token', content: 'reply text' }
        yield { kind: 'done', finishReason: 'stop' }
      }
      return g()
    }
    await seedDatabase({
      ...fixtureDatabase,
      characters: [
        {
          ...fixtureDatabase.characters[0],
          triggerscript: [
            {
              comment: '',
              type: 'output',
              conditions: [],
              effect: [{ type: 'setvar', operator: '=', var: 'mood', value: 'happy' }],
            },
          ],
        },
      ],
    })

    const controller = newController()
    const res = await postDurable({}, { signal: controller.signal })
    const events = await readSse(res, (ev) => ev.type === 'done')
    const done = events.at(-1)!
    expect(done.type).toBe('done')
    const postGeneration = done.data.postGeneration as {
      revision?: number
      messagePatch?: { chatVarMutations?: Array<{ key: string; after: unknown }> }
    }
    expect(postGeneration?.messagePatch?.chatVarMutations).toEqual([{ key: '$mood', before: null, after: 'happy' }])
    expect(typeof postGeneration?.revision).toBe('number')

    const boot = await bootstrap()
    // The derived scriptstate + the assistant message both persisted server-side.
    expect(boot.database.characters[0].chats[0].scriptstate).toEqual({ $mood: 'happy' })
    const assistant = (await chatMessages(boot)).find((m) => m.role === 'char')
    expect(assistant?.data).toBe('reply text')
    controller.abort()
  })

  it('rejects stale durable send finalization when the submitted user tail is truncated', async () => {
    await seedChatWithMessages([{ role: 'user', data: 'hi', chatId: 'msg-user-1' }])
    const gated = makeGatedProvider({ before: 'stale', after: ' reply' })
    providerImpl = gated.dispatchProvider

    const controller = newController()
    const res = await postDurable({}, { signal: controller.signal })
    const events = await readSse(res, (ev) => ev.type === 'token')
    const jobId = jobIdFromEvents(events)

    await truncateChat(null)
    gated.release()

    const terminal = await waitForTerminalFinalization(jobId)
    expect(terminal.terminal_error).toContain('stale')
    expect(await chatMessages(await bootstrap())).toEqual([])
    controller.abort()
  })

  it('rejects stale durable continue finalization when a newer row is appended after the target', async () => {
    await seedChatWithMessages([
      { role: 'user', data: 'story', chatId: 'msg-user-1' },
      { role: 'char', data: 'Once upon a time', chatId: 'msg-char-1', saying: 'char-1' },
    ])
    const gated = makeGatedProvider({ before: ' and then', after: ' something changed' })
    providerImpl = gated.dispatchProvider

    const controller = newController()
    const res = await postDurable({ mode: 'continue', userMessage: undefined }, { signal: controller.signal })
    const events = await readSse(res, (ev) => ev.type === 'token')
    const jobId = jobIdFromEvents(events)

    await appendMessage({ role: 'user', data: 'newer user turn', chatId: 'msg-user-2' })
    gated.release()

    const terminal = await waitForTerminalFinalization(jobId)
    expect(terminal.terminal_error).toContain('stale')
    const messages = await chatMessages(await bootstrap())
    expect(messages).toEqual([
      { role: 'user', data: 'story', chatId: 'msg-user-1' },
      { role: 'char', data: 'Once upon a time', chatId: 'msg-char-1', saying: 'char-1' },
      { role: 'user', data: 'newer user turn', chatId: 'msg-user-2' },
    ])
    controller.abort()
  })

  it('rejects stale durable regenerate finalization when the target assistant was edited', async () => {
    await seedChatWithMessages([
      { role: 'user', data: 'greet me', chatId: 'msg-user-1' },
      { role: 'char', data: 'old reply', chatId: 'msg-char-1', saying: 'char-1' },
    ])
    const gated = makeGatedProvider({ before: 'new', after: ' reply' })
    providerImpl = gated.dispatchProvider

    const controller = newController()
    const res = await postDurable(
      { mode: 'regenerate', regenerateMessageId: 'msg-char-1', userMessage: undefined },
      { signal: controller.signal },
    )
    const events = await readSse(res, (ev) => ev.type === 'token')
    const jobId = jobIdFromEvents(events)

    await patchMessage('msg-char-1', { data: 'edited old reply' })
    gated.release()

    const terminal = await waitForTerminalFinalization(jobId)
    expect(terminal.terminal_error).toContain('stale')
    const messages = await chatMessages(await bootstrap())
    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({ role: 'char', data: 'edited old reply', chatId: 'msg-char-1' })
    expect(messages.some((message) => message.data === 'new reply')).toBe(false)
    controller.abort()
  })

  // Durable continue / regenerate.
  // The durable job finalizes all three generating modes: continue extends the
  // last char row in place, regenerate replaces the target, and send appends.
  // Each survives a mid-stream disconnect, and streaming-cancel persistence is
  // mode-aware too.

  it('survives a disconnect on a durable continue and extends the row in place (Phase 6b)', async () => {
    await seedChatWithMessages([
      { role: 'user', data: 'tell me a story', chatId: 'msg-user-1' },
      { role: 'char', data: 'Once upon a time', chatId: 'msg-char-1', saying: 'char-1' },
    ])
    const gated = makeGatedProvider({ before: ' and they', after: ' lived happily.' })
    providerImpl = gated.dispatchProvider

    const controller = newController()
    const res = await postDurable({ mode: 'continue', userMessage: undefined }, { signal: controller.signal })
    await readSse(res, (ev) => ev.type === 'token')
    controller.abort() // disconnect mid-stream — the job must keep running

    gated.release()
    const extended = await waitFor(async () => {
      const row = (await chatMessages(await bootstrap())).find((m) => m.chatId === 'msg-char-1')
      return typeof row?.data === 'string' && row.data.includes('lived happily') ? row : undefined
    })
    expect(extended.data).toBe('Once upon a time and they lived happily.')
    // Extended the SAME row (id preserved); no duplicate appended.
    const messages = await chatMessages(await bootstrap())
    expect(messages).toHaveLength(2)
    expect(messages[1].chatId).toBe('msg-char-1')
  })

  it('survives a disconnect on a durable regenerate and replaces the target (Phase 6b)', async () => {
    await seedChatWithMessages([
      { role: 'user', data: 'greet me', chatId: 'msg-user-1' },
      { role: 'char', data: 'old reply', chatId: 'msg-char-1', saying: 'char-1' },
    ])
    const gated = makeGatedProvider({ before: 'a brand', after: ' new reply' })
    providerImpl = gated.dispatchProvider

    const controller = newController()
    const res = await postDurable(
      { mode: 'regenerate', regenerateMessageId: 'msg-char-1', userMessage: undefined },
      { signal: controller.signal },
    )
    await readSse(res, (ev) => ev.type === 'token')
    controller.abort()

    gated.release()
    const regenerated = await waitFor(async () => {
      const row = (await chatMessages(await bootstrap())).find((m) => m.role === 'char')
      return typeof row?.data === 'string' && row.data.includes('new reply') ? row : undefined
    })
    expect(regenerated.data).toBe('a brand new reply')
    // The old target was REPLACED in place (not duplicated): a single char row under
    // a fresh id, and the old text is gone.
    const messages = await chatMessages(await bootstrap())
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: 'user', chatId: 'msg-user-1' })
    expect(messages[1].chatId).not.toBe('msg-char-1')
    expect(messages.some((m) => m.data === 'old reply')).toBe(false)
  })

  it('appends a durable regenerate when the requested target was already truncated', async () => {
    await seedChatWithMessages([{ role: 'user', data: 'greet me', chatId: 'msg-user-1' }])
    providerImpl = () => {
      async function* gen(): AsyncGenerator<CompletionStreamFrame> {
        yield { kind: 'token', content: 'a brand new reply' }
        yield { kind: 'done', finishReason: 'stop' }
      }
      return gen()
    }

    const res = await postDurable({
      mode: 'regenerate',
      regenerateMessageId: 'stale-msg-char-1',
      userMessage: undefined,
    })
    const events = await readSse(res, (ev) => ev.type === 'done')
    expect(events.some((ev) => ev.type === 'error')).toBe(false)

    const appended = await waitFor(async () => {
      const row = (await chatMessages(await bootstrap())).find((m) => m.role === 'char')
      return row?.data === 'a brand new reply' ? row : undefined
    })
    expect(appended.chatId).not.toBe('stale-msg-char-1')

    const messages = await chatMessages(await bootstrap())
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: 'user', chatId: 'msg-user-1' })
    expect(messages[1]).toMatchObject({ role: 'char', data: 'a brand new reply' })
    expect(generationFinalizationRetryRows()).toEqual([])
  })

  it('preserves reroll alternates when durable regenerate follows client-side truncate', async () => {
    await seedChatWithMessages([
      { role: 'user', data: 'greet me', chatId: 'msg-user-1' },
      { role: 'char', data: 'old reply', chatId: 'msg-char-1', saying: 'char-1' },
    ])
    providerImpl = () => {
      async function* gen(): AsyncGenerator<CompletionStreamFrame> {
        yield { kind: 'token', content: 'a brand new reply' }
        yield { kind: 'done', finishReason: 'stop' }
      }
      return gen()
    }

    const boot = await bootstrap()
    const truncated = await fetch(`${harness.baseUrl}/api/v1/commands/chats/chat-1/messages/truncate`, {
      method: 'POST',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        baseRevision: boot.revision,
        afterMessageId: 'msg-user-1',
        preserveRemovedAsAlternates: true,
      }),
    })
    expect(truncated.status).toBe(200)

    const res = await postDurable({
      mode: 'regenerate',
      regenerateMessageId: 'msg-char-1',
      userMessage: undefined,
    })
    const events = await readSse(res, (ev) => ev.type === 'done')
    expect(events.some((ev) => ev.type === 'error')).toBe(false)

    const hydration = await chatHydration(await bootstrap())
    expect(hydration.message).toHaveLength(2)
    expect(hydration.message[0]).toMatchObject({ role: 'user', chatId: 'msg-user-1' })
    expect(hydration.message[1]).toMatchObject({ role: 'char', data: 'a brand new reply' })
    expect(hydration.alternates).toHaveLength(2)
    expect(hydration.alternates.some((m) => m.chatId === 'msg-char-1' && m.data === 'old reply')).toBe(true)
    expect(
      hydration.alternates.some((m) => m.chatId === hydration.message[1].chatId && m.data === 'a brand new reply'),
    ).toBe(true)
  })

  it('cancels a durable continue and extends the row with the streamed-so-far text (Phase 6b)', async () => {
    await seedChatWithMessages([
      { role: 'user', data: 'story', chatId: 'msg-user-1' },
      { role: 'char', data: 'Once upon a time', chatId: 'msg-char-1', saying: 'char-1' },
    ])
    const gated = makeGatedProvider({ before: ' and then' }) // never released
    providerImpl = gated.dispatchProvider

    const controller = newController()
    const res = await postDurable({ mode: 'continue', userMessage: undefined }, { signal: controller.signal })
    let jobId = ''
    await readSse(res, (ev) => {
      if (ev.type === 'job_accepted') jobId = ev.data.jobId as string
      return ev.type === 'token'
    })
    await cancelJob(jobId)

    const extended = await waitFor(async () => {
      const row = (await chatMessages(await bootstrap())).find((m) => m.chatId === 'msg-char-1')
      return typeof row?.data === 'string' && row.data.includes('and then') ? row : undefined
    })
    expect(extended.data).toBe('Once upon a time and then')
    expect(await chatMessages(await bootstrap())).toHaveLength(2) // extended in place
    controller.abort()
  })

  it('cancels a durable regenerate and replaces the target with the streamed-so-far text (Phase 6b)', async () => {
    await seedChatWithMessages([
      { role: 'user', data: 'greet me', chatId: 'msg-user-1' },
      { role: 'char', data: 'old reply', chatId: 'msg-char-1', saying: 'char-1' },
    ])
    const gated = makeGatedProvider({ before: 'partial regen' }) // never released
    providerImpl = gated.dispatchProvider

    const controller = newController()
    const res = await postDurable(
      { mode: 'regenerate', regenerateMessageId: 'msg-char-1', userMessage: undefined },
      { signal: controller.signal },
    )
    let jobId = ''
    await readSse(res, (ev) => {
      if (ev.type === 'job_accepted') jobId = ev.data.jobId as string
      return ev.type === 'token'
    })
    await cancelJob(jobId)

    await waitFor(async () => {
      const row = (await chatMessages(await bootstrap())).find((m) => m.role === 'char')
      return row?.data === 'partial regen' ? row : undefined
    })
    const messages = await chatMessages(await bootstrap())
    // Replaced the target with the partial text, not duplicated; old text gone.
    expect(messages).toHaveLength(2)
    expect(messages.some((m) => m.data === 'old reply')).toBe(false)
    expect(messages[1].chatId).not.toBe('msg-char-1')
    controller.abort()
  })

  it('surfaces the generating mode + regenerate target on activeGenerationJobs (Phase 6b reattach)', async () => {
    await seedChatWithMessages([
      { role: 'user', data: 'greet me', chatId: 'msg-user-1' },
      { role: 'char', data: 'old reply', chatId: 'msg-char-1', saying: 'char-1' },
    ])
    const gated = makeGatedProvider({ before: 'partial' }) // never released — keeps the job running
    providerImpl = gated.dispatchProvider

    const controller = newController()
    const res = await postDurable(
      { mode: 'regenerate', regenerateMessageId: 'msg-char-1', userMessage: undefined },
      { signal: controller.signal },
    )
    let jobId = ''
    await readSse(res, (ev) => {
      if (ev.type === 'job_accepted') jobId = ev.data.jobId as string
      return ev.type === 'token'
    })

    const boot = await bootstrap()
    expect(boot.activeGenerationJobs).toContainEqual({
      chatId: 'chat-1',
      jobId,
      mode: 'regenerate',
      regenerateMessageId: 'msg-char-1',
    })
    gated.release()
    controller.abort()
  })

  it('rejects a second durable generation (continue) while one is running for the chat (409)', async () => {
    await seedChatWithMessages([
      { role: 'user', data: 'story', chatId: 'msg-user-1' },
      { role: 'char', data: 'Once upon a time', chatId: 'msg-char-1', saying: 'char-1' },
    ])
    const gated = makeGatedProvider({ before: ' more' })
    providerImpl = gated.dispatchProvider

    const controller = newController()
    const res1 = await postDurable({ mode: 'continue', userMessage: undefined }, { signal: controller.signal })
    await readSse(res1, (ev) => ev.type === 'token')

    const res2 = await postDurable({ mode: 'continue', userMessage: undefined })
    expect(res2.status).toBe(409)
    expect((await res2.json()).error).toBe('generation_in_progress')

    gated.release()
    controller.abort()
  })

  // If the target chat is gone at completion, persistence fails gracefully with a
  // job error and no bad write.
  it('records a job error when the target chat vanishes mid-generation (gotcha C)', async () => {
    const gated = makeGatedProvider({ before: 'Hel', after: 'lo' })
    providerImpl = gated.dispatchProvider

    const controller = newController()
    const res = await postDurable({}, { signal: controller.signal })
    let jobId = ''
    const live: ParsedEvent[] = []
    // Read live on this connection through to a terminal frame.
    const livePromise = (async () => {
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let idx: number
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            const ev = parseSseBlock(block)
            if (!ev) continue
            if (ev.type === 'job_accepted') jobId = ev.data.jobId as string
            live.push(ev)
            if (ev.type === 'error' || ev.type === 'done') return
          }
        }
      } catch {
        /* dropped */
      }
    })()

    await waitFor(async () => (jobId.length > 0 ? true : undefined))
    // Replace the whole database so chat-1 no longer exists, then let the job finish.
    await seedDatabase({
      ...fixtureDatabase,
      characters: [{ ...fixtureDatabase.characters[0], chats: [] }],
    })
    gated.release()
    await livePromise

    expect(live.some((e) => e.type === 'error')).toBe(true)
    // No bad write: the imported db has no chat-1 to receive a message.
    const boot = await bootstrap()
    expect(boot.database.characters[0].chats).toEqual([])
    const terminalRow = await waitFor(async () => {
      const row = generationFinalizationRetryRows()[0]
      return row?.status === 'terminal' ? row : undefined
    })
    expect(terminalRow.failure_count).toBeGreaterThan(0)
    expect(terminalRow.terminal_error).toContain('Chat not found')
    controller.abort()
  })

  // A bare disconnect must NOT cancel — the job runs to completion (let-it-finish).
  it('does not cancel on a bare disconnect (the generation completes) ', async () => {
    const gated = makeGatedProvider({ before: 'Hel', after: 'lo' })
    providerImpl = gated.dispatchProvider

    const controller = newController()
    const res = await postDurable({}, { signal: controller.signal })
    await readSse(res, (ev) => ev.type === 'token')
    controller.abort() // disconnect only — no DELETE

    gated.release()
    const message = await waitForAssistantMessage()
    expect(message.data).toBe('Hello')
  })

  it('returns 404 reattaching/cancelling an unknown job', async () => {
    const re = await fetch(`${harness.baseUrl}/api/v1/generate/chat/no-such-job/stream`, {
      headers: authHeaders(),
    })
    expect(re.status).toBe(404)
    const del = await fetch(`${harness.baseUrl}/api/v1/generate/chat/no-such-job`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    expect(del.status).toBe(404)
  })

  // A non-durable send (no durable flag) keeps the inline connection-scoped flow and
  // is NOT tracked as an active generation job.
  it('leaves a non-durable send on the inline flow (no active job tracked)', async () => {
    providerImpl = () => {
      async function* g(): AsyncGenerator<CompletionStreamFrame> {
        yield { kind: 'token', content: 'inline reply' }
        yield { kind: 'done', finishReason: 'stop' }
      }
      return g()
    }
    const res = await postDurable({ durable: false })
    const events = await readSse(res, (ev) => ev.type === 'done')
    expect(events.some((e) => e.type === 'job_accepted')).toBe(false)
    expect(events.at(-1)?.type).toBe('done')
    const boot = await bootstrap()
    expect(boot.activeGenerationJobs).toEqual([])
  })

  // Shutdown must settle detached runners BEFORE closing the SQLite handle, so
  // the aborted runner's cancel-persist lands in an open database (audit L13).
  it('settles detached runners before closing the database on shutdown (L13)', async () => {
    const gated = makeGatedProvider({ before: 'partial shutdown text' }) // never released
    providerImpl = gated.dispatchProvider
    const local = await startHarness()
    let localDataDirKept: string | null = local.dataDir
    try {
      const { assertion: localAssertion } = await setupAuthedClient(local.app)
      await seedDatabaseForHarness(local, localAssertion, fixtureDatabase)

      const controller = newController()
      const res = await fetch(`${local.baseUrl}/api/v1/generate/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'risu-auth': localAssertion },
        body: JSON.stringify({
          chatId: 'chat-1',
          characterId: 'char-1',
          mode: 'send',
          userMessage: 'hi',
          durable: true,
        }),
        signal: controller.signal,
      })
      await readSse(res, (ev) => ev.type === 'token')
      controller.abort() // bare disconnect; the job keeps running

      // Shutdown aborts the job; the runner's cancel path persists the
      // streamed-so-far text — it must land before db.close(), not race it.
      await local.app.close()

      const db = new DatabaseSync(path.join(local.dataDir, 'risu.db'), { readOnly: true })
      try {
        const rows = db
          .prepare("SELECT data FROM messages WHERE chat_id = 'chat-1' AND alternate = 0 ORDER BY seq")
          .all() as Array<{ data: string }>
        expect(rows.map((row) => row.data)).toContain('partial shutdown text')
      } finally {
        db.close()
      }
    } finally {
      if (localDataDirKept) rmSync(localDataDirKept, { recursive: true, force: true })
      localDataDirKept = null
    }
  })

  // A long silent window (slow assembly / provider connect) must not look idle
  // to intermediary proxies: the viewer gets SSE comment heartbeats, which are
  // invisible to the frame parser and never enter the replay buffer (audit L14).
  it('heartbeats the durable SSE viewer during silent windows (L14)', async () => {
    const gated = makeGatedProvider({ before: 'Hel', after: 'lo' })
    providerImpl = gated.dispatchProvider
    const local = await startHarness({ viewerHeartbeatMs: 25 })
    try {
      const { assertion: localAssertion } = await setupAuthedClient(local.app)
      await seedDatabaseForHarness(local, localAssertion, fixtureDatabase)

      const controller = newController()
      const res = await fetch(`${local.baseUrl}/api/v1/generate/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'risu-auth': localAssertion },
        body: JSON.stringify({
          chatId: 'chat-1',
          characterId: 'char-1',
          mode: 'send',
          userMessage: 'hi',
          durable: true,
        }),
        signal: controller.signal,
      })

      // Read raw SSE text: the provider is gated after the first token, so the
      // stream goes silent — the comment heartbeat must arrive on its own.
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let raw = ''
      let jobId = ''
      const deadline = Date.now() + 5_000
      while (!raw.includes(': heartbeat\n\n')) {
        if (Date.now() > deadline) throw new Error('no viewer heartbeat observed')
        const { value, done } = await reader.read()
        if (done) break
        raw += decoder.decode(value, { stream: true })
        const accepted = /event: job_accepted\ndata: (\{[^\n]*\})/.exec(raw)
        if (accepted) jobId = (JSON.parse(accepted[1]) as { jobId: string }).jobId
      }
      expect(raw).toContain(': heartbeat\n\n')
      expect(jobId).not.toBe('')
      controller.abort()

      // Heartbeats are per-viewer keep-alives: the reattach replay buffer must
      // not contain them.
      gated.release()
      const re = await fetch(`${local.baseUrl}/api/v1/generate/chat/${encodeURIComponent(jobId)}/stream`, {
        headers: { 'risu-auth': localAssertion },
      })
      const replayEvents = await readSse(re, (ev) => ev.type === 'done')
      expect(replayEvents.at(-1)?.type).toBe('done')
    } finally {
      await local.app.close()
      rmSync(local.dataDir, { recursive: true, force: true })
    }
  })
})
