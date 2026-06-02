import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { setupAuthedClient } from './helpers/auth.js'

interface Harness {
  app: FastifyInstance
  dataDir: string
}

interface ProtocolMetric {
  metric: string
  type?: string
  resource?: string
  revision?: number
  status?: string
  loadMs?: number
  cloneMutateMs?: number
  sqliteSyncMs?: number
  dbJsonWriteMs?: number
  totalMs?: number
  mutationPath?: string
}

const COMMAND_METRIC_SECTIONS = [
  'loadMs',
  'cloneMutateMs',
  'sqliteSyncMs',
  'dbJsonWriteMs',
  'totalMs',
] as const

type CommandMetricSection = (typeof COMMAND_METRIC_SECTIONS)[number]

const COMMAND_METRIC_REVIEW_GATES = {
  'message-free': {
    reviewGate: 'message-free commands should avoid message history synchronization work',
    sections: COMMAND_METRIC_SECTIONS,
  },
  'targeted-message': {
    reviewGate: 'targeted message commands should not rewrite db.json',
    sections: COMMAND_METRIC_SECTIONS,
    dbJsonWriteMs: 0,
  },
  'targeted-generation': {
    reviewGate: 'targeted generation persistence should not rewrite db.json',
    sections: COMMAND_METRIC_SECTIONS,
    dbJsonWriteMs: 0,
  },
  'targeted-character-selection': {
    reviewGate: 'character selection should update only the selected character row and settings',
    sections: COMMAND_METRIC_SECTIONS,
    dbJsonWriteMs: 0,
  },
} satisfies Record<
  string,
  {
    reviewGate: string
    sections: readonly CommandMetricSection[]
    dbJsonWriteMs?: number
  }
>

interface CommandRequest {
  method: 'DELETE' | 'PATCH' | 'POST' | 'PUT'
  url: string
  headers?: Record<string, string>
  payload?: unknown
}

interface CommandResponse {
  statusCode: number
  json(): unknown
}

const PREVIOUS_PROTOCOL_METRICS = process.env.RISU_PROTOCOL_METRICS

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-command-metrics-'))
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 20 * 1024 * 1024,
      importMaxBytes: Infinity,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
    assetGc: false,
    memoryWorker: false,
  })
  return { app, dataDir }
}

let harness: Harness
let assertion: string
let infoSpy: ReturnType<typeof vi.spyOn>
let metrics: ProtocolMetric[]

beforeEach(async () => {
  process.env.RISU_PROTOCOL_METRICS = '1'
  metrics = []
  infoSpy = vi.spyOn(console, 'info').mockImplementation((message: unknown) => {
    if (typeof message !== 'string' || !message.startsWith('[protocol-metric] ')) return
    metrics.push(JSON.parse(message.slice('[protocol-metric] '.length)) as ProtocolMetric)
  })
  harness = await startHarness()
  ;({ assertion } = await setupAuthedClient(harness.app))
})

afterEach(async () => {
  infoSpy.mockRestore()
  if (PREVIOUS_PROTOCOL_METRICS === undefined) {
    delete process.env.RISU_PROTOCOL_METRICS
  } else {
    process.env.RISU_PROTOCOL_METRICS = PREVIOUS_PROTOCOL_METRICS
  }
  await harness.app.close()
  rmSync(harness.dataDir, { recursive: true, force: true })
})

async function importDatabase(database: unknown): Promise<number> {
  const res = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    headers: { 'risu-auth': assertion },
    payload: { database },
  })
  expect(res.statusCode).toBe(200)
  return res.json().revision as number
}

async function commandMetric(
  expectedType: string,
  request: CommandRequest,
): Promise<{ revision: number; metric: ProtocolMetric }> {
  const before = metrics.length
  const inject = harness.app.inject as unknown as (
    request: CommandRequest,
  ) => Promise<CommandResponse>
  const res = await inject({
    ...request,
    headers: { 'risu-auth': assertion, ...(request.headers ?? {}) },
  })
  expect(res.statusCode).toBe(200)
  const body = res.json() as { revision: number }
  const metric = metrics
    .slice(before)
    .find((entry) => entry.metric === 'command_mutation' && entry.status === 'ok')
  expect(metric, `missing command_mutation metric for ${expectedType}`).toBeTruthy()
  expect(metric?.type).toBe(expectedType)
  return { revision: body.revision, metric: metric as ProtocolMetric }
}

function makeLargeCommandDatabase(): Record<string, unknown> {
  return {
    currentChar: 0,
    streamGeminiThoughts: false,
    theme: 'dark',
    promptSettings: {
      assistantPrefill: '',
      postEndInnerFormat: '',
      sendChatAsSystem: false,
      sendName: false,
      utilOverride: false,
    },
    pluginCustomStorage: {
      existing: { mode: 'baseline' },
    },
    characters: Array.from({ length: 12 }, (_, characterIndex) => ({
      type: 'character',
      name: `Character ${characterIndex}`,
      chaId: `char-${characterIndex}`,
      utilityBot: false,
      chatPage: 0,
      desc: `Description ${characterIndex}`,
      firstMessage: 'Hello.',
      chats: Array.from({ length: 8 }, (_, chatIndex) => ({
        id: `chat-${characterIndex}-${chatIndex}`,
        note: '',
        name: `Chat ${characterIndex}/${chatIndex}`,
        localLore: [],
        fmIndex: -1,
        message: Array.from({ length: 40 }, (_, messageIndex) => ({
          role: messageIndex % 2 === 0 ? 'user' : 'char',
          data: `Message ${characterIndex}/${chatIndex}/${messageIndex} `.repeat(3),
          chatId: `msg-${characterIndex}-${chatIndex}-${messageIndex}`,
        })),
      })),
    })),
  }
}

function commandMetricReviewGate(metric: ProtocolMetric) {
  const mutationPath = metric.mutationPath
  expect(mutationPath, `missing mutationPath for ${metric.type}`).toBeTruthy()
  const gate = COMMAND_METRIC_REVIEW_GATES[mutationPath as keyof typeof COMMAND_METRIC_REVIEW_GATES]
  expect(gate, `missing command metric review gate for ${mutationPath}`).toBeTruthy()
  return gate
}

describe('command protocol metrics', () => {
  it('records comparable command-family timings on a message-heavy save', async () => {
    let revision = await importDatabase(makeLargeCommandDatabase())
    metrics = []

    const settings = await commandMetric('settings.updated', {
      method: 'PATCH',
      url: '/api/v1/commands/settings/runtime',
      payload: { baseRevision: revision, patch: { streamGeminiThoughts: true } },
    })
    revision = settings.revision

    const pluginStorage = await commandMetric('pluginStorage.updated', {
      method: 'PUT',
      url: '/api/v1/commands/plugin-storage/bench',
      payload: { baseRevision: revision, value: { mode: 'updated', count: 1 } },
    })
    revision = pluginStorage.revision

    const chat = await commandMetric('chat.updated', {
      method: 'PATCH',
      url: '/api/v1/commands/chats/chat-0-0',
      payload: { baseRevision: revision, patch: { name: 'Measured Chat' } },
    })
    revision = chat.revision

    const characterSelect = await commandMetric('character.selected', {
      method: 'POST',
      url: '/api/v1/commands/characters/select',
      payload: {
        baseRevision: revision,
        characterId: 'char-1',
        lastInteraction: 123456,
      },
    })
    revision = characterSelect.revision

    const messageAppend = await commandMetric('message.appended', {
      method: 'POST',
      url: '/api/v1/commands/chats/chat-0-0/messages',
      payload: {
        baseRevision: revision,
        message: { role: 'user', data: 'Measured append', chatId: 'msg-measured-append' },
      },
    })
    revision = messageAppend.revision

    const messageUpdate = await commandMetric('message.updated', {
      method: 'PATCH',
      url: '/api/v1/commands/messages/msg-measured-append',
      payload: { baseRevision: revision, patch: { data: 'Measured update' } },
    })
    revision = messageUpdate.revision

    const messageDelete = await commandMetric('message.deleted', {
      method: 'DELETE',
      url: '/api/v1/commands/messages/msg-measured-append',
      payload: { baseRevision: revision },
    })
    revision = messageDelete.revision

    const messageTruncate = await commandMetric('message.truncated', {
      method: 'POST',
      url: '/api/v1/commands/chats/chat-0-0/messages/truncate',
      payload: { baseRevision: revision, afterMessageId: 'msg-0-0-10' },
    })
    revision = messageTruncate.revision

    const messageReplace = await commandMetric('messages.replaced', {
      method: 'PUT',
      url: '/api/v1/commands/chats/chat-0-0/messages',
      payload: {
        baseRevision: revision,
        messages: [
          { role: 'user', data: 'Measured replacement 1', chatId: 'msg-measured-replace-1' },
          { role: 'char', data: 'Measured replacement 2', chatId: 'msg-measured-replace-2' },
        ],
      },
    })
    revision = messageReplace.revision

    const generation = await commandMetric('generation.persisted', {
      method: 'POST',
      url: '/api/v1/commands/chats/chat-0-0/generation-result',
      payload: {
        baseRevision: revision,
        generationResult: {
          message: {
            role: 'char',
            data: 'Measured generated reply',
            chatId: 'msg-measured-generation',
            promptInfo: {},
            generationInfo: {},
          },
        },
      },
    })

    const measured = [
      settings,
      pluginStorage,
      chat,
      characterSelect,
      messageAppend,
      messageUpdate,
      messageDelete,
      messageTruncate,
      messageReplace,
      generation,
    ].map(({ metric }) => metric)
    for (const metric of measured) {
      expect(metric.resource).toBeTruthy()
      expect(metric.revision).toBeGreaterThan(1)
      const gate = commandMetricReviewGate(metric)
      for (const section of gate.sections) {
        expect(metric[section], `${metric.type}.${section}`).toBeGreaterThanOrEqual(0)
      }
      if ('dbJsonWriteMs' in gate && typeof gate.dbJsonWriteMs === 'number') {
        expect(metric.dbJsonWriteMs).toBe(gate.dbJsonWriteMs)
      }
    }

    const noMessageFamilies = measured.filter(
      (metric) => metric.type === 'settings.updated' || metric.type === 'pluginStorage.updated',
    )
    expect(noMessageFamilies).toHaveLength(2)
    for (const metric of noMessageFamilies) {
      expect(metric.sqliteSyncMs).toBeGreaterThanOrEqual(0)
    }
    expect(settings.metric.mutationPath).toBe('message-free')
    expect(pluginStorage.metric.mutationPath).toBe('message-free')
    expect(chat.metric.mutationPath).toBe('message-free')
    expect(characterSelect.metric.mutationPath).toBe('targeted-character-selection')
    for (const metric of [
      messageAppend.metric,
      messageUpdate.metric,
      messageDelete.metric,
      messageTruncate.metric,
      messageReplace.metric,
    ]) {
      expect(metric.mutationPath).toBe('targeted-message')
      expect(metric.dbJsonWriteMs).toBe(0)
    }
    expect(generation.metric.mutationPath).toBe('targeted-generation')

    if (process.env.RISU_COMMAND_METRIC_SUMMARY === '1') {
      console.log(
        JSON.stringify(
          measured.map((metric) => ({
            type: metric.type,
            resource: metric.resource,
            mutationPath: metric.mutationPath,
            reviewGate: commandMetricReviewGate(metric).reviewGate,
            loadMs: metric.loadMs,
            cloneMutateMs: metric.cloneMutateMs,
            sqliteSyncMs: metric.sqliteSyncMs,
            dbJsonWriteMs: metric.dbJsonWriteMs,
            totalMs: metric.totalMs,
          })),
          null,
          2,
        ),
      )
    }
  })
})
