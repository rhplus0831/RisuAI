import { describe, expect, it } from 'vitest'
import type {
  Chat,
  character,
} from '../../../src/ts/storage/database.svelte'
import type { RisuModule } from '../../../src/ts/process/modules'
import type { triggerscript } from '../../../src/ts/process/triggers'
import { getModuleTriggers } from '../src/prompt/modules.js'
import {
  collectTriggers,
  matchesTrigger,
  runTrigger,
  type TriggerRunContext,
} from '../src/prompt/triggers.js'

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

const ctx: TriggerRunContext = { modules: [] }

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
    const result = await runTrigger(
      { modules: [mod] },
      char,
      'output',
      { chat: makeChat() },
    )
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
})
