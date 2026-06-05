import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// L40 (Phase 7): trigger effects compiled `new RegExp(...)` on every effect
// execution (9 sites across v1/v2 effects and conditions). They now reuse the
// shared `getCompiledRegex` memo from `./scripts`, so re-running the same
// trigger compiles each pattern once. Compile counts are observed by swapping
// the global RegExp constructor for a counting subclass — `new RegExp(...)`
// inside the memo's miss path resolves the global binding at call time.

vi.mock('../platform', async (importActual) => {
  const actual = await importActual<typeof import('../platform')>()
  return { ...actual, isFastifyServer: true }
})

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'trigger-regexmemo-token',
}))

vi.mock('./modules', async (importActual) => {
  const actual = await importActual<typeof import('./modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

// Initialize the stores module first: its top-level ReloadGUIPointer.subscribe
// fires synchronously and calls resetScriptCache(), which TDZ-throws if
// ./scripts is the entry import and has not finished evaluating yet.
import '../stores.svelte'
import { resetScriptCache } from './scripts'
import { runTrigger } from './triggers'
import { safeStructuredClone } from '../polyfill'
import { clearCachedServerCommandRevision } from '../server/commands'
import { setServerProjectionWriteGuardEnabled } from '../server/projectionWriteGuard.svelte'
import { DBState, selectedCharID } from '../stores.svelte'
import type { character } from '../storage/database.svelte'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubCommandFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
      if (url.startsWith('/api/v1/commands/chats/')) {
        return jsonResponse({
          revision: 11,
          event: { type: 'chat.updated', revision: 11, resource: 'chat' },
        })
      }
      return jsonResponse({ revision: 11, event: { type: 'noop', revision: 11 } })
    }) as unknown as typeof fetch,
  )
}

function seedDb(): void {
  selectedCharID.set(0)
  DBState.db = {
    characters: [
      {
        chaId: 'char-a',
        name: 'Character',
        desc: '',
        chatPage: 0,
        chats: [
          { id: 'chat-1', message: [], note: '', name: 'main', localLore: [], scriptstate: {} },
        ],
        triggerscript: [],
        defaultVariables: '',
        globalLore: [],
        type: 'character',
      },
    ],
    characterOrder: [],
    templateDefaultVariables: '',
  } as any
}

function characterWithTriggers(
  triggerscript: unknown[],
  overrides: Record<string, unknown> = {},
): character {
  return { ...DBState.db.characters[0], triggerscript, ...overrides } as unknown as character
}

// Awaits the worker before restoring the global so compiles that happen across
// await boundaries inside `runTrigger` are still counted. The live count map is
// passed to the worker for mid-flight observations.
async function countRegexCompiles<T>(
  fn: (compiles: Map<string, number>) => Promise<T>,
): Promise<{ result: T; compiles: Map<string, number> }> {
  const RealRegExp = globalThis.RegExp
  const compiles = new Map<string, number>()
  class CountingRegExp extends RealRegExp {
    constructor(pattern: string | RegExp, flags?: string) {
      super(pattern as string, flags)
      const key = typeof pattern === 'string' ? pattern : pattern.source
      compiles.set(key, (compiles.get(key) ?? 0) + 1)
    }
  }
  ;(globalThis as { RegExp: RegExpConstructor }).RegExp =
    CountingRegExp as unknown as RegExpConstructor
  try {
    return { result: await fn(compiles), compiles }
  } finally {
    ;(globalThis as { RegExp: RegExpConstructor }).RegExp = RealRegExp
  }
}

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).safeStructuredClone = safeStructuredClone
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  resetScriptCache()
  seedDb()
  stubCommandFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
  selectedCharID.set(-1)
})

// NOTE on memo lifetime: a var-writing trigger pass bumps ReloadGUIPointer at
// its end, whose subscription calls resetScriptCache() — so the compiled-regex
// memo lives within one trigger pass for setVar-style triggers (and across
// renders for display-mode passes, which only write tempVars). The compile
// counts below therefore assert per-pass reuse: the same pattern used by two
// effects in one pass compiles once (it compiled once per effect before L40).
describe('trigger-effect compiled regex memoization (L40)', () => {
  it('L40: v2RegexTest compiles a pattern shared by two effects once per pass, output unchanged', async () => {
    const regexTestEffect = (outputVar: string) => ({
      type: 'v2RegexTest',
      valueType: 'value',
      value: 'hello l40-world',
      regexType: 'value',
      regex: 'l40-w[a-z]+d',
      flagsType: 'value',
      flags: 'g',
      outputVar,
    })
    const char = characterWithTriggers([
      {
        comment: 'regex-test',
        type: 'manual',
        conditions: [],
        effect: [regexTestEffect('out'), regexTestEffect('out2')],
      },
    ])

    const { result, compiles } = await countRegexCompiles(async (compiles) => {
      const first = await runTrigger(char, 'manual', {
        chat: char.chats[char.chatPage],
        manualName: 'regex-test',
      })
      const compilesAfterFirstPass = compiles.get('l40-w[a-z]+d')
      const second = await runTrigger(char, 'manual', {
        chat: first?.chat ?? char.chats[char.chatPage],
        manualName: 'regex-test',
      })
      return { first, second, compilesAfterFirstPass }
    })
    const { first, second, compilesAfterFirstPass } = result

    // Identical behavior for both effects on both passes (a cached global-flag
    // regex must not leak lastIndex between uses).
    expect(first?.chat.scriptstate?.['$out']).toBe('1')
    expect(first?.chat.scriptstate?.['$out2']).toBe('1')
    expect(second?.chat.scriptstate?.['$out']).toBe('1')
    expect(second?.chat.scriptstate?.['$out2']).toBe('1')
    // Two effects, one compile within the pass (formerly one per effect).
    expect(compilesAfterFirstPass).toBe(1)
    // The setVar pass reset the cache at its end, so the second pass compiles
    // once more — still one per pass, not one per effect.
    expect(compiles.get('l40-w[a-z]+d')).toBe(2)
  })

  it('L40: v2ReplaceString reuses the memoized regex within a pass and replaces identically', async () => {
    const replaceEffect = (outputVar: string) => ({
      type: 'v2ReplaceString',
      sourceType: 'value',
      source: 'l40-a1 l40-a2 l40-a3',
      regexType: 'value',
      regex: 'l40-a(\\d)',
      resultType: 'value',
      result: '[$1]',
      replacementType: 'value',
      replacement: '',
      flagsType: 'value',
      flags: 'g',
      outputVar,
    })
    const char = characterWithTriggers([
      {
        comment: 'replace',
        type: 'manual',
        conditions: [],
        effect: [replaceEffect('replaced'), replaceEffect('replaced2')],
      },
    ])

    const { result, compiles } = await countRegexCompiles(async (compiles) => {
      const run = await runTrigger(char, 'manual', {
        chat: char.chats[char.chatPage],
        manualName: 'replace',
      })
      return { run, compilesAfterPass: compiles.get('l40-a(\\d)') }
    })
    const { run, compilesAfterPass } = result

    // The shared global regex replaces identically for both effects.
    expect(run?.chat.scriptstate?.['$replaced']).toBe('[1] [2] [3]')
    expect(run?.chat.scriptstate?.['$replaced2']).toBe('[1] [2] [3]')
    // Two effects, one compile.
    expect(compilesAfterPass).toBe(1)
  })

  it('L40: low-level extractRegex compiles once per pass and extracts identically', async () => {
    // `extractRegex` is gated on the trigger's lowLevelAccess, which runTrigger
    // derives from the character-level grant.
    const extractEffect = (inputVar: string) => ({
      type: 'extractRegex',
      value: 'id=l40-12345;',
      regex: 'id=l40-(\\d+)',
      flags: '',
      result: '$1',
      inputVar,
    })
    const char = characterWithTriggers(
      [
        {
          comment: 'extract',
          type: 'manual',
          conditions: [],
          effect: [extractEffect('extracted'), extractEffect('extracted2')],
        },
      ],
      { lowLevelAccess: true },
    )

    const { result, compiles } = await countRegexCompiles(async (compiles) => {
      const run = await runTrigger(char, 'manual', {
        chat: char.chats[char.chatPage],
        manualName: 'extract',
      })
      return { run, compilesAfterPass: compiles.get('id=l40-(\\d+)') }
    })
    const { run, compilesAfterPass } = result

    expect(run?.chat.scriptstate?.['$extracted']).toBe('12345')
    expect(run?.chat.scriptstate?.['$extracted2']).toBe('12345')
    expect(compilesAfterPass).toBe(1)
  })
})
