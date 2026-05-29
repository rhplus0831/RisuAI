import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

  // Slice 3b sub-slice 2: the server Lua VM runs the `editRequest` hook during
  // assembly (mirrors the browser's `renderFinalPrompt.ts:384`
  // `runLuaEditTrigger(char,'editRequest',formated)`), so a `triggerlua` char's
  // edits show up in the server-assembled prompt — not the pre-slice identity.
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
    expect(
      messages.every((m) => typeof m.content === 'string' && m.content.endsWith(' [LUA]')),
    ).toBe(true)
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
      new URL(
        '../../../src/ts/process/__fixtures__/expected/editrequest-trigger.json',
        import.meta.url,
      ),
    )
    const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as {
      providerCalls: Array<{ formated: Array<Record<string, unknown>> }>
    }
    const goldenMarker = golden.providerCalls[0].formated.find(
      (row) => row.content === '[edit-request marker]',
    )
    expect(goldenMarker).toBeDefined()
    expect(serverMarker).toEqual(goldenMarker)
  })

  // Slice 3b sub-slice 3: the server wires Lua `editprocess` through the runtime
  // at the two history call sites (first message + per-message bodies). Lua
  // `editprocess` is a browser no-op — `runLuaEditTrigger` early-returns for it
  // before booting the engine or dispatching — so a `triggerlua` char must
  // assemble its history identically to the same char without it. The Lua here
  // defines an `editprocess` global that *would* rewrite any body it processed if
  // the hook ever dispatched, so the marker's absence proves the no-op is wired
  // through the VM (not skipped) and faithful.
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

  // ── Slice 3b sub-slice 4: submit-time input trigger + `editinput` ──────────
  //
  // The server now runs the chat-screen submit handler's input trigger
  // (`runTrigger(char,'input')`, with `triggerlua` on the VM) and `editinput`
  // transform before assembly, and owns the post-`editinput` transcript write.
  // The browser sends the raw user text for a server-backed send. These tests
  // live in the node-env server suite because wasmoon cannot init under the
  // browser suite's jsdom (same reason as the editRequest golden proof above).

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

  async function sendBase(assertion: string): Promise<ParsedEvent[]> {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: basePayload,
    })
    expect(res.statusCode).toBe(200)
    return parseEvents(res.body)
  }

  async function bootstrapChat(
    assertion: string,
  ): Promise<{
    message: Array<{ role: string; data: string }>
    scriptstate?: Record<string, unknown>
  }> {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'risu-auth': assertion },
    })
    expect(res.statusCode).toBe(200)
    return res.json().database.characters[0].chats[0]
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

    const events = await sendBase(assertion)

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

  it('runs a regex editinput script that rewrites the submitted user message (slice 3b-4)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    // The regex `editinput` path (no Lua) is already at parity; the route now runs
    // it over the submitted user text and persists the result.
    const db = structuredClone(fixtureDatabase) as typeof fixtureDatabase & {
      characters: Array<(typeof fixtureDatabase.characters)[number] & { customscript?: unknown }>
    }
    db.characters[0].customscript = [
      { in: 'hi', out: 'HELLO', type: 'editinput', flag: '', ableFlag: false },
    ]
    await seedDatabase(harness.app, assertion, db)

    await sendBase(assertion)

    const chat = await bootstrapChat(assertion)
    expect(chat.message.map((m) => ({ role: m.role, data: m.data }))).toEqual([
      { role: 'user', data: 'HELLO' },
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
    expect(
      patch.messageMutations?.some((m) => m.source === 'editinput' || m.source === 'input_trigger'),
    ).toBe(false)
    // …but the route persisted nothing (no revision bump, transcript untouched).
    const info = events.find((e) => e.type === 'info')
    expect(info?.data.revision).toBeUndefined()
    const chat = await bootstrapChat(assertion)
    expect(chat.message).toEqual([])
  })

  it('inlines request inlayAssets into the assembled prompt multimodals (slice 3a)', async () => {
    const { assertion } = await setupAuthedClient(harness.app)
    await seedDatabase(harness.app, assertion, dbWithHistoryMessage('look {{inlayeddata::abc}}'))

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/generate/chat',
      headers: { 'risu-auth': assertion },
      payload: {
        ...basePayload,
        inlayAssets: [
          { id: 'abc', type: 'image', base64: 'data:image/png;base64,AAAA', width: 2, height: 3 },
        ],
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
      (row) =>
        row.role === 'user' && typeof row.content === 'string' && row.content.includes('look'),
    )
    // `processInlays` resolved the id from the request payload and pushed bytes…
    expect(userRow?.multimodals).toEqual([
      { type: 'image', base64: 'data:image/png;base64,AAAA', width: 2, height: 3 },
    ])
    // …and stripped the marker from the row text.
    expect(userRow?.content).not.toContain('{{inlayeddata::abc}}')
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
      (row) =>
        row.role === 'user' && typeof row.content === 'string' && row.content.includes('show'),
    )
    // `processAssetPrompts` mapped the name → reference → store bytes, re-wrapped
    // as a png data URI (byte-parity with the browser's readImage path).
    expect(userRow?.multimodals).toEqual([
      { type: 'image', base64: `data:image/png;base64,${assetBytes.toString('base64')}` },
    ])
    expect(userRow?.content).not.toContain('{{asset_prompt::hero}}')
  })

  // Slice 3c: the image-gen / emotion view instruction. `buildInlayViewInstruction`
  // appends a static `system` row drawn from `newGenData` when `inlayViewScreen`
  // is set; it rides postEverything. No request field is needed — the config is
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

  // Slice 3c: with `inlayViewScreen` unset (the default), no instruction row is
  // appended — the static section is a no-op, matching the browser gate.
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
    expect(
      messages.some(
        (m) => m.content.includes('emotion') || m.content.includes('Generate an image'),
      ),
    ).toBe(false)
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
    // Slice 4 (A2): a trigger-less / script-less send runs the post-gen pass as a
    // no-op, so the `done` frame omits `postGeneration` entirely (byte-parity).
    expect((events.at(-1)?.data as { postGeneration?: unknown }).postGeneration).toBeUndefined()
  })

  // ── Slice 4 (A2): server post-generation pass (output trigger + editoutput) ──
  //
  // After the provider produces the completion, the server runs the run-var pass,
  // the `'output'` trigger, and `editoutput` over the just-generated text — the
  // durable derivations the browser used to own (`postGeneration/outputTrigger.ts`
  // + the `editoutput` arm of `processScriptFull`). The chat-var delta is persisted
  // through the slice-2 writer (revision bump) and surfaced, with the final text /
  // resend, on the terminal `done.postGeneration`. (wasmoon-in-node is why the Lua
  // proof lives here, like the slice-3b proofs above.)

  /** A server-dispatch echo db (`useServerPromptAssembly` + echo) with char overrides. */
  function dbWithServerDispatch(charOverride: Record<string, unknown>): unknown {
    return {
      ...fixtureDatabase,
      useServerPromptAssembly: true,
      aiModel: 'echo_model',
      echoMessage: 'server echo reply',
      echoDelay: 0,
      characters: [{ ...fixtureDatabase.characters[0], ...charOverride }],
    }
  }

  function doneFrame(events: ParsedEvent[]): {
    result?: string
    postGeneration?: {
      finalText?: string
      revision?: number
      resendChat?: boolean
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
    expect(done.postGeneration?.messagePatch?.chatVarMutations).toEqual([
      { key: '$seen', before: null, after: '1' },
    ])
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
        customscript: [
          { comment: '', in: 'reply', out: 'REPLY', type: 'editoutput', flag: '', ableFlag: false },
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

    // The raw streamed text is unchanged; the server-owned `editoutput` transform
    // rides on `finalText` (the browser writes it onto the assistant message). No
    // chat-var write, so no revision bump.
    expect(done.result).toBe('server echo reply')
    expect(done.postGeneration?.finalText).toBe('server echo REPLY')
    expect(done.postGeneration?.revision).toBeUndefined()
    expect(done.postGeneration?.messagePatch).toBeUndefined()
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
    // Full rows + biases ride on the JSON payload too.
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
