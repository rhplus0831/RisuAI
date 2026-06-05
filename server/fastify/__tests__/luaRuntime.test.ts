import { beforeAll, describe, expect, it } from 'vitest'
import type {
  Chat,
  Database,
  character,
} from '../../../src/ts/storage/database.svelte'
import type { OpenAIChat } from '../../../src/ts/process/index.svelte'
import { createTriggerVarEngine, type TriggerVarEngine } from '../src/prompt/triggerVars.js'
import { bootPromptVariables } from '../src/prompt/promptVariablesBoot.js'
import {
  createLuaExecBudget,
  isBlockedAddress,
  readLuaEngineAcquireStats,
  runLuaEditTrigger,
  runServerLua,
  serverLuaRequest,
  settleLuaEnginePool,
  validateEgressUrl,
  type EgressDeps,
  type RequestRateState,
  type ServerLuaRuntimeContext,
} from '../src/prompt/luaRuntime.js'

/**
 * Server Lua runtime proof suite: prompt rewrites, var writes, request safety,
 * execution limits, and explicit failures for interactive APIs.
 */

beforeAll(() => {
  bootPromptVariables()
})

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    message: [],
    note: '',
    name: 'main',
    localLore: [],
    scriptstate: {},
    fmIndex: -1,
    ...overrides,
  } as unknown as Chat
}

function makeChar(overrides: Partial<character> = {}): character {
  return {
    type: 'character',
    name: 'Tess',
    desc: 'A friendly assistant.',
    firstMessage: 'Hi there.',
    chaId: 'char-tess',
    triggerscript: [],
    chats: [{ message: [], scriptstate: {} }],
    chatPage: 0,
    ...overrides,
  } as unknown as character
}

function makeDb(overrides: Partial<Database> = {}): Database {
  return {
    characters: [],
    templateDefaultVariables: '',
    currentChar: 0,
    username: 'Operator',
    globalChatVariables: {},
    ...overrides,
  } as unknown as Database
}

/**
 * Build a runtime context whose chat / db / var engine are wired together the way
 * the assembler wires them (the var engine and the chat share a reference, and the
 * char's chat[0] is the same persisted chat).
 */
function makeRuntime(
  opts: {
    chat?: Chat
    char?: character
    model?: string
    egress?: EgressDeps
    rateState?: RequestRateState
    scriptstate?: Record<string, string | number | boolean>
  } = {},
): { ctx: ServerLuaRuntimeContext; engine: TriggerVarEngine } {
  const chat = opts.chat ?? makeChat({ scriptstate: { ...(opts.scriptstate ?? {}) } })
  const char = opts.char ?? makeChar({ chats: [chat] })
  const database = makeDb({ characters: [char] })
  const engine = createTriggerVarEngine({
    chat,
    database,
    selectedCharID: 0,
    chatPage: 0,
    defaultVariables: [],
  })
  const ctx: ServerLuaRuntimeContext = {
    chat,
    database,
    selectedCharID: 0,
    chatPage: 0,
    varEngine: engine,
    char,
    model: opts.model,
    egress: opts.egress,
    rateState: opts.rateState,
  }
  return { ctx, engine }
}

function rows(...contents: string[]): OpenAIChat[] {
  return contents.map((content) => ({ role: 'user', content }) as OpenAIChat)
}

// A short exec limit keeps the runaway tests fast.
const SHORT_LIMIT = 300

describe('server Lua runtime — pure edit-hook dispatch', () => {
  it('runs a pure editRequest handler that rewrites a row (prelude + dispatch + JSON round-trip)', async () => {
    const { ctx } = makeRuntime()
    const code = `
      listenEdit('editRequest', function(id, data, meta)
        data[#data].content = data[#data].content .. ' [' .. meta.tag .. ']'
        return data
      end)
    `
    const result = await runServerLua(
      { code, mode: 'editRequest', data: rows('alpha', 'omega'), meta: { tag: 'EDIT' } },
      ctx,
    )

    expect(result.error).toBeUndefined()
    expect(result.timedOut).toBe(false)
    const out = result.res as OpenAIChat[]
    expect(out).toHaveLength(2)
    expect(out[0].content).toBe('alpha')
    expect(out[1].content).toBe('omega [EDIT]')
    expect(out[1].role).toBe('user')
  })

  it('binds setChatVar / setState to the assembler var engine (mutations land in scriptstate)', async () => {
    const { ctx, engine } = makeRuntime()
    const code = `
      listenEdit('editRequest', function(id, data, meta)
        setChatVar(id, 'mood', 'curious')
        setState(id, 'turns', 7)
        return data
      end)
    `
    const result = await runServerLua({ code, mode: 'editRequest', data: rows('x') }, ctx)

    expect(result.error).toBeUndefined()
    expect(engine.getVar('mood')).toBe('curious')
    // setState JSON-encodes under the `__`-prefixed key.
    expect(engine.getVar('__turns')).toBe('7')
    expect(engine.varChanged).toBe(true)
  })

  it('gates setChatVar by access key — a forged id cannot write', async () => {
    const { ctx, engine } = makeRuntime()
    const code = `
      listenEdit('editRequest', function(id, data, meta)
        setChatVar('forged-key', 'mood', 'leaked')
        return data
      end)
    `
    await runServerLua({ code, mode: 'editRequest', data: rows('x') }, ctx)
    expect(engine.getVar('mood')).toBe('null')
    expect(engine.varChanged).toBe(false)
  })
})

describe('server Lua runtime — request() egress guard (SSRF)', () => {
  it('classifies private / loopback / link-local / metadata / ULA addresses as blocked', () => {
    for (const blocked of [
      '127.0.0.1',
      '0.0.0.0',
      '10.0.0.5',
      '172.16.9.9',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '169.254.0.1',
      '100.64.0.1', // CGNAT
      '::1',
      'fe80::1',
      'fd00::1',
      'fc00::1',
      '::ffff:127.0.0.1', // IPv4-mapped loopback
      'not-an-ip',
    ]) {
      expect(isBlockedAddress(blocked)).toBe(true)
    }
    for (const allowed of ['8.8.8.8', '93.184.216.34', '1.1.1.1', '2606:4700:4700::1111']) {
      expect(isBlockedAddress(allowed)).toBe(false)
    }
  })

  it('L23: blocks embedded-private IPv6 transition forms (mapped-hex / compatible / 6to4 / NAT64)', () => {
    for (const blocked of [
      '::ffff:7f00:1', // IPv4-mapped loopback, hex form (dotted form was already unwrapped)
      '::ffff:a9fe:a9fe', // IPv4-mapped metadata IP, hex form
      '::7f00:1', // IPv4-compatible loopback
      '::127.0.0.1', // IPv4-compatible loopback, dotted form
      '::a00:1', // IPv4-compatible 10.0.0.1
      '2002:7f00:1::', // 6to4 embedding 127.0.0.1
      '2002:a9fe:a9fe::', // 6to4 embedding 169.254.169.254 (metadata)
      '2002:c0a8:101::', // 6to4 embedding 192.168.1.1
      '64:ff9b::7f00:1', // NAT64 embedding 127.0.0.1
      '64:ff9b::127.0.0.1', // NAT64, dotted form
      '64:ff9b::a9fe:a9fe', // NAT64 embedding the metadata IP
    ]) {
      expect(isBlockedAddress(blocked), `${blocked} should be blocked`).toBe(true)
    }
    // Transition forms of PUBLIC addresses stay reachable.
    for (const allowed of [
      '::ffff:808:808', // IPv4-mapped 8.8.8.8, hex form
      '2002:808:808::', // 6to4 of 8.8.8.8
      '64:ff9b::808:808', // NAT64 of 8.8.8.8
    ]) {
      expect(isBlockedAddress(allowed), `${allowed} should be allowed`).toBe(false)
    }
  })

  it('rejects non-https URLs', async () => {
    const verdict = await validateEgressUrl('http://example.com/')
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.status).toBe(400)
  })

  it('rejects URLs longer than 120 characters', async () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(120)
    const verdict = await validateEgressUrl(longUrl)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.status).toBe(413)
  })

  it('rejects localhost by name (before any DNS lookup)', async () => {
    const verdict = await validateEgressUrl('https://localhost/secret')
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.status).toBe(403)
  })

  it('rejects a URL that resolves to a private / loopback / metadata IP', async () => {
    for (const ip of ['127.0.0.1', '169.254.169.254', '10.1.2.3']) {
      const lookup: EgressDeps['lookup'] = async () => [{ address: ip, family: 4 }]
      const verdict = await validateEgressUrl('https://evil.test/x', { lookup })
      expect(verdict.ok).toBe(false)
      if (!verdict.ok) expect(verdict.status).toBe(403)
    }
  })

  it('allows a URL that resolves only to public addresses', async () => {
    const lookup: EgressDeps['lookup'] = async () => [{ address: '93.184.216.34', family: 4 }]
    const verdict = await validateEgressUrl('https://example.test/x', { lookup })
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.addresses).toEqual(['93.184.216.34'])
  })

  it('rejects when ANY resolved address is private (mixed result)', async () => {
    const lookup: EgressDeps['lookup'] = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]
    const verdict = await validateEgressUrl('https://rebind.test/x', { lookup })
    expect(verdict.ok).toBe(false)
  })

  it('rate-limits to 30 requests per window (the 31st is 429)', async () => {
    const rate: RequestRateState = { count: 0, resetAt: 0 }
    const deps: EgressDeps = {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchImpl: async () => ({ status: 200, data: 'ok' }),
      now: () => 1_000_000,
    }
    const statuses: number[] = []
    for (let i = 0; i < 31; i++) {
      const raw = await serverLuaRequest('https://example.test/x', deps, rate)
      statuses.push((JSON.parse(raw) as { status: number }).status)
    }
    expect(statuses.slice(0, 30)).toEqual(Array(30).fill(200))
    expect(statuses[30]).toBe(429)
  })

  it('L25: a blocked URL does not consume the egress budget', async () => {
    const rate: RequestRateState = { count: 0, resetAt: 0 }
    const deps: EgressDeps = {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchImpl: async () => ({ status: 200, data: 'ok' }),
      now: () => 1_000_000,
    }
    // 40 rejected requests (non-https) would previously exhaust the 30/window
    // budget without a single socket opening.
    for (let i = 0; i < 40; i++) {
      const raw = await serverLuaRequest('http://blocked.test/x', deps, rate)
      expect((JSON.parse(raw) as { status: number }).status).toBe(400)
    }
    expect(rate.count).toBe(0)
    // A valid request afterwards still goes through.
    const ok = await serverLuaRequest('https://example.test/x', deps, rate)
    expect((JSON.parse(ok) as { status: number }).status).toBe(200)
    expect(rate.count).toBe(1)
  })

  it('L20: an abort mid-fetch rejects through serverLuaRequest instead of returning a synthetic 400', async () => {
    const controller = new AbortController()
    const rate: RequestRateState = { count: 0, resetAt: 0 }
    let seenSignal: AbortSignal | undefined
    const deps: EgressDeps = {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      // Mimics pinnedHttpsFetch: settles only when the originating request's
      // signal destroys the in-flight socket.
      fetchImpl: (_url, _addresses, signal) => {
        seenSignal = signal
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('socket destroyed')), {
            once: true,
          })
        })
      },
    }
    const pending = serverLuaRequest('https://example.test/x', deps, rate, controller.signal)
    setTimeout(() => controller.abort(), 20)
    await expect(pending).rejects.toThrow('request aborted')
    expect(seenSignal).toBe(controller.signal)
  })
})

describe('server Lua runtime — request() binding + low-level gate', () => {
  it('exposes request() only with low-level access; injected egress deps flow through', async () => {
    const egress: EgressDeps = {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchImpl: async () => ({ status: 204, data: 'served' }),
    }
    const code = `
      listenEdit('editRequest', function(id, data, meta)
        local res = request(id, 'https://example.test/data'):await()
        if res == nil then
          data[1].content = 'BLOCKED'
        else
          data[1].content = tostring(json.decode(res).status)
        end
        return data
      end)
    `

    // Low-level granted → request runs through the injected fetch.
    const granted = makeRuntime({ egress, rateState: { count: 0, resetAt: 0 } })
    const ok = await runServerLua(
      { code, mode: 'editRequest', data: rows('orig'), lowLevelAccess: true },
      granted.ctx,
    )
    expect((ok.res as OpenAIChat[])[0].content).toBe('204')

    // Low-level denied (edit-hook default) → request returns nil.
    const denied = makeRuntime({ egress, rateState: { count: 0, resetAt: 0 } })
    const blocked = await runServerLua(
      { code, mode: 'editRequest', data: rows('orig'), lowLevelAccess: false },
      denied.ctx,
    )
    expect((blocked.res as OpenAIChat[])[0].content).toBe('BLOCKED')
  })
})

describe('server Lua runtime — execution limit', () => {
  it('interrupts a top-level runaway loop within the limit', async () => {
    const { ctx } = makeRuntime()
    const started = Date.now()
    const result = await runServerLua(
      { code: 'while true do end', mode: 'editRequest', data: rows('x'), execTimeoutMs: SHORT_LIMIT },
      ctx,
    )
    const elapsed = Date.now() - started
    expect(result.timedOut).toBe(true)
    expect(elapsed).toBeLessThan(5000)
  })

  it('interrupts a runaway loop inside an edit handler within the limit', async () => {
    const { ctx } = makeRuntime()
    const code = `
      listenEdit('editRequest', function(id, data, meta)
        while true do end
        return data
      end)
    `
    const started = Date.now()
    const result = await runServerLua(
      { code, mode: 'editRequest', data: rows('x'), execTimeoutMs: SHORT_LIMIT },
      ctx,
    )
    const elapsed = Date.now() - started
    expect(result.timedOut).toBe(true)
    expect(elapsed).toBeLessThan(5000)
  })
})

describe('server Lua runtime — request-signal abort (L20)', () => {
  it('L20: an already-aborted request signal returns immediately without dispatching', async () => {
    const { ctx, engine } = makeRuntime()
    const controller = new AbortController()
    controller.abort()
    ctx.signal = controller.signal
    const code = `
      listenEdit('editRequest', function(id, data, meta)
        setChatVar(id, 'mood', 'ran-anyway')
        return data
      end)
    `
    const result = await runServerLua({ code, mode: 'editRequest', data: rows('x') }, ctx)

    expect(result.aborted).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(result.res).toBeUndefined()
    expect(engine.getVar('mood')).toBe('null')
  })

  it('L20: aborting mid-dispatch cancels in-flight hook work well before the exec limit', async () => {
    const { ctx, engine } = makeRuntime()
    const controller = new AbortController()
    ctx.signal = controller.signal
    // The handler would loop sleep() for far longer than our abort point; every
    // host-fn call is the abort checkpoint, so the loop dies on the next call.
    const code = `
      listenEdit('editRequest', function(id, data, meta)
        while true do
          sleep(id, 200):await()
        end
        return data
      end)
    `
    setTimeout(() => controller.abort(), 100)
    const started = Date.now()
    const result = await runServerLua(
      { code, mode: 'editRequest', data: rows('x'), execTimeoutMs: 60_000 },
      ctx,
    )
    const elapsed = Date.now() - started

    expect(result.aborted).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(result.res).toBeUndefined()
    expect(elapsed).toBeLessThan(5_000)
    expect(engine.varChanged).toBe(false)
  })

  it('L20: aborting while a Lua request() egress fetch is in flight cancels the run promptly', async () => {
    const controller = new AbortController()
    let fetchStarted = false
    const egress: EgressDeps = {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      // Mimics pinnedHttpsFetch: never resolves on its own (a slow upstream);
      // rejects only when the originating request's signal tears the socket down.
      fetchImpl: (_url, _addresses, signal) =>
        new Promise((_resolve, reject) => {
          fetchStarted = true
          signal?.addEventListener('abort', () => reject(new Error('request aborted')), {
            once: true,
          })
        }),
    }
    const { ctx, engine } = makeRuntime({ egress, rateState: { count: 0, resetAt: 0 } })
    ctx.signal = controller.signal
    const code = `
      listenEdit('editRequest', function(id, data, meta)
        request(id, 'https://example.test/slow'):await()
        setChatVar(id, 'mood', 'survived-abort')
        return data
      end)
    `
    setTimeout(() => controller.abort(), 100)
    const started = Date.now()
    const result = await runServerLua(
      { code, mode: 'editRequest', data: rows('x'), lowLevelAccess: true, execTimeoutMs: 60_000 },
      ctx,
    )
    const elapsed = Date.now() - started

    expect(fetchStarted).toBe(true)
    expect(result.aborted).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(result.res).toBeUndefined()
    expect(elapsed).toBeLessThan(5_000)
    // The script never continued past the in-flight await.
    expect(engine.getVar('mood')).toBe('null')
  })
})

describe('server Lua runtime — interactive APIs fail explicitly', () => {
  it('flags alertInput and does not silently apply the handler', async () => {
    const { ctx } = makeRuntime()
    const code = `
      listenEdit('editRequest', function(id, data, meta)
        alertInput(id, 'pick one')
        data[1].content = 'SHOULD_NOT_APPLY'
        return data
      end)
    `
    const result = await runServerLua({ code, mode: 'editRequest', data: rows('orig') }, ctx)

    expect(result.interactiveInvoked).toBe(true)
    // The handler threw at alertInput, so the row was never rewritten.
    expect(result.res).toBeUndefined()
  })
})

describe('server Lua runtime — aggregate exec budget (L19)', () => {
  it('L19: an exhausted aggregate budget short-circuits before booting an engine', async () => {
    const { ctx } = makeRuntime()
    ctx.execBudget = { totalMs: 100, usedMs: 100 }
    const before = readLuaEngineAcquireStats()

    const result = await runServerLua(
      { code: 'while true do end', mode: 'editRequest', data: rows('x') },
      ctx,
    )

    expect(result.timedOut).toBe(true)
    expect(result.error).toBe('aggregate Lua execution budget exhausted')
    expect(result.res).toBeUndefined()
    const after = readLuaEngineAcquireStats()
    expect(after.pooledAcquires + after.freshAcquires).toBe(
      before.pooledAcquires + before.freshAcquires,
    )
  })

  it('L19: runaway hooks across a trigger loop are bounded by the aggregate budget, not per-run limits', async () => {
    const chat = makeChat()
    const runawayEffect = {
      comment: 'runaway',
      type: 'request',
      conditions: [],
      effect: [{ type: 'triggerlua', code: 'while true do end' }],
    }
    const char = makeChar({
      chats: [chat],
      // Three runaway hooks: with the default 3000ms per-run limit alone this
      // loop would stall for ~9s; the shared budget bounds the whole pass.
      triggerscript: [runawayEffect, runawayEffect, runawayEffect] as never,
    })
    const { ctx } = makeRuntime({ chat, char })
    const { char: _char, ...editCtx } = ctx
    const budget = createLuaExecBudget(300)

    const input = rows('survives')
    const started = Date.now()
    const out = await runLuaEditTrigger(char, 'editRequest', input, {}, {
      ...editCtx,
      execBudget: budget,
    })
    const elapsed = Date.now() - started

    // Identity fallback: every run timed out / was budget-blocked.
    expect(out).toEqual(input)
    // Bounded by ~the budget (plus scheduling slack), well under one per-run
    // limit per hook.
    expect(elapsed).toBeLessThan(2_500)
    expect(budget.usedMs).toBeGreaterThanOrEqual(300)
  })
})

describe('server Lua runtime — pre-warmed engines (L21)', () => {
  it('L21: a default-limit run serves from the warm pool without a hot-path boot, output identical', async () => {
    // Prime: this run may boot inline, but its completion refills the pool.
    const code = `
      listenEdit('editRequest', function(id, data, meta)
        data[#data].content = data[#data].content .. ' [' .. meta.tag .. ']'
        return data
      end)
    `
    const prime = makeRuntime()
    const fresh = await runServerLua(
      { code, mode: 'editRequest', data: rows('alpha', 'omega'), meta: { tag: 'EDIT' } },
      prime.ctx,
    )
    await settleLuaEnginePool()

    const before = readLuaEngineAcquireStats()
    const { ctx } = makeRuntime()
    const pooled = await runServerLua(
      { code, mode: 'editRequest', data: rows('alpha', 'omega'), meta: { tag: 'EDIT' } },
      ctx,
    )
    const after = readLuaEngineAcquireStats()

    // The second run came from the pool — no fresh boot on the hot path.
    expect(after.pooledAcquires).toBe(before.pooledAcquires + 1)
    expect(after.freshAcquires).toBe(before.freshAcquires)
    // Pooled and fresh-boot runs produce identical results.
    expect(pooled).toEqual(fresh)
    expect((pooled.res as OpenAIChat[])[1].content).toBe('omega [EDIT]')
  })

  it('L21: pooled engines never leak Lua globals between runs (per-call isolation preserved)', async () => {
    const readMarker = `
      listenEdit('editRequest', function(id, data, meta)
        data[1].content = tostring(MARKER)
        return data
      end)
    `
    // Run A plants a global on its engine…
    const writer = makeRuntime()
    const wrote = await runServerLua(
      { code: `MARKER = 'leaked'\n${readMarker}`, mode: 'editRequest', data: rows('x') },
      writer.ctx,
    )
    expect((wrote.res as OpenAIChat[])[0].content).toBe('leaked')

    // …and run B (a pooled engine under the same default limit) must not see it.
    await settleLuaEnginePool()
    const reader = makeRuntime()
    const read = await runServerLua(
      { code: readMarker, mode: 'editRequest', data: rows('x') },
      reader.ctx,
    )
    expect((read.res as OpenAIChat[])[0].content).toBe('nil')
  })
})

describe('server Lua runtime — runLuaEditTrigger entry', () => {
  it('runs a character triggerlua editRequest hook over the rows', async () => {
    const chat = makeChat()
    const char = makeChar({
      chats: [chat],
      triggerscript: [
        {
          comment: 'edit',
          type: 'request',
          conditions: [],
          effect: [
            {
              type: 'triggerlua',
              code: `
                listenEdit('editRequest', function(id, data, meta)
                  data[#data].content = data[#data].content .. ' !'
                  return data
                end)
              `,
            },
          ],
        } as never,
      ],
    })
    const { ctx } = makeRuntime({ chat, char })
    const { char: _char, ...editCtx } = ctx

    const out = await runLuaEditTrigger(char, 'editRequest', rows('ping'), {}, editCtx)
    expect(out[0].content).toBe('ping !')
  })

  it('returns content unchanged for editprocess (browser no-op)', async () => {
    const chat = makeChat()
    const char = makeChar({ chats: [chat] })
    const { ctx } = makeRuntime({ chat, char })
    const { char: _char, ...editCtx } = ctx

    const input = rows('untouched')
    const out = await runLuaEditTrigger(char, 'editprocess', input, {}, editCtx)
    expect(out).toBe(input)
  })
})
