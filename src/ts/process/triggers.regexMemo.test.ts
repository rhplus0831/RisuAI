import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

// Trigger regexes are memoized across repeated effect runs.

vi.mock('./modules', async (importActual) => {
  const actual = await importActual<typeof import('./modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

import '../stores.svelte'
import { getCompiledRegex, resetScriptCache } from './scripts'
import { runTrigger } from './triggers'
import { safeStructuredClone } from '../polyfill'
import { setResourceWriteGuardEnabled } from '../server/resourceWriteGuard.svelte'
import { ReloadGUIPointer, VariableReloadGUIPointer, selectedCharID } from '../stores.svelte'
import { testDatabaseState } from '../__tests__/resourceDatabaseState'
import type { character } from '../storage/database.svelte'

function seedDb(): void {
  selectedCharID.set(0)
  testDatabaseState.db = {
    characters: [
      {
        chaId: 'char-a',
        name: 'Character',
        desc: '',
        chatPage: 0,
        chats: [{ id: 'chat-1', message: [], note: '', name: 'main', localLore: [], scriptstate: {} }],
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

function characterWithTriggers(triggerscript: unknown[], overrides: Record<string, unknown> = {}): character {
  return { ...testDatabaseState.db.characters[0], triggerscript, ...overrides } as unknown as character
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
  ;(globalThis as { RegExp: RegExpConstructor }).RegExp = CountingRegExp as unknown as RegExpConstructor
  try {
    return { result: await fn(compiles), compiles }
  } finally {
    ;(globalThis as { RegExp: RegExpConstructor }).RegExp = RealRegExp
  }
}

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).safeStructuredClone = safeStructuredClone
  setResourceWriteGuardEnabled(false)
  resetScriptCache()
  ReloadGUIPointer.set(0)
  VariableReloadGUIPointer.set(0)
  seedDb()
})

afterEach(() => {
  selectedCharID.set(-1)
})

// NOTE on memo lifetime: var-writing trigger refreshes route away from the
// definition-level GUI reload, so `resetScriptCache()` is not called at the end
// of a setVar pass. The compile counts below therefore assert both within-pass
// reuse and cross-pass survival for variable-only trigger updates.
describe('trigger-effect compiled regex memoization (L40)', () => {
  it('H3: v2UpdateGUI bumps only the variable-only GUI pointer and preserves script caches', async () => {
    const regexBefore = getCompiledRegex('h3-update-gui-cache-proof', 'g')
    const char = characterWithTriggers([
      {
        comment: 'update-gui',
        type: 'manual',
        conditions: [],
        effect: [{ type: 'v2UpdateGUI' }],
      },
    ])

    const broadBefore = get(ReloadGUIPointer)
    const variableBefore = get(VariableReloadGUIPointer)

    await runTrigger(char, 'manual', {
      chat: char.chats[char.chatPage],
      manualName: 'update-gui',
      deferLiveChatSideEffects: true,
    })

    expect(get(ReloadGUIPointer)).toBe(broadBefore)
    expect(get(VariableReloadGUIPointer)).toBe(variableBefore + 1)
    expect(getCompiledRegex('h3-update-gui-cache-proof', 'g')).toBe(regexBefore)
  })

  it('H3/L40: v2RegexTest memo survives variable-only trigger refreshes, output unchanged', async () => {
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
        deferLiveChatSideEffects: true,
      })
      const compilesAfterFirstPass = compiles.get('l40-w[a-z]+d')
      const second = await runTrigger(char, 'manual', {
        chat: first?.chat ?? char.chats[char.chatPage],
        manualName: 'regex-test',
        deferLiveChatSideEffects: true,
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
    // The memo stays warm across variable-only trigger refreshes.
    expect(compiles.get('l40-w[a-z]+d')).toBe(1)
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
        deferLiveChatSideEffects: true,
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
        deferLiveChatSideEffects: true,
      })
      return { run, compilesAfterPass: compiles.get('id=l40-(\\d+)') }
    })
    const { run, compilesAfterPass } = result

    expect(run?.chat.scriptstate?.['$extracted']).toBe('12345')
    expect(run?.chat.scriptstate?.['$extracted2']).toBe('12345')
    expect(compilesAfterPass).toBe(1)
  })

  it('low-level extractRegex returns an empty substitution when the regex does not match', async () => {
    const char = characterWithTriggers(
      [
        {
          comment: 'extract-no-match',
          type: 'manual',
          conditions: [],
          effect: [
            {
              type: 'extractRegex',
              value: 'no matching value',
              regex: 'id=(\\d+)',
              flags: '',
              result: 'before-$1-$&-$$-after',
              inputVar: 'extracted',
            },
          ],
        },
      ],
      { lowLevelAccess: true },
    )

    const run = await runTrigger(char, 'manual', {
      chat: char.chats[char.chatPage],
      manualName: 'extract-no-match',
      deferLiveChatSideEffects: true,
    })
    expect(run?.chat.scriptstate?.['$extracted']).toBe('before---$-after')
  })

  it('low-level extractRegex renders unmatched optional captures as empty text', async () => {
    const char = characterWithTriggers(
      [
        {
          comment: 'extract-optional',
          type: 'manual',
          conditions: [],
          effect: [
            {
              type: 'extractRegex',
              value: 'b',
              regex: '^(a)?b$',
              flags: '',
              result: '<$1>|<$&>',
              inputVar: 'extracted',
            },
          ],
        },
      ],
      { lowLevelAccess: true },
    )

    const run = await runTrigger(char, 'manual', {
      chat: char.chats[char.chatPage],
      manualName: 'extract-optional',
      deferLiveChatSideEffects: true,
    })

    expect(run?.chat.scriptstate?.['$extracted']).toBe('<>|<b>')
  })
})
