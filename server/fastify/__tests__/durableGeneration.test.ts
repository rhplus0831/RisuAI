import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import type { CompletionStreamFrame } from '../src/generation/frames.js'
import type { ChatProviderDispatcher } from '../src/routes/generationChat.js'

// Durable generation (Milestone 1) lives on a *detached* job whose lifecycle is
// not tied to the request connection, so these go through a real listening server
// + `fetch` (not `app.inject`, which buffers the whole response and cannot model a
// mid-stream disconnect / reattach).

interface Harness {
  app: FastifyInstance
  dataDir: string
  baseUrl: string
}

// The injected provider is swapped per test through this stable indirection, so the
// app is built once per test with a provider that delegates to the current impl.
let providerImpl: ChatProviderDispatcher = () => {
  async function* g(): AsyncGenerator<CompletionStreamFrame> {
    yield { kind: 'done', finishReason: 'stop' }
  }
  return g()
}

const openControllers = new Set<AbortController>()

function newController(): AbortController {
  const controller = new AbortController()
  openControllers.add(controller)
  return controller
}

async function startHarness(): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-durable-'))
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
    generationChat: { dispatchProvider: (ctx) => providerImpl(ctx) },
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const addr = app.server.address() as AddressInfo
  return { app, dataDir, baseUrl: `http://127.0.0.1:${addr.port}` }
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

let harness: Harness

beforeEach(async () => {
  providerImpl = () => {
    async function* g(): AsyncGenerator<CompletionStreamFrame> {
      yield { kind: 'done', finishReason: 'stop' }
    }
    return g()
  }
  harness = await startHarness()
  await seedDatabase(fixtureDatabase)
})

afterEach(async () => {
  for (const controller of openControllers) controller.abort()
  openControllers.clear()
  await harness.app.close()
  rmSync(harness.dataDir, { recursive: true, force: true })
})

async function seedDatabase(database: unknown): Promise<void> {
  const res = await fetch(`${harness.baseUrl}/api/v1/import/risusave`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ database }),
  })
  expect(res.status).toBe(200)
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
  const headers: Record<string, string> = { 'content-type': 'application/json' }
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
  activeGenerationJobs: Array<{ chatId: string; jobId: string }>
  database: { characters: Array<{ chats: Array<{ message: Array<Record<string, unknown>>; scriptstate?: Record<string, unknown> }> }> }
  revision: number
}> {
  const res = await fetch(`${harness.baseUrl}/api/v1/bootstrap`)
  expect(res.status).toBe(200)
  return (await res.json()) as never
}

async function chatMessages(
  boot: Awaited<ReturnType<typeof bootstrap>>,
): Promise<Array<Record<string, unknown>>> {
  // Phase 4.3: the bootstrap ships chat stubs (message-free); read the persisted
  // messages via the per-chat hydration endpoint.
  const chat = boot.database.characters[0]?.chats[0] as { id?: string } | undefined
  if (!chat?.id) return []
  const res = await fetch(
    `${harness.baseUrl}/api/v1/projection/chatMessages?id=${encodeURIComponent(chat.id)}`,
  )
  expect(res.status).toBe(200)
  return ((await res.json()) as { message: Array<Record<string, unknown>> }).message
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

describe('Durable generation (Milestone 1)', () => {
  // EC-D1 (lifecycle + persistence half): the generation survives the client drop
  // and the result lands in db.json with no client present.
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
    // Persisted exactly once (idempotent on generationId — EC-D4 server half).
    const boot = await bootstrap()
    expect((await chatMessages(boot)).filter((m) => m.role === 'char')).toHaveLength(1)
  })

  // EC-D3: drop the initial connection mid-stream, reattach to the still-running
  // (gated) job, then let it produce the remaining tokens — the reattached client
  // receives them + the terminal done, and the result persists.
  it('reattaches to an in-flight generation and receives the remaining events (EC-D3)', async () => {
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
    // Drop the initial connection while the job is still gated (in-flight).
    controller.abort()

    // Reattach to the in-flight job, THEN release the remaining tokens — they stream
    // live to the reattached viewer.
    const reController = newController()
    const re = await fetch(
      `${harness.baseUrl}/api/v1/generate/chat/${encodeURIComponent(jobId)}/stream`,
      { signal: reController.signal },
    )
    expect(re.status).toBe(200)
    gated.release()
    const reEvents = await readSse(re, (ev) => ev.type === 'done')
    expect(reEvents[0]?.type).toBe('job_accepted')
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
    expect(boot.activeGenerationJobs).toContainEqual({ chatId: 'chat-1', jobId })

    // A fresh client reattaches via the discovered id.
    const reController = newController()
    const re = await fetch(
      `${harness.baseUrl}/api/v1/generate/chat/${encodeURIComponent(jobId)}/stream`,
      { signal: reController.signal },
    )
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

  // Cluster A regression: reattaching to an already-completed (in-grace) job must
  // CLOSE the connection server-side — not dangle the socket + the uncollectable job
  // until the client hangs up. Reading the reattach stream to its end must return
  // (the server closes it) rather than hang to the test timeout.
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
    const re = await fetch(
      `${harness.baseUrl}/api/v1/generate/chat/${encodeURIComponent(jobId)}/stream`,
      { signal: reController.signal },
    )
    const reEvents = await readSse(re, () => false)
    expect(reEvents.some((e) => e.type === 'job_accepted')).toBe(true)
    reController.abort()
  }, 8000)

  // Cluster B regression: an explicit cancel must push a terminal frame so a
  // reattached observer's stream ends cleanly (not a spurious "stream ended" cut).
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
    const obs = await fetch(
      `${harness.baseUrl}/api/v1/generate/chat/${encodeURIComponent(jobId)}/stream`,
      { signal: obsController.signal },
    )
    const obsEventsPromise = readSse(obs, (ev) => ev.type === 'done')

    const del = await fetch(`${harness.baseUrl}/api/v1/generate/chat/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
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
      headers: { 'risu-writer-session': 'writer-a' },
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

  // Step 2 gotcha B + E: explicit cancel aborts the dispatch; a streaming cancel
  // persists the accumulated-so-far text raw.
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
      headers: { 'risu-writer-session': 'writer-a' },
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
      headers: { 'risu-writer-session': 'writer-b' },
    })
    const del = await fetch(`${harness.baseUrl}/api/v1/generate/chat/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
      headers: { 'risu-writer-session': 'writer-b' },
    })
    expect(del.status).toBe(200)

    // After cancel the chat accepts a new generation (the slot is free).
    await waitFor(async () => {
      const boot = await bootstrap()
      return boot.activeGenerationJobs.length === 0 ? true : undefined
    })
  })

  // EC-D1 + A2 derivation on the durable path (decision #2): the server runs the
  // post-gen pass (output trigger), persists the scriptstate delta + the assistant
  // message, and folds the bumped revision onto done.postGeneration.
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
    expect(postGeneration?.messagePatch?.chatVarMutations).toEqual([
      { key: '$mood', before: null, after: 'happy' },
    ])
    expect(typeof postGeneration?.revision).toBe('number')

    const boot = await bootstrap()
    // The derived scriptstate + the assistant message both persisted server-side.
    expect(boot.database.characters[0].chats[0].scriptstate).toEqual({ $mood: 'happy' })
    const assistant = (await chatMessages(boot)).find((m) => m.role === 'char')
    expect(assistant?.data).toBe('reply text')
    controller.abort()
  })

  // gotcha C: the target chat is gone at completion (a full re-import replaced the
  // db mid-generation) → the persist fails gracefully (job error, no bad write).
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
    const re = await fetch(`${harness.baseUrl}/api/v1/generate/chat/no-such-job/stream`)
    expect(re.status).toBe(404)
    const del = await fetch(`${harness.baseUrl}/api/v1/generate/chat/no-such-job`, {
      method: 'DELETE',
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
})
