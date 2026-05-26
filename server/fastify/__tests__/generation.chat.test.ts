import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import type { CompletionStreamFrame } from '../src/generation/frames.js'
import type { GenerationChatRouteOptions } from '../src/routes/generationChat.js'
import { LLMFormat } from '../../../src/ts/model/types'

const subtle = webcrypto.subtle

interface Harness {
  app: FastifyInstance
  dataDir: string
}

async function startHarness(generationChat?: GenerationChatRouteOptions): Promise<Harness> {
  process.env.LOG_LEVEL = 'silent'
  const dataDir = mkdtempSync(path.join(tmpdir(), 'risu-fastify-'))
  const { app } = await buildApp({
    config: {
      host: '127.0.0.1',
      port: 0,
      dataDir,
      bodyLimit: 1024 * 1024,
      trustProxy: false,
      hubUrl: 'https://sv.risuai.xyz',
    },
    generationChat,
  })
  return { app, dataDir }
}

async function stopHarness(h: Harness): Promise<void> {
  await h.app.close()
  rmSync(h.dataDir, { recursive: true, force: true })
}

async function restartHarness(generationChat: GenerationChatRouteOptions): Promise<void> {
  await stopHarness(harness)
  harness = await startHarness(generationChat)
}

async function signAssertion(
  privateKey: CryptoKey,
  publicJwk: JsonWebKey,
  ttlSec = 60,
): Promise<string> {
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

async function seedDatabase(
  app: FastifyInstance,
  assertion: string,
  database: unknown,
): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/import/risusave',
    headers: { 'risu-auth': assertion },
    payload: { database },
  })
  expect(res.statusCode).toBe(200)
}

interface ParsedEvent {
  type: string
  data: Record<string, unknown>
}

/** Parse an `event:`/`data:` SSE body into ordered events. */
function parseEvents(body: string): ParsedEvent[] {
  return body
    .split('\n\n')
    .filter((block) => block.length > 0)
    .map((block) => {
      const [evLine, dataLine] = block.split('\n')
      return {
        type: evLine.replace('event: ', ''),
        data: JSON.parse(dataLine.replace('data: ', '')) as Record<string, unknown>,
      }
    })
}

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
      'done',
    ])
    const patch = events.find((e) => e.type === 'message_patch')?.data.patch as
      | {
          messageMutations?: Array<{
            type?: string
            source?: string
            beforeLength?: number
            afterLength?: number
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
        messages: [{ role: 'user', data: 'try again', chatId: 'msg-user-1' }],
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
    expect(String(events.find((e) => e.type === 'error')?.data.error)).toMatch(
      /latest assistant message/,
    )
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
      'done',
    ])
    const prompt = events.find((e) => e.type === 'prompt')!
    expect(Array.isArray(prompt.data.messages)).toBe(true)
    expect((prompt.data.messages as unknown[]).length).toBeGreaterThan(0)
    // 7-12b: the prompt event also carries the full OpenAIChat rows + biases
    // so the browser adapter can drive a preview / dispatch. `formated`
    // preserves the `role`/`content` of the lossy `messages` projection.
    const formated = prompt.data.formated as Array<{ role: string; content: unknown }>
    expect(Array.isArray(formated)).toBe(true)
    expect(formated.map((r) => ({ role: r.role, content: r.content }))).toEqual(
      prompt.data.messages,
    )
    expect(Array.isArray(prompt.data.biases)).toBe(true)
    const messagePatch = events.find((e) => e.type === 'message_patch')
    expect(messagePatch?.data.patch).toMatchObject({
      chatId: 'chat-1',
      characterId: 'char-1',
      messageMutations: expect.any(Array),
      chatVarMutations: expect.any(Array),
    })
    // The prompt stage closes after the patch, then telemetry rides before the terminal done.
    expect(events.at(-3)).toEqual({ type: 'stage', data: { stage: 'prompt', status: 'end' } })
    expect(events.at(-2)?.type).toBe('info')
    expect(events.at(-1)).toEqual({ type: 'done', data: {} })
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

  it('emits varChanged chat variables for command-backed send-mode persistence', async () => {
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

    const bootstrap = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(bootstrap.statusCode).toBe(200)
    expect(bootstrap.json().revision).toBe(1)
    expect(bootstrap.json().database.characters[0].chats[0].scriptstate).toBeUndefined()
  })

  it('emits stop-trigger mutations and restoration before the terminal error', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    const db = structuredClone(fixtureDatabase) as typeof fixtureDatabase & {
      characters: Array<(typeof fixtureDatabase.characters)[number] & { triggerscript?: unknown }>
    }
    db.characters[0].chats[0].message = [
      { role: 'user', data: 'before stop', chatId: 'msg-before-stop' },
    ]
    db.characters[0].chats[0].scriptstate = { $score: '1' }
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
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)

    const events = parseEvents(res.body)
    expect(events.map((e) => e.type)).toEqual([
      'stage',
      'stage',
      'stage',
      'message_patch',
      'error',
      'done',
    ])
    const patch = events[3].data.patch as {
      varChanged?: boolean
      chatVarMutations?: unknown[]
      messageMutations?: Array<{ type?: string; source?: string; messages?: unknown[] }>
    }
    expect(patch.varChanged).toBe(true)
    expect(patch.chatVarMutations).toEqual([{ key: '$score', before: '1', after: '9' }])
    expect(patch.messageMutations?.map((m) => [m.type, m.source])).toEqual([
      ['append', 'user_message'],
      ['replace_all', 'start_trigger'],
    ])
    expect(patch.messageMutations?.at(-1)?.messages).toMatchObject([
      { role: 'user', data: 'before stop', chatId: 'msg-before-stop' },
      { role: 'user', data: 'hi' },
      { role: 'char', data: 'mutated before stop' },
    ])
    expect(events[4]).toEqual({
      type: 'error',
      data: {
        error: 'prompt assembly was stopped by a trigger',
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
        expect(result.prompt.messages.length).toBeGreaterThan(0)
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

  it('uses the production server dispatcher when the prompt-assembly gate is enabled', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, {
      ...fixtureDatabase,
      useServerPromptAssembly: true,
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
      label: 'Ooba OpenAI-compatible reverse proxy',
      database: {
        aiModel: 'reverse_proxy',
        customProxyRequestModel: 'ooba-model',
        customAPIFormat: LLMFormat.OpenAICompatible,
        reverseProxyOobaMode: true,
        forceReplaceUrl: 'https://proxy.example.com/v1',
        proxyKey: 'sk-proxy',
      },
      error:
        'unsupported /chat provider: Ooba OpenAI-compatible reverse proxy must use local dispatch',
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
  ])(
    'emits an explicit unsupported-provider error for $label without provider tokens',
    async ({ database, error }) => {
      const { assertion } = await setupAuthedClient(harness.app)
      await seedDatabase(harness.app, assertion, {
        ...fixtureDatabase,
        useServerPromptAssembly: true,
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
    },
  )

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
    // 7-12b: full rows + biases ride on the JSON payload too.
    expect(Array.isArray(body.formated)).toBe(true)
    expect(body.formated.length).toBe(body.messages.length)
    expect(Array.isArray(body.biases)).toBe(true)
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
