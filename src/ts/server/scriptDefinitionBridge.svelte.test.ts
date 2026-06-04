import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'

const recorded = vi.hoisted(() => ({
  commands: [] as Array<{ built: Record<string, unknown>; rollback?: () => void }>,
}))
const projectionGuardState = vi.hoisted(() => ({ epoch: 0 }))

vi.mock('./commands', () => ({
  canUseServerCommands: () => true,
  replaceCharacterScriptsCommand: async (args: Record<string, unknown>) => ({
    kind: 'replaceCharacterScripts',
    ...args,
  }),
  replaceCharacterTriggersCommand: async (args: Record<string, unknown>) => ({
    kind: 'replaceCharacterTriggers',
    ...args,
  }),
  replaceModuleScriptsCommand: async (args: Record<string, unknown>) => ({
    kind: 'replaceModuleScripts',
    ...args,
  }),
  replaceModuleTriggersCommand: async (args: Record<string, unknown>) => ({
    kind: 'replaceModuleTriggers',
    ...args,
  }),
  runServerCommand: vi.fn(
    async (args: {
      command: (baseRevision: number) => Promise<Record<string, unknown>>
      rollback?: () => void
    }) => {
      const built = await args.command(1)
      recorded.commands.push({ built, rollback: args.rollback })
      return { status: 'ok', revision: 1 }
    },
  ),
}))

vi.mock('./projectionWriteGuard.svelte', () => ({
  getServerProjectionApplyEpoch: () => projectionGuardState.epoch,
  withTrustedServerProjectionWrite: (fn: () => unknown) => fn(),
}))

import { DBState } from '../stores.svelte'
import { withCloneInstrumentation } from '../__tests__/cloneCostHarness'
import { watchServerBackedScriptDefinitions } from './scriptDefinitionBridge.svelte'

const DELAY = 50

function script(id: string, out: string): {
  id: string
  comment: string
  in: string
  out: string
  type: string
} {
  return {
    id,
    comment: id,
    in: '',
    out,
    type: 'regex',
  }
}

function trigger(id: string, comment: string): {
  id: string
  comment: string
  type: 'manual'
  conditions: []
  effect: []
} {
  return {
    id,
    comment,
    type: 'manual',
    conditions: [],
    effect: [],
  }
}

function setupScriptDefinitions(): void {
  ;(DBState as { db: unknown }).db = {
    characters: [
      {
        chaId: 'char-1',
        customscript: [script('script-1', 'initial')],
        triggerscript: [trigger('trigger-1', 'initial trigger')],
      },
    ],
    modules: [
      {
        id: 'module-1',
        regex: [script('module-script-1', 'initial module')],
        trigger: [trigger('module-trigger-1', 'initial module trigger')],
      },
    ],
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  projectionGuardState.epoch = 0
  recorded.commands.length = 0
})

afterEach(() => {
  vi.useRealTimers()
  ;(DBState as { db: unknown }).db = {}
})

describe('watchServerBackedScriptDefinitions baselines', () => {
  it('refreshes baseline on server projection updates before local script edits', async () => {
    setupScriptDefinitions()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    projectionGuardState.epoch += 1
    DBState.db.characters[0].customscript = [script('script-1', 'server')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.commands).toEqual([])

    DBState.db.characters[0].customscript = [script('script-1', 'local')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()

    expect(recorded.commands.map((entry) => entry.built)).toEqual([
      {
        kind: 'replaceCharacterScripts',
        baseRevision: 1,
        characterId: 'char-1',
        scripts: [script('script-1', 'local')],
      },
    ])
    stop()
  })

  it('refreshes baseline on server projection updates before local module trigger edits', async () => {
    setupScriptDefinitions()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    projectionGuardState.epoch += 1
    DBState.db.modules[0].trigger = [trigger('module-trigger-1', 'server')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.commands).toEqual([])

    DBState.db.modules[0].trigger = [trigger('module-trigger-1', 'local')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()

    expect(recorded.commands.map((entry) => entry.built)).toEqual([
      {
        kind: 'replaceModuleTriggers',
        baseRevision: 1,
        moduleId: 'module-1',
        triggers: [trigger('module-trigger-1', 'local')],
      },
    ])
    stop()
  })

  it('does not echo command rollback state restoration', async () => {
    setupScriptDefinitions()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    DBState.db.characters[0].customscript = [script('script-1', 'local')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()
    expect(recorded.commands).toHaveLength(1)

    recorded.commands[0].rollback?.()
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.commands).toHaveLength(1)
    stop()
  })
})

const BIG_BODY = 'x'.repeat(5000)

// One character carries a large hydrated message history (~250 KB) alongside a
// small customscript, so a whole-characters clone is distinguishable from the
// per-key scripts/triggers stringify by serialized size.
function setupHydratedScriptDefinitions(): void {
  ;(DBState as { db: unknown }).db = {
    characters: [
      {
        chaId: 'char-1',
        customscript: [script('script-1', 'initial')],
        triggerscript: [trigger('trigger-1', 'initial trigger')],
        chats: [
          {
            id: 'chat-1',
            name: 'Chat',
            message: Array.from({ length: 50 }, (_unused, index) => ({
              role: index % 2 === 0 ? 'user' : 'char',
              data: BIG_BODY,
              chatId: `msg-${index}`,
            })),
            localLore: [{ content: BIG_BODY }],
          },
        ],
      },
    ],
    modules: [],
  }
}

describe('watchServerBackedScriptDefinitions clone cost (Phase 4)', () => {
  it('captures the baseline without serializing the hydrated message history', () => {
    setupHydratedScriptDefinitions()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })

    // The first effect run captures the per-key scripts/triggers baseline only.
    // It must never clone the whole characters graph (message history included).
    const instrumented = withCloneInstrumentation(() => flushSync())

    expect(instrumented.maxClonedSize).toBeLessThan(BIG_BODY.length)
    expect(recorded.commands).toEqual([])
    stop()
  })

  it('detects a script edit without cloning the full characters graph', async () => {
    setupHydratedScriptDefinitions()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    // A local script edit must dispatch a replacement, but the effect fire that
    // detects it must stay O(scripts): no whole-characters+modules clone.
    const instrumented = withCloneInstrumentation(() => {
      DBState.db.characters[0].customscript = [script('script-1', 'edited')]
      flushSync()
    })

    expect(instrumented.maxClonedSize).toBeLessThan(BIG_BODY.length)

    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()
    expect(recorded.commands.map((entry) => entry.built)).toEqual([
      {
        kind: 'replaceCharacterScripts',
        baseRevision: 1,
        characterId: 'char-1',
        scripts: [script('script-1', 'edited')],
      },
    ])
    stop()
  })

  it('does not clone or wake on a streaming message append', async () => {
    setupHydratedScriptDefinitions()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    // A streaming chunk only mutates message[], which the script watcher never
    // reads: it must neither clone the transcript nor queue a replacement.
    const instrumented = withCloneInstrumentation(() => {
      DBState.db.characters[0].chats[0].message.push({
        role: 'char',
        data: BIG_BODY,
        chatId: 'msg-stream',
      })
      flushSync()
    })
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(instrumented.maxClonedSize).toBeLessThan(BIG_BODY.length)
    expect(recorded.commands).toEqual([])
    stop()
  })
})

describe('watchServerBackedScriptDefinitions scoped rollback (Phase 4)', () => {
  function setupTwoCharacters(): void {
    ;(DBState as { db: unknown }).db = {
      characters: [
        {
          chaId: 'char-1',
          customscript: [script('script-1', 'initial')],
          triggerscript: [trigger('trigger-1', 'initial trigger')],
        },
        {
          chaId: 'char-2',
          customscript: [script('script-2', 'initial-2')],
          triggerscript: [trigger('trigger-2', 'initial trigger 2')],
        },
      ],
      modules: [],
    }
  }

  it('restores only the changed character, leaving unrelated characters untouched', async () => {
    setupTwoCharacters()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    // Edit char-1 → queues a replacement carrying a char-1-scoped rollback.
    DBState.db.characters[0].customscript = [script('script-1', 'char1-local')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()
    expect(recorded.commands).toHaveLength(1)

    // Concurrently, an unrelated character changes and char-1 changes further.
    // A whole-characters rollback would clobber char-2 back to its baseline.
    DBState.db.characters[1].customscript = [script('script-2', 'char2-concurrent')]
    DBState.db.characters[0].customscript = [script('script-1', 'char1-newer')]

    recorded.commands[0].rollback?.()

    expect(DBState.db.characters[0].customscript).toEqual([script('script-1', 'initial')])
    expect(DBState.db.characters[1].customscript).toEqual([script('script-2', 'char2-concurrent')])
    stop()
  })

  it('restores only the changed module trigger, leaving other module fields untouched', async () => {
    ;(DBState as { db: unknown }).db = {
      characters: [],
      modules: [
        {
          id: 'module-1',
          regex: [script('module-script-1', 'initial module')],
          trigger: [trigger('module-trigger-1', 'initial module trigger')],
        },
      ],
    }
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    DBState.db.modules[0].trigger = [trigger('module-trigger-1', 'local')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()
    expect(recorded.commands).toHaveLength(1)

    // A sibling field (regex) and the trigger change after the dispatch.
    DBState.db.modules[0].regex = [script('module-script-1', 'regex-concurrent')]
    DBState.db.modules[0].trigger = [trigger('module-trigger-1', 'newer')]

    recorded.commands[0].rollback?.()

    expect(DBState.db.modules[0].trigger).toEqual([trigger('module-trigger-1', 'initial module trigger')])
    expect(DBState.db.modules[0].regex).toEqual([script('module-script-1', 'regex-concurrent')])
    stop()
  })
})

describe('watchServerBackedScriptDefinitions debounced rollback baseline (Phase 4)', () => {
  it('rolls a coalesced character-script edit back to the pre-first-edit baseline', async () => {
    setupScriptDefinitions()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    // Edit A then edit B for the same key, both inside the debounce window so the
    // two dispatches coalesce into a single pending command.
    DBState.db.characters[0].customscript = [script('script-1', 'edit-A')]
    flushSync()
    DBState.db.characters[0].customscript = [script('script-1', 'edit-B')]
    flushSync()

    // No command fires until the debounce elapses: only the coalesced one runs.
    expect(recorded.commands).toEqual([])

    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()

    // The final command sends edit-B, the latest content.
    expect(recorded.commands.map((entry) => entry.built)).toEqual([
      {
        kind: 'replaceCharacterScripts',
        baseRevision: 1,
        characterId: 'char-1',
        scripts: [script('script-1', 'edit-B')],
      },
    ])

    // On failure, rollback must restore the pre-first-edit baseline ('initial'),
    // not the intermediate 'edit-A' that was never durably committed.
    recorded.commands[0].rollback?.()
    expect(DBState.db.characters[0].customscript).toEqual([script('script-1', 'initial')])
    stop()
  })

  it('rolls a coalesced module-trigger edit back to the pre-first-edit baseline', async () => {
    setupScriptDefinitions()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    DBState.db.modules[0].trigger = [trigger('module-trigger-1', 'edit-A')]
    flushSync()
    DBState.db.modules[0].trigger = [trigger('module-trigger-1', 'edit-B')]
    flushSync()

    expect(recorded.commands).toEqual([])

    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()

    expect(recorded.commands.map((entry) => entry.built)).toEqual([
      {
        kind: 'replaceModuleTriggers',
        baseRevision: 1,
        moduleId: 'module-1',
        triggers: [trigger('module-trigger-1', 'edit-B')],
      },
    ])

    recorded.commands[0].rollback?.()
    expect(DBState.db.modules[0].trigger).toEqual([trigger('module-trigger-1', 'initial module trigger')])
    stop()
  })
})
