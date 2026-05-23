import { beforeAll, describe, expect, it } from 'vitest'
import type {
  Chat,
  Database,
  character,
} from '../../../src/ts/storage/database.svelte'
import type { RisuModule } from '../../../src/ts/process/modules'
import type { triggerCondition, triggerscript } from '../../../src/ts/process/triggers'
import { getModuleTriggers } from '../src/prompt/modules.js'
import {
  collectTriggers,
  evaluateConditions,
  matchesTrigger,
  runTrigger,
  type TriggerRunContext,
} from '../src/prompt/triggers.js'
import { createTriggerVarEngine } from '../src/prompt/triggerVars.js'
import { bootPromptVariables } from '../src/prompt/promptVariablesBoot.js'

beforeAll(() => {
  bootPromptVariables()
})

/** Pass-through expander for condition tests that use no CBS syntax. */
const identityExpand = (text: string): string => text

function makeChar(overrides: Partial<character> = {}): character {
  return {
    type: 'character',
    name: 'Tess',
    chaId: 'char-tess',
    triggerscript: [],
    chats: [{ message: [], scriptstate: {} }],
    chatPage: 0,
    ...overrides,
  } as unknown as character
}

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

function makeModule(overrides: Partial<RisuModule> = {}): RisuModule {
  return {
    name: 'mod',
    description: '',
    id: 'mod-1',
    ...overrides,
  } as RisuModule
}

function makeTrigger(overrides: Partial<triggerscript> = {}): triggerscript {
  return {
    comment: '',
    type: 'output',
    conditions: [],
    effect: [],
    ...overrides,
  } as triggerscript
}

function makeDb(overrides: Partial<Database> = {}): Database {
  return {
    characters: [],
    templateDefaultVariables: '',
    currentChar: 0,
    ...overrides,
  } as unknown as Database
}

function makeCtx(overrides: Partial<TriggerRunContext> = {}): TriggerRunContext {
  return {
    modules: [],
    database: makeDb(),
    selectedCharID: 0,
    chatPage: 0,
    ...overrides,
  }
}

const ctx: TriggerRunContext = makeCtx()

describe('Phase 7-9a getModuleTriggers', () => {
  it('returns [] when no module declares triggers', () => {
    expect(getModuleTriggers([makeModule()])).toEqual([])
  })

  it('inherits lowLevelAccess from the owning module without mutating the source', () => {
    const trigger = makeTrigger({ comment: 'm', type: 'start' })
    const mod = makeModule({ trigger: [trigger], lowLevelAccess: true })

    const out = getModuleTriggers([mod])

    expect(out).toHaveLength(1)
    expect(out[0].lowLevelAccess).toBe(true)
    expect(out[0]).not.toBe(trigger)
    // source trigger object stays untouched
    expect(trigger.lowLevelAccess).toBeUndefined()
  })

  it('flattens triggers across multiple modules in order', () => {
    const a = makeModule({
      id: 'a',
      trigger: [makeTrigger({ comment: 'a1' })],
      lowLevelAccess: false,
    })
    const b = makeModule({
      id: 'b',
      trigger: [makeTrigger({ comment: 'b1' }), makeTrigger({ comment: 'b2' })],
      lowLevelAccess: true,
    })

    const out = getModuleTriggers([a, b])

    expect(out.map((t) => t.comment)).toEqual(['a1', 'b1', 'b2'])
    expect(out.map((t) => t.lowLevelAccess)).toEqual([false, true, true])
  })
})

describe('Phase 7-9a collectTriggers', () => {
  it('clones character triggers with inherited lowLevelAccess and leaves the source untouched', () => {
    const own = makeTrigger({ comment: 'own', type: 'output' })
    const char = makeChar({ triggerscript: [own], lowLevelAccess: true })

    const out = collectTriggers(char, [])

    expect(out).toHaveLength(1)
    expect(out[0].lowLevelAccess).toBe(true)
    expect(out[0]).not.toBe(own)
    expect(own.lowLevelAccess).toBeUndefined()
  })

  it('appends module triggers after the character triggers', () => {
    const own = makeTrigger({ comment: 'own' })
    const char = makeChar({ triggerscript: [own] })
    const mod = makeModule({ trigger: [makeTrigger({ comment: 'mod' })] })

    const out = collectTriggers(char, [mod])

    expect(out.map((t) => t.comment)).toEqual(['own', 'mod'])
  })

  it('defaults lowLevelAccess to false when the character does not set it', () => {
    const char = makeChar({ triggerscript: [makeTrigger()] })
    expect(collectTriggers(char, [])[0].lowLevelAccess).toBe(false)
  })
})

describe('Phase 7-9a matchesTrigger', () => {
  it('matches on equal mode/type', () => {
    expect(matchesTrigger(makeTrigger({ type: 'output' }), 'output')).toBe(true)
  })

  it('ignores triggers whose type differs from the mode', () => {
    expect(matchesTrigger(makeTrigger({ type: 'output' }), 'start')).toBe(false)
  })

  it('filters by manualName comment when one is supplied', () => {
    const named = makeTrigger({ comment: 'go', type: 'manual' })
    expect(matchesTrigger(named, 'manual', 'go')).toBe(true)
    expect(matchesTrigger(named, 'manual', 'other')).toBe(false)
  })

  it('selects triggercode/triggerlua triggers regardless of mode', () => {
    const code = makeTrigger({
      type: 'output',
      effect: [{ type: 'triggercode', code: '' }],
    })
    const lua = makeTrigger({
      type: 'output',
      effect: [{ type: 'triggerlua', code: '' }],
    })
    expect(matchesTrigger(code, 'start')).toBe(true)
    expect(matchesTrigger(lua, 'input')).toBe(true)
  })
})

describe('Phase 7-9a runTrigger shell', () => {
  it('returns null when there are no triggers at all', async () => {
    const char = makeChar({ triggerscript: [] })
    const result = await runTrigger(ctx, char, 'output', { chat: makeChat() })
    expect(result).toBeNull()
  })

  it('returns a result (not null) even when no trigger matches the mode', async () => {
    const char = makeChar({ triggerscript: [makeTrigger({ type: 'output' })] })
    const result = await runTrigger(ctx, char, 'start', { chat: makeChat() })
    expect(result).not.toBeNull()
    expect(result?.additonalSysPrompt).toEqual({
      start: '',
      historyend: '',
      promptend: '',
    })
    expect(result?.tokens).toBe(0)
  })

  it('does not mutate the input character or chat', async () => {
    const char = makeChar({ triggerscript: [makeTrigger({ type: 'output' })] })
    const chat = makeChat({ message: [{ role: 'char', data: 'hi' }] as never })
    const charSnapshot = structuredClone(char)
    const chatSnapshot = structuredClone(chat)

    await runTrigger(ctx, char, 'output', { chat })

    expect(char).toEqual(charSnapshot)
    expect(chat).toEqual(chatSnapshot)
  })

  it('threads stopSending, displayData, and tempVars through the result', async () => {
    const char = makeChar({ triggerscript: [makeTrigger({ type: 'output' })] })
    const tempVars = { a: '1' }
    const result = await runTrigger(ctx, char, 'output', {
      chat: makeChat(),
      stopSending: true,
      displayData: 'disp',
      tempVars,
      recursiveCount: 2,
      triggerId: 'trig-1',
    })

    expect(result?.stopSending).toBe(true)
    expect(result?.sendAIprompt).toBe(false)
    expect(result?.displayData).toBe('disp')
    expect(result?.tempVars).toEqual({ a: '1' })
  })

  it('includes module triggers when the character has none of its own', async () => {
    const char = makeChar({ triggerscript: [] })
    const mod = makeModule({ trigger: [makeTrigger({ type: 'output' })] })
    const result = await runTrigger(makeCtx({ modules: [mod] }), char, 'output', {
      chat: makeChat(),
    })
    expect(result).not.toBeNull()
  })

  it('counts tokens of a pre-populated additonalSysPrompt', async () => {
    const char = makeChar({ triggerscript: [makeTrigger({ type: 'output' })] })
    const result = await runTrigger(ctx, char, 'output', {
      chat: makeChat(),
      additonalSysPrompt: {
        start: 'hello world',
        historyend: '',
        promptend: 'done',
      },
    })
    expect(result?.tokens).toBeGreaterThan(0)
  })

  it('uses the caller chat directly in displayMode (no clone)', async () => {
    const char = makeChar({ triggerscript: [makeTrigger({ type: 'display' })] })
    const chat = makeChat()
    const result = await runTrigger(ctx, char, 'display', {
      chat,
      displayMode: true,
    })
    expect(result?.chat).toBe(chat)
  })

  it('skips a trigger whose condition fails but still returns a result', async () => {
    const char = makeChar({
      triggerscript: [
        makeTrigger({
          type: 'output',
          conditions: [cond({ type: 'value', var: '1', value: '2', operator: '=' })],
        }),
      ],
    })
    const result = await runTrigger(ctx, char, 'output', { chat: makeChat() })
    expect(result).not.toBeNull()
    expect(result?.varChanged).toBe(false)
  })
})

function cond(c: Record<string, unknown>): triggerCondition {
  return c as unknown as triggerCondition
}

interface EngineSetup {
  workingChat: Chat
  db: Database
}

function makeEngine(
  opts: {
    scriptstate?: Record<string, unknown>
    defaultVariables?: [string, string][]
    displayMode?: boolean
    tempVars?: Record<string, string>
  } = {},
): ReturnType<typeof createTriggerVarEngine> & EngineSetup {
  // dbChat is the persisted chat; workingChat is the clone runTrigger makes.
  const dbChat = makeChat({ scriptstate: { ...(opts.scriptstate ?? {}) } })
  const char = makeChar({ chats: [dbChat] })
  const db = makeDb({ characters: [char] })
  const workingChat = structuredClone(dbChat)
  const engine = createTriggerVarEngine({
    chat: workingChat,
    database: db,
    selectedCharID: 0,
    chatPage: 0,
    defaultVariables: opts.defaultVariables ?? [],
    displayMode: opts.displayMode,
    tempVars: opts.tempVars,
  })
  return Object.assign(engine, { workingChat, db })
}

describe('Phase 7-9b trigger var engine', () => {
  it('falls back to default variables, then null', () => {
    const engine = makeEngine({ defaultVariables: [['greet', 'hi']] })
    expect(engine.getVar('greet')).toBe('hi')
    expect(engine.getVar('missing')).toBe('null')
  })

  it('reads chat scriptstate', () => {
    const engine = makeEngine({ scriptstate: { $hp: '10' } })
    expect(engine.getVar('hp')).toBe('10')
  })

  it('writes scriptstate, flips varChanged, and propagates to the db chat', () => {
    const engine = makeEngine()
    engine.setVar('hp', '5')
    expect(engine.workingChat.scriptstate?.['$hp']).toBe('5')
    expect(engine.varChanged).toBe(true)
    // The persisted db chat now shares the working chat's scriptstate object.
    expect(engine.db.characters[0].chats[0].scriptstate).toBe(
      engine.workingChat.scriptstate,
    )
  })

  it('local variables shadow scriptstate and stay local on write', () => {
    const engine = makeEngine({ scriptstate: { $x: 'global' } })
    engine.declareLocalVar('x', 'local', 0)
    expect(engine.getVar('x')).toBe('local')
    engine.setVar('x', 'updated')
    expect(engine.getVar('x')).toBe('updated')
    expect(engine.workingChat.scriptstate?.['$x']).toBe('global')
    expect(engine.varChanged).toBe(false)
  })

  it('clearLocalVarsAtIndent drops vars at or above the indent', () => {
    const engine = makeEngine()
    engine.declareLocalVar('a', '1', 0)
    engine.declareLocalVar('b', '2', 2)
    engine.setIndent(2)
    expect(engine.getVar('b')).toBe('2')
    engine.clearLocalVarsAtIndent(2)
    expect(engine.getVar('b')).toBe('null')
    expect(engine.getVar('a')).toBe('1')
  })

  it('displayMode keeps writes in tempVars and leaves scriptstate untouched', () => {
    const tempVars: Record<string, string> = {}
    const engine = makeEngine({ displayMode: true, tempVars })
    engine.setVar('x', '5')
    expect(tempVars.x).toBe('5')
    expect(engine.getVar('x')).toBe('5')
    expect(engine.workingChat.scriptstate?.['$x']).toBeUndefined()
    expect(engine.varChanged).toBe(false)
  })
})

describe('Phase 7-9b evaluateConditions', () => {
  it('passes a matching var condition and fails a mismatch', () => {
    const engine = makeEngine({ scriptstate: { $hp: '10' } })
    const chat = makeChat()
    expect(
      evaluateConditions(
        [cond({ type: 'var', var: 'hp', value: '10', operator: '=' })],
        engine,
        chat,
        identityExpand,
      ),
    ).toBe(true)
    expect(
      evaluateConditions(
        [cond({ type: 'var', var: 'hp', value: '5', operator: '=' })],
        engine,
        chat,
        identityExpand,
      ),
    ).toBe(false)
  })

  it('compares value literals and numeric operators', () => {
    const engine = makeEngine()
    const chat = makeChat()
    const check = (operator: string, left: string, right: string) =>
      evaluateConditions(
        [cond({ type: 'value', var: left, value: right, operator })],
        engine,
        chat,
        identityExpand,
      )
    expect(check('!=', '3', '4')).toBe(true)
    expect(check('>', '5', '4')).toBe(true)
    expect(check('<', '5', '4')).toBe(false)
    expect(check('>=', '4', '4')).toBe(true)
    expect(check('<=', '4', '4')).toBe(true)
    expect(check('true', 'true', '')).toBe(true)
    expect(check('true', 'false', '')).toBe(false)
  })

  it('checks the null operator against unset vars', () => {
    const engine = makeEngine()
    const chat = makeChat()
    expect(
      evaluateConditions(
        [cond({ type: 'var', var: 'missing', value: '', operator: 'null' })],
        engine,
        chat,
        identityExpand,
      ),
    ).toBe(true)
  })

  it('compares chatindex against the message count', () => {
    const engine = makeEngine()
    const chat = makeChat({
      message: [
        { role: 'user', data: 'a' },
        { role: 'char', data: 'b' },
      ] as never,
    })
    expect(
      evaluateConditions(
        [cond({ type: 'chatindex', value: '2', operator: '=' })],
        engine,
        chat,
        identityExpand,
      ),
    ).toBe(true)
  })

  it('handles exists strict / loose / regex over the last depth messages', () => {
    const engine = makeEngine()
    const chat = makeChat({
      message: [{ role: 'char', data: 'hello world' }] as never,
    })
    const exists = (value: string, type2: string) =>
      evaluateConditions(
        [cond({ type: 'exists', value, type2, depth: 1 })],
        engine,
        chat,
        identityExpand,
      )
    expect(exists('world', 'strict')).toBe(true)
    expect(exists('planet', 'strict')).toBe(false)
    expect(exists('WORLD', 'loose')).toBe(true)
    expect(exists('wor.d', 'regex')).toBe(true)
  })

  it('requires every condition to pass', () => {
    const engine = makeEngine({ scriptstate: { $hp: '10' } })
    const chat = makeChat()
    expect(
      evaluateConditions(
        [
          cond({ type: 'var', var: 'hp', value: '10', operator: '=' }),
          cond({ type: 'value', var: '1', value: '2', operator: '=' }),
        ],
        engine,
        chat,
        identityExpand,
      ),
    ).toBe(false)
  })

  it('setChat repoints subsequent var writes', () => {
    const engine = makeEngine()
    const other = makeChat({ scriptstate: {} })
    engine.setChat(other)
    engine.setVar('x', '1')
    expect(other.scriptstate?.['$x']).toBe('1')
  })
})

function eff(e: Record<string, unknown>): triggerscript['effect'][number] {
  return e as unknown as triggerscript['effect'][number]
}

function triggerWithEffects(
  effect: triggerscript['effect'],
  overrides: Partial<triggerscript> = {},
): triggerscript {
  return makeTrigger({ type: 'output', effect, ...overrides })
}

describe('Phase 7-9c deterministic V1 effects', () => {
  it('setvar assigns and flips varChanged', async () => {
    const char = makeChar({
      triggerscript: [
        triggerWithEffects([eff({ type: 'setvar', operator: '=', var: 'hp', value: '5' })]),
      ],
    })
    const result = await runTrigger(ctx, char, 'output', { chat: makeChat() })
    expect(result?.chat.scriptstate?.['$hp']).toBe('5')
    expect(result?.varChanged).toBe(true)
  })

  it('setvar applies numeric operators against the current value', async () => {
    const char = makeChar({
      triggerscript: [
        triggerWithEffects([eff({ type: 'setvar', operator: '+=', var: 'n', value: '2' })]),
      ],
    })
    const result = await runTrigger(ctx, char, 'output', {
      chat: makeChat({ scriptstate: { $n: '3' } }),
    })
    expect(result?.chat.scriptstate?.['$n']).toBe('5')
  })

  it('systemprompt accumulates into a slot and counts tokens', async () => {
    const char = makeChar({
      triggerscript: [
        triggerWithEffects([
          eff({ type: 'systemprompt', location: 'start', value: 'You are a cat.' }),
        ]),
      ],
    })
    const result = await runTrigger(ctx, char, 'output', { chat: makeChat() })
    expect(result?.additonalSysPrompt.start).toBe('You are a cat.\n\n')
    expect(result?.tokens).toBeGreaterThan(0)
  })

  it('impersonate appends a message', async () => {
    const char = makeChar({
      triggerscript: [
        triggerWithEffects([eff({ type: 'impersonate', role: 'user', value: 'hello' })]),
      ],
    })
    const result = await runTrigger(ctx, char, 'output', { chat: makeChat() })
    expect(result?.chat.message.at(-1)).toEqual({ role: 'user', data: 'hello' })
  })

  it('cutchat slices the message list', async () => {
    const char = makeChar({
      triggerscript: [
        triggerWithEffects([eff({ type: 'cutchat', start: '1', end: '3' })]),
      ],
    })
    const chat = makeChat({
      message: [
        { role: 'user', data: 'a' },
        { role: 'char', data: 'b' },
        { role: 'user', data: 'c' },
        { role: 'char', data: 'd' },
      ] as never,
    })
    const result = await runTrigger(ctx, char, 'output', { chat })
    expect(result?.chat.message.map((m) => m.data)).toEqual(['b', 'c'])
  })

  it('modifychat edits an existing row', async () => {
    const char = makeChar({
      triggerscript: [
        triggerWithEffects([eff({ type: 'modifychat', index: '0', value: 'edited' })]),
      ],
    })
    const chat = makeChat({ message: [{ role: 'char', data: 'orig' }] as never })
    const result = await runTrigger(ctx, char, 'output', { chat })
    expect(result?.chat.message[0].data).toBe('edited')
  })

  it('stop sets stopSending', async () => {
    const char = makeChar({
      triggerscript: [triggerWithEffects([eff({ type: 'stop' })])],
    })
    const result = await runTrigger(ctx, char, 'output', { chat: makeChat() })
    expect(result?.stopSending).toBe(true)
  })

  it('runtrigger recurses into a named manual trigger and threads its result', async () => {
    const sub = makeTrigger({
      comment: 'sub',
      type: 'manual',
      effect: [eff({ type: 'setvar', operator: '=', var: 'hp', value: '99' })],
    })
    const outer = triggerWithEffects([eff({ type: 'runtrigger', value: 'sub' })])
    const char = makeChar({ triggerscript: [outer, sub] })
    const result = await runTrigger(ctx, char, 'output', { chat: makeChat() })
    expect(result?.chat.scriptstate?.['$hp']).toBe('99')
    expect(result?.varChanged).toBe(true)
  })

  it('runtrigger recursion terminates at the bound', async () => {
    const loop = makeTrigger({
      comment: 'loop',
      type: 'manual',
      effect: [eff({ type: 'runtrigger', value: 'loop' })],
    })
    const char = makeChar({ triggerscript: [loop] })
    const result = await runTrigger(ctx, char, 'manual', {
      chat: makeChat(),
      manualName: 'loop',
    })
    expect(result).not.toBeNull()
  })
})
