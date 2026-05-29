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
  isBlockedAddress,
  validateEgressUrl,
  serverLuaRequest,
  runServerLua,
  runLuaEditTrigger,
  type EgressDeps,
  type RequestRateState,
  type ServerLuaRuntimeContext,
} from '../src/prompt/luaRuntime.js'

/**
 * Sub-slice 3b-1 proof suite for the server Lua runtime. Per the slice's
 * "Prove" step: a pure `editRequest` handler rewrites rows (prelude + dispatch +
 * JSON round-trip); `setChatVar`/`setState` mutate the bound var engine; the
 * `request()` SSRF + rate/url/https limits are enforced; a runaway script is
 * interrupted by the exec limit; and an interactive API fails explicitly.
 *
 * No assembler hook is wired and the classifier Lua arm still routes
 * `unsupported` — this file exercises the runtime in isolation.
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
