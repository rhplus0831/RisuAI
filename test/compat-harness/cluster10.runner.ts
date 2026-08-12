import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/ts/storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'fixture-auth-token',
}))

vi.mock('../../src/ts/process/scripts', () => ({
  processScript: async (_character: unknown, data: string) => data,
  processScriptFull: async (_character: unknown, data: string) => ({ data, emoChanged: false }),
  risuChatParser: (data: string) => data,
}))

vi.mock('../../src/ts/process/modules', async (importActual) => {
  const actual = await importActual<typeof import('../../src/ts/process/modules')>()
  return { ...actual, moduleUpdate: () => undefined }
})

import { JobRegistry, type JobClient } from '../../server/fastify/src/streamJobs'
import { getResourceDatabase } from '../../src/ts/server/resourceState.svelte'
import { withTrustedResourceWrite } from '../../src/ts/server/resourceWriteGuard.svelte'
import { consumeStreamResponse } from '../../src/ts/process/postGeneration/streamResponse'
import { requestServerChatGeneration } from '../../src/ts/process/request/serverChat'
import type { StreamResponseChunk, requestDataResponse } from '../../src/ts/process/request/request'
import {
  setDatabase,
  type Database,
  type MessageGenerationInfo,
  type character,
} from '../../src/ts/storage/database.svelte'
import { selectedCharID } from '../../src/ts/stores.svelte'
import type { Cluster10Artifact } from './types'

const OUTPUT_PATH = process.env.COMPAT_HARNESS_CLUSTER10_OUTPUT
const cluster10: Cluster10Artifact = {
  schemaVersion: 1,
  replayCapCanonicalTerminal: {
    reproduced: false,
    retainedEventTypes: [],
    clientStatus: 'not-run',
    canonicalTerminalResult: '',
  },
  retriedExtendContinueDuplicate: {
    reproduced: false,
    afterFirstAttempt: '',
    duringRetry: '',
    canonicalTerminalResult: '',
    afterCanonicalTerminal: '',
  },
}

function eventType(frame: string): string {
  return frame.match(/^event: ([^\n]+)/m)?.[1] ?? '<unknown>'
}

function collectingClient(messages: string[]): JobClient {
  let open = true
  return {
    get open() {
      return open
    },
    bufferedBytes: 0,
    send(frame) {
      messages.push(typeof frame === 'string' ? frame : frame.toString('utf8'))
    },
    close() {
      open = false
    },
  }
}

function oneChunkStream(chunk: string, fail: boolean): ReadableStream<StreamResponseChunk> {
  return new ReadableStream<StreamResponseChunk>({
    start(controller) {
      controller.enqueue({ compat: chunk })
      if (fail) controller.error(new Error('injected reattach transport failure'))
      else controller.close()
    },
  })
}

function pendingChunkStream(chunk: string): {
  stream: ReadableStream<StreamResponseChunk>
  fail(error: Error): void
} {
  let controller!: ReadableStreamDefaultController<StreamResponseChunk>
  return {
    stream: new ReadableStream<StreamResponseChunk>({
      start(activeController) {
        controller = activeController
        controller.enqueue({ compat: chunk })
      },
    }),
    fail(error) {
      controller.error(error)
    },
  }
}

function extendRequest(
  stream: ReadableStream<StreamResponseChunk>,
): Extract<requestDataResponse, { type: 'streaming' }> {
  return {
    type: 'streaming',
    result: stream,
    continueDisposition: 'extend',
  } as Extract<requestDataResponse, { type: 'streaming' }>
}

function retryFixtureCharacter(): character {
  return {
    type: 'character',
    name: 'Compat Character',
    chaId: 'compat-char',
    chatPage: 0,
    reloadKeys: 0,
    chats: [
      {
        id: 'compat-chat',
        name: 'main',
        note: '',
        localLore: [],
        message: [
          { role: 'user', data: 'Seed question.', chatId: 'fixture-user-1' },
          { role: 'char', data: 'Seed answer.', chatId: 'fixture-assistant-1', saying: 'compat-char' },
        ],
      },
    ],
    firstMessage: '',
    desc: '',
    notes: '',
    image: '',
    emotionImages: [],
    bias: [],
    viewScreen: 'none',
    globalLore: [],
    chaVer: 0,
  } as unknown as character
}

describe('cluster 10 fault-seam reproductions', () => {
  let originalFetch: typeof globalThis.fetch

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch
  })

  afterAll(async () => {
    if (!OUTPUT_PATH) throw new Error('COMPAT_HARNESS_CLUSTER10_OUTPUT is required')
    await mkdir(dirname(OUTPUT_PATH), { recursive: true })
    await writeFile(OUTPUT_PATH, `${JSON.stringify(cluster10, null, 2)}\n`, 'utf8')
  })

  it('replay event cap can evict prompt while the canonical terminal remains recoverable', async () => {
    originalFetch = globalThis.fetch
    const snapshotDir = mkdtempSync(resolve(tmpdir(), 'risu-compat-replay-'))
    const registry = new JobRegistry({
      replayMaxEvents: 1,
      replayMaxBytes: 64 * 1024,
      replayMaxAggregateBytes: 64 * 1024,
      replaySnapshotDir: snapshotDir,
    })
    const job = registry.create({ id: 'cluster10-cap', timeoutMs: 60_000, heartbeatSec: 10 })
    registry.enableReplay(job)
    registry.pushRaw(job, 'event: prompt\ndata: {"promptInfo":{},"formated":[]}\n\n')
    registry.pushRaw(
      job,
      'event: info\ndata: {"generationId":"cluster10-generation","generationInfo":{"model":"gpt4o"}}\n\n',
    )
    registry.pushRaw(
      job,
      'event: done\ndata: {"result":"Canonical terminal reply.","generationId":"cluster10-generation","generationInfo":{"model":"gpt4o"}}\n\n',
    )
    registry.markDone(job)

    const frames: string[] = []
    registry.attach(job.id, collectingClient(frames))
    const terminal = registry.readTerminalSnapshot(job.id)
    expect(terminal).not.toBeNull()

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith('/terminal-snapshot')) {
        return new Response(terminal, { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(frames.join(''), {
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'x-risu-job-id': job.id },
      })
    }) as typeof globalThis.fetch

    const result = await requestServerChatGeneration(
      { chatId: 'compat-chat', characterId: 'compat-char', mode: 'continue' },
      null,
      job.id,
    )
    const parsedTerminal = JSON.parse(terminal!) as { result: string }
    cluster10.replayCapCanonicalTerminal = {
      reproduced: result.status === 'error' && result.error === 'stream ended without a prompt event',
      retainedEventTypes: frames.map(eventType),
      clientStatus: result.status,
      ...(result.status === 'error' ? { clientError: result.error } : {}),
      canonicalTerminalResult: parsedTerminal.result,
    }

    expect(cluster10.replayCapCanonicalTerminal.reproduced).toBe(true)
    expect(frames.map(eventType)).not.toContain('prompt')
    expect(parsedTerminal.result).toBe('Canonical terminal reply.')
    registry.cleanup(job.id)
    rmSync(snapshotDir, { recursive: true, force: true })
  })

  it('retrying an extend-continue reattach captures the partial as a new prefix', async () => {
    const currentChar = retryFixtureCharacter()
    setDatabase({ characters: [currentChar] } as Database)
    selectedCharID.set(0)
    const base = {
      arg: { continue: true },
      nowChatroom: currentChar,
      currentChar,
      selectedChar: 0,
      selectedChat: 0,
      targetCharacterId: 'compat-char',
      targetChatId: 'compat-chat',
      generationId: 'cluster10-generation',
      generationInfo: { generationId: 'cluster10-generation' } as MessageGenerationInfo,
      promptInfo: {},
      abortSignal: new AbortController().signal,
      reformatContent: (data: string) => data,
      skipEditOutput: true,
      renderFlushScheduler: (flush: () => void) => flush(),
    }

    const target = () => getResourceDatabase().characters[0].chats[0].message[1]
    const failedStream = pendingChunkStream(' Continued reply.')
    const failedAttempt = consumeStreamResponse({ ...base, req: extendRequest(failedStream.stream) })
    await vi.waitFor(() => expect(target().data).toBe('Seed answer. Continued reply.'))
    failedStream.fail(new Error('injected reattach transport failure'))
    await expect(failedAttempt).rejects.toThrow('injected reattach transport failure')
    const afterFirstAttempt = target().data

    await consumeStreamResponse({ ...base, req: extendRequest(oneChunkStream(' Continued reply.', false)) })
    const duringRetry = target().data
    const canonicalTerminalResult = 'Seed answer. Continued reply.'
    withTrustedResourceWrite(() => {
      target().data = canonicalTerminalResult
    })
    const afterCanonicalTerminal = target().data

    cluster10.retriedExtendContinueDuplicate = {
      reproduced: duringRetry === 'Seed answer. Continued reply. Continued reply.',
      afterFirstAttempt,
      duringRetry,
      canonicalTerminalResult,
      afterCanonicalTerminal,
    }
    expect(cluster10.retriedExtendContinueDuplicate.reproduced).toBe(true)
    expect(afterCanonicalTerminal).toBe(canonicalTerminalResult)
  })
})
