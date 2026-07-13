import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const recorded = vi.hoisted(() => ({
  commands: [] as Array<{
    built: Record<string, unknown>
    rollback?: () => void
    keepalive?: boolean
  }>,
  characterDefinitionCalls: [] as Array<{
    kind: 'scripts' | 'triggers'
    optimisticRowEpoch: unknown
    acknowledgeOptimistic: unknown
  }>,
  moduleDefinitionCalls: [] as Array<{
    kind: 'scripts' | 'triggers'
    optimisticCollectionEpoch: unknown
    acknowledgeOptimistic: unknown
  }>,
  compactDefinitionCalls: [] as Array<{
    scope: 'global' | 'character' | 'module'
    kind: 'scripts' | 'triggers'
    targetId: string
    mutation: unknown
    expectedDefinitions: unknown
    keepalive: unknown
  }>,
  fullDefinitionCalls: [] as Array<{
    scope: 'global' | 'character' | 'module'
    kind: 'scripts' | 'triggers'
    targetId: string
  }>,
  commandResults: [] as Array<
    | { status: 'ok'; revision: number }
    | { status: 'error'; error: string }
    | Promise<{ status: 'ok'; revision: number } | { status: 'error'; error: string }>
  >,
}))
const resourceGuardState = vi.hoisted(() => ({ epoch: 0 }))
const characterRowProjectionState = vi.hoisted(() => ({ epoch: 0 }))
const moduleCollectionProjectionState = vi.hoisted(() => ({ epoch: 0 }))
const settingsGroupProjectionState = vi.hoisted(() => ({ epoch: 0 }))

vi.mock('../stores.svelte', async () => {
  const { writable } = await import('svelte/store')
  return {
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
  }
})

vi.mock('./commands', () => {
  const resolveCommand = async (built: Record<string, unknown>) => {
    const configured = recorded.commandResults.shift()
    const result = configured ? await configured : { status: 'ok' as const, revision: 1 }
    return { ...result, __built: built }
  }

  return {
    canUseServerCommands: () => true,
    subscribeServerCommandLocalEffectApplied: () => () => {},
    patchSettingsGroup: async (args: Record<string, unknown>) => {
      const { optimisticProjectionEpoch: _optimisticProjectionEpoch, ...built } = args
      recorded.fullDefinitionCalls.push({ scope: 'global', kind: 'scripts', targetId: 'globalscript' })
      return resolveCommand({ kind: 'replaceGlobalScripts', ...built })
    },
    mutateGlobalScriptsCommand: async (args: Record<string, unknown>, _signal: unknown, keepalive: unknown) => {
      const { expectedScripts, mutation, optimisticProjectionEpoch: _optimisticProjectionEpoch, ...built } = args
      recorded.compactDefinitionCalls.push({
        scope: 'global',
        kind: 'scripts',
        targetId: 'globalscript',
        mutation,
        expectedDefinitions: expectedScripts,
        keepalive,
      })
      return resolveCommand({ kind: 'mutateGlobalScripts', ...built, scripts: expectedScripts })
    },
    replaceCharacterScriptsCommand: async (
      args: Record<string, unknown>,
      _signal: unknown,
      _keepalive: unknown,
      acknowledgeOptimistic: unknown,
    ) => {
      const { optimisticRowEpoch, ...built } = args
      recorded.fullDefinitionCalls.push({ scope: 'character', kind: 'scripts', targetId: String(args.characterId) })
      recorded.characterDefinitionCalls.push({ kind: 'scripts', optimisticRowEpoch, acknowledgeOptimistic })
      return resolveCommand({ kind: 'replaceCharacterScripts', ...built })
    },
    replaceCharacterTriggersCommand: async (
      args: Record<string, unknown>,
      _signal: unknown,
      _keepalive: unknown,
      acknowledgeOptimistic: unknown,
    ) => {
      const { optimisticRowEpoch, ...built } = args
      recorded.fullDefinitionCalls.push({ scope: 'character', kind: 'triggers', targetId: String(args.characterId) })
      recorded.characterDefinitionCalls.push({ kind: 'triggers', optimisticRowEpoch, acknowledgeOptimistic })
      return resolveCommand({ kind: 'replaceCharacterTriggers', ...built })
    },
    replaceModuleScriptsCommand: async (
      args: Record<string, unknown>,
      _signal: unknown,
      _keepalive: unknown,
      acknowledgeOptimistic: unknown,
    ) => {
      const { optimisticCollectionEpoch, ...built } = args
      recorded.fullDefinitionCalls.push({ scope: 'module', kind: 'scripts', targetId: String(args.moduleId) })
      recorded.moduleDefinitionCalls.push({ kind: 'scripts', optimisticCollectionEpoch, acknowledgeOptimistic })
      return resolveCommand({ kind: 'replaceModuleScripts', ...built })
    },
    replaceModuleTriggersCommand: async (
      args: Record<string, unknown>,
      _signal: unknown,
      _keepalive: unknown,
      acknowledgeOptimistic: unknown,
    ) => {
      const { optimisticCollectionEpoch, ...built } = args
      recorded.fullDefinitionCalls.push({ scope: 'module', kind: 'triggers', targetId: String(args.moduleId) })
      recorded.moduleDefinitionCalls.push({ kind: 'triggers', optimisticCollectionEpoch, acknowledgeOptimistic })
      return resolveCommand({ kind: 'replaceModuleTriggers', ...built })
    },
    mutateCharacterScriptsCommand: async (
      args: Record<string, unknown>,
      _signal: unknown,
      keepalive: unknown,
      acknowledgeOptimistic: unknown,
    ) => {
      const { optimisticRowEpoch, expectedScripts, mutation, ...built } = args
      recorded.characterDefinitionCalls.push({ kind: 'scripts', optimisticRowEpoch, acknowledgeOptimistic })
      recorded.compactDefinitionCalls.push({
        scope: 'character',
        kind: 'scripts',
        targetId: String(args.characterId),
        mutation,
        expectedDefinitions: expectedScripts,
        keepalive,
      })
      return resolveCommand({ kind: 'replaceCharacterScripts', ...built, scripts: expectedScripts })
    },
    mutateCharacterTriggersCommand: async (
      args: Record<string, unknown>,
      _signal: unknown,
      keepalive: unknown,
      acknowledgeOptimistic: unknown,
    ) => {
      const { optimisticRowEpoch, expectedTriggers, mutation, ...built } = args
      recorded.characterDefinitionCalls.push({ kind: 'triggers', optimisticRowEpoch, acknowledgeOptimistic })
      recorded.compactDefinitionCalls.push({
        scope: 'character',
        kind: 'triggers',
        targetId: String(args.characterId),
        mutation,
        expectedDefinitions: expectedTriggers,
        keepalive,
      })
      return resolveCommand({ kind: 'replaceCharacterTriggers', ...built, triggers: expectedTriggers })
    },
    mutateModuleScriptsCommand: async (
      args: Record<string, unknown>,
      _signal: unknown,
      keepalive: unknown,
      acknowledgeOptimistic: unknown,
    ) => {
      const { optimisticCollectionEpoch, expectedScripts, mutation, ...built } = args
      recorded.moduleDefinitionCalls.push({ kind: 'scripts', optimisticCollectionEpoch, acknowledgeOptimistic })
      recorded.compactDefinitionCalls.push({
        scope: 'module',
        kind: 'scripts',
        targetId: String(args.moduleId),
        mutation,
        expectedDefinitions: expectedScripts,
        keepalive,
      })
      return resolveCommand({ kind: 'replaceModuleScripts', ...built, scripts: expectedScripts })
    },
    mutateModuleTriggersCommand: async (
      args: Record<string, unknown>,
      _signal: unknown,
      keepalive: unknown,
      acknowledgeOptimistic: unknown,
    ) => {
      const { optimisticCollectionEpoch, expectedTriggers, mutation, ...built } = args
      recorded.moduleDefinitionCalls.push({ kind: 'triggers', optimisticCollectionEpoch, acknowledgeOptimistic })
      recorded.compactDefinitionCalls.push({
        scope: 'module',
        kind: 'triggers',
        targetId: String(args.moduleId),
        mutation,
        expectedDefinitions: expectedTriggers,
        keepalive,
      })
      return resolveCommand({ kind: 'replaceModuleTriggers', ...built, triggers: expectedTriggers })
    },
    runServerCommand: vi.fn(
      async (args: {
        command: (baseRevision: number) => Promise<Record<string, unknown>>
        rollback?: () => void
        keepalive?: boolean
      }) => {
        const rawResult = await args.command(1)
        const { __built, ...result } = rawResult
        recorded.commands.push({
          built: (__built ?? {}) as Record<string, unknown>,
          rollback: args.rollback,
          ...(args.keepalive ? { keepalive: args.keepalive } : {}),
        })
        if (result.status !== 'ok') args.rollback?.()
        return result
      },
    ),
  }
})

vi.mock('./resourceWriteGuard.svelte', () => ({
  getServerResourceApplyEpoch: () => resourceGuardState.epoch,
  withTrustedResourceWrite: (fn: () => unknown) => fn(),
}))

vi.mock('./resourceState.svelte', async (importActual) => {
  const actual = await importActual<typeof import('./resourceState.svelte')>()
  return {
    ...actual,
    captureCharacterRowProjectionEpoch: () => characterRowProjectionState.epoch,
    hasCharacterRowProjectionEpochChanged: (_characterId: string, epoch: number) =>
      characterRowProjectionState.epoch !== epoch,
    captureCollectionProjectionEpoch: (name: string) =>
      name === 'modules'
        ? moduleCollectionProjectionState.epoch
        : actual.captureCollectionProjectionEpoch(name as never),
    hasCollectionProjectionEpochChanged: (name: string, epoch: number) =>
      name === 'modules'
        ? moduleCollectionProjectionState.epoch !== epoch
        : actual.hasCollectionProjectionEpochChanged(name as never, epoch),
    captureSettingsGroupProjectionEpoch: (group: string) =>
      group === 'advanced'
        ? settingsGroupProjectionState.epoch
        : actual.captureSettingsGroupProjectionEpoch(group as never),
    hasSettingsGroupProjectionEpochChanged: (group: string, epoch: number) =>
      group === 'advanced'
        ? settingsGroupProjectionState.epoch !== epoch
        : actual.hasSettingsGroupProjectionEpochChanged(group as never, epoch),
  }
})

import { getDatabase, setDatabaseLite, type customscript, type Database } from '../storage/database.svelte'
import { selectedCharID } from '../stores.svelte'
import { withCloneInstrumentation } from '../__tests__/cloneCostHarness'
import {
  acknowledgeCharacterScriptDefinitionStructuralWrite,
  applyModuleScriptDefinitionDraft,
  applyCharacterScriptDefinitionDraft,
  beginCharacterScriptDefinitionStructuralWrite,
  clearDirtyScriptDefinitionFieldsMatchingProjection,
  collectScriptDefinitionCollectionSnapshots,
  currentScriptDefinitionStateSnapshot,
  dispatchReplaceCharacterScripts,
  dispatchReplaceCharacterTriggers,
  dispatchReplaceModuleScripts,
  dispatchReplaceModuleTriggers,
  ensureClientScriptDefinitionIds,
  flushPendingServerBackedScriptDefinitionPatches,
  markDirtyScriptDefinitionRowFields,
  mergeScriptDefinitionProjectionRows,
  rejectCharacterScriptDefinitionStructuralWrite,
  watchServerBackedScriptDefinitions,
} from './scriptDefinitionBridge.svelte'

const DELAY = 50

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

async function drainDefinitionCommandMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

const testDatabaseSetter = {
  set database(database: Record<string, unknown>) {
    setDatabaseLite(database as unknown as Database)
  },
}

function script(
  id: string,
  out: string,
): {
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

function trigger(
  id: string,
  comment: string,
): {
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

function scriptWithoutId(out: string): {
  comment: string
  in: string
  out: string
  type: string
} {
  return {
    comment: out,
    in: '',
    out,
    type: 'regex',
  }
}

function triggerWithoutId(comment: string): {
  comment: string
  type: 'manual'
  conditions: []
  effect: []
} {
  return {
    comment,
    type: 'manual',
    conditions: [],
    effect: [],
  }
}

function setupScriptDefinitions(): void {
  testDatabaseSetter.database = {
    globalscript: [script('global-script-1', 'initial global')],
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

describe('Phase 2 script definition dirty projection merge', () => {
  it('preserves dirty script row fields while refreshing clean fields and sibling rows', () => {
    const previousScripts = [
      { ...script('script-1', 'initial'), comment: 'initial comment', in: 'initial in' },
      { ...script('script-2', 'initial sibling'), comment: 'initial sibling comment' },
    ]
    const draftScripts = [{ ...previousScripts[0], out: 'local newer out' }, previousScripts[1]]
    const projectionScripts = [
      {
        ...previousScripts[0],
        comment: 'projected clean comment',
        in: 'projected clean in',
        out: 'older projected out',
      },
      {
        ...previousScripts[1],
        comment: 'projected sibling comment',
        out: 'projected sibling out',
      },
    ]
    const caughtUpProjectionScripts = [
      {
        ...projectionScripts[0],
        out: 'local newer out',
      },
      projectionScripts[1],
    ]
    const laterCleanProjectionScripts = [
      {
        ...caughtUpProjectionScripts[0],
        out: 'server later out',
      },
      projectionScripts[1],
    ]
    const dirtyFieldsById = new Map<string, Set<string>>()

    markDirtyScriptDefinitionRowFields(dirtyFieldsById, previousScripts, draftScripts)
    clearDirtyScriptDefinitionFieldsMatchingProjection(dirtyFieldsById, draftScripts, projectionScripts)
    const merged = mergeScriptDefinitionProjectionRows(draftScripts, projectionScripts, dirtyFieldsById)

    expect(dirtyFieldsById.get('script-1')).toEqual(new Set(['out']))
    expect(merged).toEqual([
      {
        ...projectionScripts[0],
        out: 'local newer out',
      },
      projectionScripts[1],
    ])

    clearDirtyScriptDefinitionFieldsMatchingProjection(dirtyFieldsById, merged!, caughtUpProjectionScripts)
    const laterMerged = mergeScriptDefinitionProjectionRows(merged!, laterCleanProjectionScripts, dirtyFieldsById)

    expect(dirtyFieldsById.size).toBe(0)
    expect(laterMerged?.[0].out).toBe('server later out')
  })

  it('clears exact trigger catch-up dirty fields so later clean projections can replace them', () => {
    const previousTriggers = [trigger('trigger-1', 'initial trigger'), trigger('trigger-2', 'initial sibling')]
    const draftTriggers = [{ ...previousTriggers[0], comment: 'local trigger' }, previousTriggers[1]]
    const staleProjection = [
      { ...previousTriggers[0], comment: 'older projected trigger' },
      { ...previousTriggers[1], comment: 'projected sibling trigger' },
    ]
    const caughtUpProjection = [
      { ...previousTriggers[0], comment: 'local trigger' },
      { ...previousTriggers[1], comment: 'projected sibling trigger' },
    ]
    const laterCleanProjection = [{ ...caughtUpProjection[0], comment: 'server later trigger' }, caughtUpProjection[1]]
    const dirtyFieldsById = new Map<string, Set<string>>()

    markDirtyScriptDefinitionRowFields(dirtyFieldsById, previousTriggers, draftTriggers)
    const staleMerged = mergeScriptDefinitionProjectionRows(draftTriggers, staleProjection, dirtyFieldsById)
    expect(staleMerged?.[0].comment).toBe('local trigger')
    expect(staleMerged?.[1].comment).toBe('projected sibling trigger')

    clearDirtyScriptDefinitionFieldsMatchingProjection(dirtyFieldsById, staleMerged!, caughtUpProjection)
    const laterMerged = mergeScriptDefinitionProjectionRows(staleMerged!, laterCleanProjection, dirtyFieldsById)

    expect(dirtyFieldsById.size).toBe(0)
    expect(laterMerged?.[0].comment).toBe('server later trigger')
  })

  it('merges reordered script projection rows by stable id while preserving dirty fields', () => {
    const dirtyFieldsById = new Map([['script-1', new Set(['out'])]])
    const draftScripts = [
      { ...script('script-1', 'local'), comment: 'local clean script 1' },
      { ...script('script-2', 'sibling'), comment: 'local clean sibling' },
    ]
    const reorderedProjection = [
      { ...script('script-2', 'server sibling'), comment: 'server clean sibling' },
      { ...script('script-1', 'server'), comment: 'server clean script 1' },
    ]

    expect(mergeScriptDefinitionProjectionRows(draftScripts, reorderedProjection, dirtyFieldsById)).toEqual([
      reorderedProjection[0],
      {
        ...reorderedProjection[1],
        out: 'local',
      },
    ])
  })

  it('merges reordered trigger projection rows by stable id while preserving dirty fields', () => {
    const dirtyFieldsById = new Map([['trigger-1', new Set(['comment'])]])
    const draftTriggers = [trigger('trigger-1', 'local trigger'), trigger('trigger-2', 'local sibling')]
    const reorderedProjection = [trigger('trigger-2', 'server sibling'), trigger('trigger-1', 'server trigger')]

    expect(mergeScriptDefinitionProjectionRows(draftTriggers, reorderedProjection, dirtyFieldsById)).toEqual([
      reorderedProjection[0],
      {
        ...reorderedProjection[1],
        comment: 'local trigger',
      },
    ])
  })

  it('falls back to full reseed semantics when script row ids are missing or duplicated', () => {
    const dirtyFieldsById = new Map([['script-1', new Set(['out'])]])
    const draftScripts = [script('script-1', 'local'), script('script-2', 'sibling')]

    expect(
      mergeScriptDefinitionProjectionRows(
        draftScripts,
        [{ ...script('script-1', 'server'), id: '' }, script('script-2', 'server sibling')],
        dirtyFieldsById,
      ),
    ).toBeNull()

    expect(
      mergeScriptDefinitionProjectionRows(
        draftScripts,
        [script('script-1', 'server'), script('script-1', 'server duplicate')],
        dirtyFieldsById,
      ),
    ).toBeNull()
  })

  it('falls back to full reseed semantics when trigger row ids are missing or duplicated', () => {
    const dirtyFieldsById = new Map([['trigger-1', new Set(['comment'])]])
    const draftTriggers = [trigger('trigger-1', 'local'), trigger('trigger-2', 'sibling')]

    expect(
      mergeScriptDefinitionProjectionRows(
        [{ ...trigger('trigger-1', 'local'), id: '' }, trigger('trigger-2', 'sibling')],
        [trigger('trigger-1', 'server'), trigger('trigger-2', 'server sibling')],
        dirtyFieldsById,
      ),
    ).toBeNull()

    expect(
      mergeScriptDefinitionProjectionRows(
        draftTriggers,
        [trigger('trigger-1', 'server'), trigger('trigger-1', 'server duplicate')],
        dirtyFieldsById,
      ),
    ).toBeNull()
  })

  it('falls back to full reseed semantics when row id sets are added, deleted, or mismatched', () => {
    const dirtyFieldsById = new Map([['script-1', new Set(['out'])]])
    const draftScripts = [script('script-1', 'local'), script('script-2', 'sibling')]

    expect(
      mergeScriptDefinitionProjectionRows(
        draftScripts,
        [script('script-2', 'server sibling'), script('script-1', 'server'), script('script-3', 'server added')],
        dirtyFieldsById,
      ),
    ).toBeNull()

    expect(
      mergeScriptDefinitionProjectionRows(draftScripts, [script('script-1', 'server')], dirtyFieldsById),
    ).toBeNull()

    expect(
      mergeScriptDefinitionProjectionRows(
        draftScripts,
        [script('script-1', 'server'), script('script-3', 'server replacement')],
        dirtyFieldsById,
      ),
    ).toBeNull()
  })
})

beforeEach(() => {
  vi.useFakeTimers()
  resourceGuardState.epoch = 0
  characterRowProjectionState.epoch = 0
  moduleCollectionProjectionState.epoch = 0
  settingsGroupProjectionState.epoch = 0
  recorded.commands.length = 0
  recorded.characterDefinitionCalls.length = 0
  recorded.moduleDefinitionCalls.length = 0
  recorded.compactDefinitionCalls.length = 0
  recorded.fullDefinitionCalls.length = 0
  recorded.commandResults.length = 0
})

afterEach(async () => {
  await drainDefinitionCommandMicrotasks()
  vi.useRealTimers()
  testDatabaseSetter.database = {}
})

describe('P1 script definition watcher purity', () => {
  it('preserves the first stable script id and repairs missing or duplicate ids', () => {
    const rows: customscript[] = [
      script('shared-id', 'first'),
      script('shared-id', 'duplicate'),
      scriptWithoutId('missing'),
    ]

    ensureClientScriptDefinitionIds(rows)

    expect(rows[0].id).toBe('shared-id')
    expect(rows[1].id).toEqual(expect.any(String))
    expect(rows[2].id).toEqual(expect.any(String))
    expect(new Set(rows.map((row) => row.id)).size).toBe(3)
  })

  it('state snapshots clone malformed script data as-is without assigning ids or stub arrays', () => {
    testDatabaseSetter.database = {
      characters: [
        {
          chaId: 'snapshot-char',
          customscript: [scriptWithoutId('missing script id')],
        },
      ],
      modules: [
        {
          id: 'snapshot-module',
          regex: [scriptWithoutId('missing module script id')],
        },
      ],
    }

    const snapshot = currentScriptDefinitionStateSnapshot()

    expect(getDatabase().characters[0].customscript[0].id).toBeUndefined()
    expect(getDatabase().characters[0]).not.toHaveProperty('triggerscript')
    expect(getDatabase().modules[0].regex[0].id).toBeUndefined()
    expect(getDatabase().modules[0]).not.toHaveProperty('trigger')

    expect(snapshot.characters[0].customscript?.[0].id).toBeUndefined()
    expect(snapshot.characters[0]).not.toHaveProperty('triggerscript')
    expect(snapshot.modules[0].regex?.[0].id).toBeUndefined()
    expect(snapshot.modules[0]).not.toHaveProperty('trigger')
  })

  it('watcher first run does not assign script or trigger ids', () => {
    testDatabaseSetter.database = {
      characters: [
        {
          chaId: 'char-missing-ids',
          customscript: [scriptWithoutId('missing script id')],
          triggerscript: [triggerWithoutId('missing trigger id')],
        },
      ],
      modules: [
        {
          id: 'module-missing-ids',
          regex: [scriptWithoutId('missing module script id')],
          trigger: [triggerWithoutId('missing module trigger id')],
        },
      ],
    }

    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    expect(getDatabase().characters[0].customscript[0].id).toBeUndefined()
    expect(getDatabase().characters[0].triggerscript[0].id).toBeUndefined()
    expect(getDatabase().modules[0].regex[0].id).toBeUndefined()
    expect(getDatabase().modules[0].trigger[0].id).toBeUndefined()
    expect(recorded.commands).toEqual([])
    stop()
  })

  it('watcher skips malformed and duplicate ids without dispatch or mutation', async () => {
    testDatabaseSetter.database = {
      characters: [
        {
          chaId: 'char-malformed',
          customscript: [scriptWithoutId('missing script id')],
          triggerscript: [trigger('duplicate-trigger', 'first'), trigger('duplicate-trigger', 'second')],
        },
      ],
      modules: [],
    }

    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    getDatabase().characters[0].customscript[0].out = 'changed without id'
    getDatabase().characters[0].triggerscript[1].comment = 'changed duplicate id'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.commands).toEqual([])
    expect(getDatabase().characters[0].customscript[0].id).toBeUndefined()
    expect(getDatabase().characters[0].triggerscript.map((entry) => entry.id)).toEqual([
      'duplicate-trigger',
      'duplicate-trigger',
    ])
    stop()
  })

  it('watcher revalidates ids at debounce flush before sending replacements', async () => {
    setupScriptDefinitions()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    getDatabase().characters[0].customscript = [script('script-1', 'queued while stable')]
    flushSync()

    getDatabase().characters[0].customscript = [scriptWithoutId('malformed before flush') as never]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()

    expect(recorded.commands).toEqual([])
    expect(getDatabase().characters[0].customscript[0].id).toBeUndefined()
    stop()
  })
})

describe('character script definition draft bridge', () => {
  it('routes CharConfig script draft writes through the bridge helper', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/lib/SideBars/CharConfig.svelte'), 'utf8')

    expect(source).not.toContain('withTrustedResourceWrite')
    expect(source).toContain('applyCharacterScriptDefinitionDraft(')
    expect(source).toContain('getServerResourceApplyEpoch')
    expect(source).toContain('markDirtyScriptDefinitionRowFields')
    expect(source).toContain('clearDirtyScriptDefinitionFieldsMatchingProjection')
    expect(source).toContain('mergeScriptDefinitionProjectionRows')
    expect(source).toContain('clearScriptDraftDirtyState()')
  })

  it('clears matching script dirty fields before the snapshot mismatch branch', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/lib/SideBars/CharConfig.svelte'), 'utf8')
    const projectionChangedIndex = source.indexOf('const resourceApplyChanged')
    const mismatchBranchIndex = source.indexOf(
      'if (targetChanged || snapshot !== scriptDraftSnapshot)',
      projectionChangedIndex,
    )
    const clearIndex = source.indexOf('clearDirtyScriptDefinitionFieldsMatchingProjection', projectionChangedIndex)
    const preMismatchSource = source.slice(projectionChangedIndex, mismatchBranchIndex)

    expect(projectionChangedIndex).toBeGreaterThanOrEqual(0)
    expect(mismatchBranchIndex).toBeGreaterThan(projectionChangedIndex)
    expect(clearIndex).toBeGreaterThan(projectionChangedIndex)
    expect(clearIndex).toBeLessThan(mismatchBranchIndex)
    expect(preMismatchSource).toContain('resourceApplyChanged')
    expect(preMismatchSource).toContain('!targetChanged')
  })

  it('applies cloned drafts, dispatches replacements, and preserves newer definitions on stale rollback', async () => {
    setupScriptDefinitions()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    const draftScripts = [script('script-1', 'draft script')]
    const draftTriggers = [trigger('trigger-1', 'draft trigger')]

    expect(applyCharacterScriptDefinitionDraft('char-1', draftScripts, draftTriggers, DELAY)).toBe(true)
    expect(getDatabase().characters[0].customscript).toEqual([script('script-1', 'draft script')])
    expect(getDatabase().characters[0].triggerscript).toEqual([trigger('trigger-1', 'draft trigger')])
    expect(getDatabase().characters[0].customscript).not.toBe(draftScripts)
    expect(getDatabase().characters[0].customscript[0]).not.toBe(draftScripts[0])
    expect(getDatabase().characters[0].triggerscript).not.toBe(draftTriggers)
    expect(getDatabase().characters[0].triggerscript[0]).not.toBe(draftTriggers[0])

    draftScripts[0].out = 'mutated draft script'
    draftTriggers[0].comment = 'mutated draft trigger'
    expect(getDatabase().characters[0].customscript).toEqual([script('script-1', 'draft script')])
    expect(getDatabase().characters[0].triggerscript).toEqual([trigger('trigger-1', 'draft trigger')])

    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()

    expect(recorded.commands.map((entry) => entry.built)).toEqual([
      {
        kind: 'replaceCharacterScripts',
        baseRevision: 1,
        characterId: 'char-1',
        scripts: [script('script-1', 'draft script')],
      },
      {
        kind: 'replaceCharacterTriggers',
        baseRevision: 1,
        characterId: 'char-1',
        triggers: [trigger('trigger-1', 'draft trigger')],
      },
    ])
    expect(recorded.characterDefinitionCalls).toEqual([
      {
        kind: 'scripts',
        optimisticRowEpoch: expect.any(Number),
        acknowledgeOptimistic: true,
      },
      {
        kind: 'triggers',
        optimisticRowEpoch: expect.any(Number),
        acknowledgeOptimistic: true,
      },
    ])

    getDatabase().characters[0].customscript = [script('script-1', 'newer script')]
    getDatabase().characters[0].triggerscript = [trigger('trigger-1', 'newer trigger')]
    for (const command of recorded.commands) {
      command.rollback?.()
    }

    expect(getDatabase().characters[0].customscript).toEqual([script('script-1', 'newer script')])
    expect(getDatabase().characters[0].triggerscript).toEqual([trigger('trigger-1', 'newer trigger')])
    stop()
  })

  it('assigns ids on explicit character draft writes without mutating the draft arrays', async () => {
    setupScriptDefinitions()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    const draftScripts = [scriptWithoutId('new script')]
    const draftTriggers = [triggerWithoutId('new trigger')]

    expect(applyCharacterScriptDefinitionDraft('char-1', draftScripts, draftTriggers, DELAY)).toBe(true)
    expect((draftScripts[0] as { id?: string }).id).toBeUndefined()
    expect((draftTriggers[0] as { id?: string }).id).toBeUndefined()
    expect(getDatabase().characters[0].customscript[0]).toMatchObject({
      id: expect.any(String),
      out: 'new script',
    })
    expect(getDatabase().characters[0].triggerscript[0]).toMatchObject({
      id: expect.any(String),
      comment: 'new trigger',
    })

    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()

    const [scriptCommand, triggerCommand] = recorded.commands.map((entry) => entry.built)
    expect(scriptCommand).toMatchObject({
      kind: 'replaceCharacterScripts',
      characterId: 'char-1',
      scripts: [{ id: expect.any(String), out: 'new script' }],
    })
    expect(triggerCommand).toMatchObject({
      kind: 'replaceCharacterTriggers',
      characterId: 'char-1',
      triggers: [{ id: expect.any(String), comment: 'new trigger' }],
    })
    stop()
  })

  it('persists explicit character drafts when the watcher skipped an initially absent collection', async () => {
    testDatabaseSetter.database = {
      characters: [{ chaId: 'char-1' }],
      modules: [],
    }
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    const draftScripts = [scriptWithoutId('created script')]
    const draftTriggers = [triggerWithoutId('created trigger')]

    expect(applyCharacterScriptDefinitionDraft('char-1', draftScripts, draftTriggers, DELAY)).toBe(true)
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()

    const [scriptCommand, triggerCommand] = recorded.commands
    expect(scriptCommand.built).toMatchObject({
      kind: 'replaceCharacterScripts',
      characterId: 'char-1',
      scripts: [{ id: expect.any(String), out: 'created script' }],
    })
    expect(triggerCommand.built).toMatchObject({
      kind: 'replaceCharacterTriggers',
      characterId: 'char-1',
      triggers: [{ id: expect.any(String), comment: 'created trigger' }],
    })

    scriptCommand.rollback?.()
    triggerCommand.rollback?.()
    expect(getDatabase().characters[0]).not.toHaveProperty('customscript')
    expect(getDatabase().characters[0]).not.toHaveProperty('triggerscript')
    stop()
  })

  it('keeps newly created character fields when absent-field rollback is stale', async () => {
    testDatabaseSetter.database = {
      characters: [{ chaId: 'char-1' }],
      modules: [],
    }
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    expect(
      applyCharacterScriptDefinitionDraft(
        'char-1',
        [scriptWithoutId('created script')],
        [triggerWithoutId('created trigger')],
        DELAY,
      ),
    ).toBe(true)
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()
    expect(recorded.commands).toHaveLength(2)

    getDatabase().characters[0].customscript = [script('script-newer', 'newer script')]
    getDatabase().characters[0].triggerscript = [trigger('trigger-newer', 'newer trigger')]

    recorded.commands[0].rollback?.()
    recorded.commands[1].rollback?.()

    expect(getDatabase().characters[0].customscript).toEqual([script('script-newer', 'newer script')])
    expect(getDatabase().characters[0].triggerscript).toEqual([trigger('trigger-newer', 'newer trigger')])
    stop()
  })

  it('does not create an absent trigger field for script-only character draft edits', async () => {
    testDatabaseSetter.database = {
      characters: [
        {
          chaId: 'char-1',
          customscript: [script('script-1', 'initial')],
        },
      ],
      modules: [],
    }
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    expect(applyCharacterScriptDefinitionDraft('char-1', [script('script-1', 'script-only edit')], [], DELAY)).toBe(
      true,
    )
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()

    expect(recorded.commands.map((entry) => entry.built)).toEqual([
      {
        kind: 'replaceCharacterScripts',
        baseRevision: 1,
        characterId: 'char-1',
        scripts: [script('script-1', 'script-only edit')],
      },
    ])
    expect(getDatabase().characters[0]).not.toHaveProperty('triggerscript')

    recorded.commands[0].rollback?.()
    expect(getDatabase().characters[0].customscript).toEqual([script('script-1', 'initial')])
    expect(getDatabase().characters[0]).not.toHaveProperty('triggerscript')
    stop()
  })

  it('returns false without mutating or dispatching when the character id is missing', async () => {
    setupScriptDefinitions()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()
    const before = JSON.stringify(getDatabase().characters)

    expect(applyCharacterScriptDefinitionDraft(null, [script('script-1', 'draft')], [])).toBe(false)
    expect(applyCharacterScriptDefinitionDraft('missing-character', [script('script-1', 'draft')], [])).toBe(false)

    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(JSON.stringify(getDatabase().characters)).toBe(before)
    expect(recorded.commands).toEqual([])
    stop()
  })

  it('keeps delayed command payloads isolated from later draft and live array mutations', async () => {
    setupScriptDefinitions()

    const draftScripts = [script('script-1', 'queued script')]
    const draftTriggers = [trigger('trigger-1', 'queued trigger')]
    expect(applyCharacterScriptDefinitionDraft('char-1', draftScripts, draftTriggers, DELAY)).toBe(true)

    const liveScripts = getDatabase().characters[0].customscript
    const liveTriggers = getDatabase().characters[0].triggerscript
    dispatchReplaceCharacterScripts(
      'char-1',
      liveScripts,
      {
        kind: 'characterScripts',
        characterId: 'char-1',
        scripts: [script('script-1', 'initial')],
      },
      DELAY,
    )
    dispatchReplaceCharacterTriggers(
      'char-1',
      liveTriggers,
      {
        kind: 'characterTriggers',
        characterId: 'char-1',
        triggers: [trigger('trigger-1', 'initial trigger')],
      },
      DELAY,
    )

    draftScripts[0].out = 'mutated draft script'
    draftTriggers[0].comment = 'mutated draft trigger'
    liveScripts[0].out = 'mutated live script'
    liveTriggers[0].comment = 'mutated live trigger'

    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()

    expect(recorded.commands.map((entry) => entry.built)).toEqual([
      {
        kind: 'replaceCharacterScripts',
        baseRevision: 1,
        characterId: 'char-1',
        scripts: [script('script-1', 'queued script')],
      },
      {
        kind: 'replaceCharacterTriggers',
        baseRevision: 1,
        characterId: 'char-1',
        triggers: [trigger('trigger-1', 'queued trigger')],
      },
    ])
  })

  it('drops a queued definition write after an authoritative character row projection', async () => {
    setupScriptDefinitions()
    const previous = {
      kind: 'characterScripts' as const,
      characterId: 'char-1',
      scripts: [script('script-1', 'initial')],
    }
    getDatabase().characters[0].customscript = [script('script-1', 'attempted')]
    dispatchReplaceCharacterScripts('char-1', getDatabase().characters[0].customscript, previous, DELAY)

    characterRowProjectionState.epoch += 1
    getDatabase().characters[0].customscript = [script('script-1', 'authoritative')]
    await vi.advanceTimersByTimeAsync(DELAY)
    await drainDefinitionCommandMicrotasks()

    expect(recorded.commands).toEqual([])
    expect(getDatabase().characters[0].customscript).toEqual([script('script-1', 'authoritative')])
  })

  it('starts a new coalesced rollback baseline after an authoritative row epoch', async () => {
    setupScriptDefinitions()
    getDatabase().characters[0].customscript = [script('script-1', 'first attempt')]
    dispatchReplaceCharacterScripts(
      'char-1',
      getDatabase().characters[0].customscript,
      {
        kind: 'characterScripts',
        characterId: 'char-1',
        scripts: [script('script-1', 'initial')],
      },
      DELAY,
    )

    characterRowProjectionState.epoch += 1
    getDatabase().characters[0].customscript = [script('script-1', 'authoritative')]
    const authoritativeBaseline = [script('script-1', 'authoritative')]
    getDatabase().characters[0].customscript = [script('script-1', 'second attempt')]
    dispatchReplaceCharacterScripts(
      'char-1',
      getDatabase().characters[0].customscript,
      {
        kind: 'characterScripts',
        characterId: 'char-1',
        scripts: authoritativeBaseline,
      },
      DELAY,
    )

    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()
    recorded.commands[0].rollback?.()

    expect(getDatabase().characters[0].customscript).toEqual(authoritativeBaseline)
  })
})

describe('module script definition projection fencing', () => {
  it('drops a queued replacement after an authoritative module collection projection', async () => {
    setupScriptDefinitions()
    moduleCollectionProjectionState.epoch = 3
    getDatabase().modules[0].regex = [script('module-script-1', 'attempted')]
    dispatchReplaceModuleScripts(
      'module-1',
      getDatabase().modules[0].regex,
      {
        kind: 'moduleScripts',
        moduleId: 'module-1',
        scripts: [script('module-script-1', 'initial module')],
      },
      DELAY,
    )

    moduleCollectionProjectionState.epoch = 4
    getDatabase().modules[0].regex = [script('module-script-1', 'authoritative')]
    await vi.advanceTimersByTimeAsync(DELAY)
    await drainDefinitionCommandMicrotasks()

    expect(recorded.moduleDefinitionCalls).toEqual([])
    expect(recorded.commands).toEqual([])

    expect(getDatabase().modules[0].regex).toEqual([script('module-script-1', 'authoritative')])
  })

  it('starts a new coalesced rollback baseline after an authoritative module projection', async () => {
    setupScriptDefinitions()
    getDatabase().modules[0].trigger = [trigger('module-trigger-1', 'first attempt')]
    dispatchReplaceModuleTriggers(
      'module-1',
      getDatabase().modules[0].trigger,
      {
        kind: 'moduleTriggers',
        moduleId: 'module-1',
        triggers: [trigger('module-trigger-1', 'initial module trigger')],
      },
      DELAY,
    )

    moduleCollectionProjectionState.epoch += 1
    const authoritativeBaseline = [trigger('module-trigger-1', 'authoritative')]
    getDatabase().modules[0].trigger = authoritativeBaseline
    getDatabase().modules[0].trigger = [trigger('module-trigger-1', 'second attempt')]
    dispatchReplaceModuleTriggers(
      'module-1',
      getDatabase().modules[0].trigger,
      {
        kind: 'moduleTriggers',
        moduleId: 'module-1',
        triggers: authoritativeBaseline,
      },
      DELAY,
    )

    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()

    expect(recorded.commands).toHaveLength(1)
    expect(recorded.moduleDefinitionCalls).toEqual([
      {
        kind: 'triggers',
        optimisticCollectionEpoch: 1,
        acknowledgeOptimistic: true,
      },
    ])
    recorded.commands[0].rollback?.()

    expect(getDatabase().modules[0].trigger).toEqual(authoritativeBaseline)
  })
})

describe('compact script definition mutations', () => {
  it('sends a compact field mutation for watched global scripts', async () => {
    setupScriptDefinitions()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY, scope: { kind: 'globalScripts' } })
    flushSync()

    getDatabase().globalscript = [script('global-script-1', 'edited global')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await drainDefinitionCommandMicrotasks()

    expect(recorded.compactDefinitionCalls).toEqual([
      {
        scope: 'global',
        kind: 'scripts',
        targetId: 'globalscript',
        mutation: {
          op: 'update',
          id: 'global-script-1',
          patch: { out: 'edited global' },
          deleteKeys: [],
        },
        expectedDefinitions: [script('global-script-1', 'edited global')],
        keepalive: undefined,
      },
    ])
    expect(recorded.fullDefinitionCalls).toEqual([])
    stop()
  })

  it('uses one full replacement to establish ids for legacy global scripts', async () => {
    testDatabaseSetter.database = {
      globalscript: [scriptWithoutId('legacy')],
      characters: [],
      modules: [],
    }
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY, scope: { kind: 'globalScripts' } })
    flushSync()

    getDatabase().globalscript = [script('normalized-global', 'edited legacy')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await drainDefinitionCommandMicrotasks()

    expect(recorded.compactDefinitionCalls).toEqual([])
    expect(recorded.fullDefinitionCalls).toEqual([{ scope: 'global', kind: 'scripts', targetId: 'globalscript' }])
    expect(recorded.commands[0].built).toMatchObject({
      kind: 'replaceGlobalScripts',
      group: 'advanced',
      patch: { globalscript: [script('normalized-global', 'edited legacy')] },
    })
    stop()
  })

  it('forces a full global-script replacement after an earlier compact write fails', async () => {
    setupScriptDefinitions()
    const firstResult = createDeferred<{ status: 'error'; error: string }>()
    recorded.commandResults.push(firstResult.promise)
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY, scope: { kind: 'globalScripts' } })
    flushSync()

    getDatabase().globalscript = [script('global-script-1', 'first edit')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    getDatabase().globalscript = [
      {
        ...script('global-script-1', 'first edit'),
        comment: 'later edit',
      },
    ]
    flushSync()
    firstResult.resolve({ status: 'error', error: 'failed' })
    await drainDefinitionCommandMicrotasks()
    await vi.advanceTimersByTimeAsync(DELAY)
    await drainDefinitionCommandMicrotasks()

    expect(recorded.compactDefinitionCalls).toHaveLength(1)
    expect(recorded.fullDefinitionCalls).toEqual([{ scope: 'global', kind: 'scripts', targetId: 'globalscript' }])
    expect(recorded.commands.at(-1)?.built).toMatchObject({
      kind: 'replaceGlobalScripts',
      patch: {
        globalscript: [
          {
            ...script('global-script-1', 'first edit'),
            comment: 'later edit',
          },
        ],
      },
    })
    stop()
  })

  it('classifies one sparse mutation for each definition scope', async () => {
    setupScriptDefinitions()
    getDatabase().modules[0].trigger = [
      trigger('module-trigger-1', 'initial module trigger'),
      trigger('module-trigger-2', 'second module trigger'),
    ]

    const previousCharacterScripts = [script('script-1', 'initial')]
    getDatabase().characters[0].customscript = [script('script-1', 'edited')]
    dispatchReplaceCharacterScripts(
      'char-1',
      getDatabase().characters[0].customscript,
      { kind: 'characterScripts', characterId: 'char-1', scripts: previousCharacterScripts },
      0,
    )

    const previousCharacterTriggers = [trigger('trigger-1', 'initial trigger')]
    getDatabase().characters[0].triggerscript = []
    dispatchReplaceCharacterTriggers(
      'char-1',
      getDatabase().characters[0].triggerscript,
      { kind: 'characterTriggers', characterId: 'char-1', triggers: previousCharacterTriggers },
      0,
    )

    const previousModuleScripts = [script('module-script-1', 'initial module')]
    getDatabase().modules[0].regex = [...previousModuleScripts, script('module-script-2', 'created module script')]
    dispatchReplaceModuleScripts(
      'module-1',
      getDatabase().modules[0].regex,
      { kind: 'moduleScripts', moduleId: 'module-1', scripts: previousModuleScripts },
      0,
    )

    const previousModuleTriggers = [
      trigger('module-trigger-1', 'initial module trigger'),
      trigger('module-trigger-2', 'second module trigger'),
    ]
    getDatabase().modules[0].trigger = [previousModuleTriggers[1], previousModuleTriggers[0]]
    dispatchReplaceModuleTriggers(
      'module-1',
      getDatabase().modules[0].trigger,
      { kind: 'moduleTriggers', moduleId: 'module-1', triggers: previousModuleTriggers },
      0,
    )

    await vi.advanceTimersByTimeAsync(0)
    await drainDefinitionCommandMicrotasks()

    expect(
      recorded.compactDefinitionCalls.map(({ scope, kind, targetId, mutation }) => ({
        scope,
        kind,
        targetId,
        mutation,
      })),
    ).toEqual([
      {
        scope: 'character',
        kind: 'scripts',
        targetId: 'char-1',
        mutation: { op: 'update', id: 'script-1', patch: { out: 'edited' }, deleteKeys: [] },
      },
      {
        scope: 'character',
        kind: 'triggers',
        targetId: 'char-1',
        mutation: { op: 'delete', id: 'trigger-1' },
      },
      {
        scope: 'module',
        kind: 'scripts',
        targetId: 'module-1',
        mutation: {
          op: 'create',
          row: script('module-script-2', 'created module script'),
          index: 1,
        },
      },
      {
        scope: 'module',
        kind: 'triggers',
        targetId: 'module-1',
        mutation: { op: 'reorder', ids: ['module-trigger-2', 'module-trigger-1'] },
      },
    ])
    expect(recorded.fullDefinitionCalls).toEqual([])
  })

  it('coalesces create then edit into one final create mutation', async () => {
    setupScriptDefinitions()
    const baseline = [script('script-1', 'initial')]
    const firstFinal = [...baseline, script('script-2', 'created')]
    getDatabase().characters[0].customscript = firstFinal
    dispatchReplaceCharacterScripts(
      'char-1',
      firstFinal,
      { kind: 'characterScripts', characterId: 'char-1', scripts: baseline },
      DELAY,
    )

    const editedFinal = [...baseline, script('script-2', 'edited before dispatch')]
    getDatabase().characters[0].customscript = editedFinal
    dispatchReplaceCharacterScripts(
      'char-1',
      editedFinal,
      { kind: 'characterScripts', characterId: 'char-1', scripts: firstFinal },
      DELAY,
    )

    await vi.advanceTimersByTimeAsync(DELAY)
    await drainDefinitionCommandMicrotasks()

    expect(recorded.compactDefinitionCalls).toHaveLength(1)
    expect(recorded.compactDefinitionCalls[0]).toMatchObject({
      mutation: {
        op: 'create',
        row: script('script-2', 'edited before dispatch'),
        index: 1,
      },
      expectedDefinitions: editedFinal,
    })
    expect(recorded.fullDefinitionCalls).toEqual([])
  })

  it('suppresses a debounced net revert but keeps ambiguous edits on full PUT', async () => {
    setupScriptDefinitions()
    const baseline = [script('script-1', 'initial')]
    const edited = [script('script-1', 'temporary')]
    getDatabase().characters[0].customscript = edited
    dispatchReplaceCharacterScripts(
      'char-1',
      edited,
      { kind: 'characterScripts', characterId: 'char-1', scripts: baseline },
      DELAY,
    )
    getDatabase().characters[0].customscript = baseline
    dispatchReplaceCharacterScripts(
      'char-1',
      baseline,
      { kind: 'characterScripts', characterId: 'char-1', scripts: edited },
      DELAY,
    )
    await vi.advanceTimersByTimeAsync(DELAY)
    await drainDefinitionCommandMicrotasks()
    expect(recorded.commands).toEqual([])

    const twoRowBaseline = [script('script-1', 'initial'), script('script-2', 'second')]
    const compoundFinal = [script('script-1', 'changed one'), script('script-2', 'changed two')]
    getDatabase().characters[0].customscript = compoundFinal
    dispatchReplaceCharacterScripts(
      'char-1',
      compoundFinal,
      { kind: 'characterScripts', characterId: 'char-1', scripts: twoRowBaseline },
      0,
    )
    await vi.advanceTimersByTimeAsync(0)
    await drainDefinitionCommandMicrotasks()

    expect(recorded.compactDefinitionCalls).toEqual([])
    expect(recorded.fullDefinitionCalls).toEqual([{ scope: 'character', kind: 'scripts', targetId: 'char-1' }])
  })

  it('forces an unsettled successor to PUT and rebases its rollback after both requests fail', async () => {
    setupScriptDefinitions()
    const firstResult = createDeferred<{ status: 'error'; error: string }>()
    const secondResult = createDeferred<{ status: 'error'; error: string }>()
    recorded.commandResults.push(firstResult.promise, secondResult.promise)

    const baseline = [script('script-1', 'initial')]
    const firstFinal = [script('script-1', 'first')]
    getDatabase().characters[0].customscript = firstFinal
    dispatchReplaceCharacterScripts(
      'char-1',
      firstFinal,
      { kind: 'characterScripts', characterId: 'char-1', scripts: baseline },
      0,
    )
    await vi.advanceTimersByTimeAsync(0)
    await drainDefinitionCommandMicrotasks()

    const secondFinal = [script('script-1', 'second')]
    getDatabase().characters[0].customscript = secondFinal
    dispatchReplaceCharacterScripts(
      'char-1',
      secondFinal,
      { kind: 'characterScripts', characterId: 'char-1', scripts: firstFinal },
      0,
    )
    await vi.advanceTimersByTimeAsync(0)
    await drainDefinitionCommandMicrotasks()

    expect(recorded.compactDefinitionCalls).toHaveLength(1)
    expect(recorded.fullDefinitionCalls).toHaveLength(1)

    firstResult.resolve({ status: 'error', error: 'lost first response' })
    await drainDefinitionCommandMicrotasks()
    secondResult.resolve({ status: 'error', error: 'lost second response' })
    await drainDefinitionCommandMicrotasks()

    expect(getDatabase().characters[0].customscript).toEqual(baseline)

    const recovery = [script('script-1', 'recovered')]
    getDatabase().characters[0].customscript = recovery
    dispatchReplaceCharacterScripts(
      'char-1',
      recovery,
      { kind: 'characterScripts', characterId: 'char-1', scripts: baseline },
      0,
    )
    await vi.advanceTimersByTimeAsync(0)
    await drainDefinitionCommandMicrotasks()
    expect(recorded.fullDefinitionCalls).toHaveLength(2)

    const afterRecovery = [script('script-1', 'sparse again')]
    getDatabase().characters[0].customscript = afterRecovery
    dispatchReplaceCharacterScripts(
      'char-1',
      afterRecovery,
      { kind: 'characterScripts', characterId: 'char-1', scripts: recovery },
      0,
    )
    await vi.advanceTimersByTimeAsync(0)
    await drainDefinitionCommandMicrotasks()
    expect(recorded.compactDefinitionCalls).toHaveLength(2)
  })

  it.each([
    { accepted: true, expectedRollback: 'old accepted' },
    { accepted: false, expectedRollback: 'authoritative' },
  ])(
    'rebases a newer-epoch full rollback when the old request accepted=$accepted',
    async ({ accepted, expectedRollback }) => {
      testDatabaseSetter.database = {
        characters: [{ chaId: 'char-cross', customscript: [script('script-1', 'initial')] }],
        modules: [],
      }
      const oldResult = createDeferred<{ status: 'ok'; revision: number } | { status: 'error'; error: string }>()
      const newResult = createDeferred<{ status: 'error'; error: string }>()
      recorded.commandResults.push(oldResult.promise, newResult.promise)

      const initial = [script('script-1', 'initial')]
      const oldAccepted = [script('script-1', 'old accepted')]
      getDatabase().characters[0].customscript = oldAccepted
      dispatchReplaceCharacterScripts(
        'char-cross',
        oldAccepted,
        { kind: 'characterScripts', characterId: 'char-cross', scripts: initial },
        0,
      )
      await vi.advanceTimersByTimeAsync(0)
      await drainDefinitionCommandMicrotasks()

      characterRowProjectionState.epoch += 1
      const authoritative = [script('script-1', 'authoritative')]
      const newerFinal = [script('script-1', 'newer final')]
      getDatabase().characters[0].customscript = newerFinal
      dispatchReplaceCharacterScripts(
        'char-cross',
        newerFinal,
        { kind: 'characterScripts', characterId: 'char-cross', scripts: authoritative },
        0,
      )
      await vi.advanceTimersByTimeAsync(0)
      await drainDefinitionCommandMicrotasks()
      expect(recorded.fullDefinitionCalls).toHaveLength(1)

      oldResult.resolve(accepted ? { status: 'ok', revision: 2 } : { status: 'error', error: 'old rejected' })
      await drainDefinitionCommandMicrotasks()
      newResult.resolve({ status: 'error', error: 'new full rejected' })
      await drainDefinitionCommandMicrotasks()

      expect(getDatabase().characters[0].customscript).toEqual([script('script-1', expectedRollback)])
    },
  )

  it('rebases a live newer-epoch pending rollback after an old request is accepted', async () => {
    testDatabaseSetter.database = {
      characters: [{ chaId: 'char-pending-cross', customscript: [script('script-1', 'initial')] }],
      modules: [],
    }
    const oldResult = createDeferred<{ status: 'ok'; revision: number }>()
    recorded.commandResults.push(oldResult.promise, { status: 'error', error: 'new full rejected' })

    const initial = [script('script-1', 'initial')]
    const oldAccepted = [script('script-1', 'old accepted')]
    getDatabase().characters[0].customscript = oldAccepted
    dispatchReplaceCharacterScripts(
      'char-pending-cross',
      oldAccepted,
      { kind: 'characterScripts', characterId: 'char-pending-cross', scripts: initial },
      0,
    )
    await vi.advanceTimersByTimeAsync(0)
    await drainDefinitionCommandMicrotasks()

    characterRowProjectionState.epoch += 1
    const authoritative = [script('script-1', 'authoritative')]
    const newerFinal = [script('script-1', 'newer final')]
    getDatabase().characters[0].customscript = newerFinal
    dispatchReplaceCharacterScripts(
      'char-pending-cross',
      newerFinal,
      { kind: 'characterScripts', characterId: 'char-pending-cross', scripts: authoritative },
      DELAY,
    )

    oldResult.resolve({ status: 'ok', revision: 2 })
    await drainDefinitionCommandMicrotasks()
    await vi.advanceTimersByTimeAsync(DELAY)
    await drainDefinitionCommandMicrotasks()

    expect(recorded.fullDefinitionCalls).toHaveLength(1)
    expect(getDatabase().characters[0].customscript).toEqual(oldAccepted)
  })

  it('carries a late old-request taint through an already stale mapped epoch', async () => {
    testDatabaseSetter.database = {
      characters: [{ chaId: 'char-multi-cross', customscript: [script('script-1', 'initial')] }],
      modules: [],
    }
    const oldResult = createDeferred<{ status: 'error'; error: string }>()
    const middleResult = createDeferred<{ status: 'error'; error: string }>()
    recorded.commandResults.push(oldResult.promise, middleResult.promise)

    const initial = [script('script-1', 'initial')]
    const oldFinal = [script('script-1', 'old final')]
    getDatabase().characters[0].customscript = oldFinal
    dispatchReplaceCharacterScripts(
      'char-multi-cross',
      oldFinal,
      { kind: 'characterScripts', characterId: 'char-multi-cross', scripts: initial },
      0,
    )
    await vi.advanceTimersByTimeAsync(0)
    await drainDefinitionCommandMicrotasks()

    characterRowProjectionState.epoch += 1
    const middleBaseline = [script('script-1', 'epoch one')]
    const middleFinal = [script('script-1', 'middle final')]
    getDatabase().characters[0].customscript = middleFinal
    dispatchReplaceCharacterScripts(
      'char-multi-cross',
      middleFinal,
      { kind: 'characterScripts', characterId: 'char-multi-cross', scripts: middleBaseline },
      0,
    )
    await vi.advanceTimersByTimeAsync(0)
    await drainDefinitionCommandMicrotasks()

    middleResult.resolve({ status: 'error', error: 'middle rejected early' })
    await drainDefinitionCommandMicrotasks()
    characterRowProjectionState.epoch += 1
    oldResult.resolve({ status: 'error', error: 'old rejected late' })
    await drainDefinitionCommandMicrotasks()

    const epochTwoBaseline = [script('script-1', 'epoch two')]
    const epochTwoFinal = [script('script-1', 'epoch two final')]
    getDatabase().characters[0].customscript = epochTwoFinal
    dispatchReplaceCharacterScripts(
      'char-multi-cross',
      epochTwoFinal,
      { kind: 'characterScripts', characterId: 'char-multi-cross', scripts: epochTwoBaseline },
      0,
    )
    await vi.advanceTimersByTimeAsync(0)
    await drainDefinitionCommandMicrotasks()

    expect(recorded.fullDefinitionCalls).toHaveLength(2)
    expect(recorded.compactDefinitionCalls).toHaveLength(1)
  })

  it.each([
    { accepted: true, expectedRollback: 'structural' },
    { accepted: false, expectedRollback: 'initial' },
  ])(
    'rebases a later failed watcher write when structural accepted=$accepted',
    async ({ accepted, expectedRollback }) => {
      setupScriptDefinitions()
      const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
      flushSync()

      const baseline = [script('script-1', 'initial')]
      const structuralFinal = [script('script-1', 'structural')]
      const structural = beginCharacterScriptDefinitionStructuralWrite(
        'characterScripts',
        'char-1',
        structuralFinal,
        { kind: 'characterScripts', characterId: 'char-1', scripts: baseline },
        0,
      )
      getDatabase().characters[0].customscript = structuralFinal
      flushSync()
      expect(recorded.commands).toEqual([])

      const laterResult = createDeferred<{ status: 'error'; error: string }>()
      recorded.commandResults.push(laterResult.promise)
      const laterFinal = [script('script-1', 'later')]
      getDatabase().characters[0].customscript = laterFinal
      flushSync()
      await vi.advanceTimersByTimeAsync(DELAY)
      await drainDefinitionCommandMicrotasks()
      expect(recorded.fullDefinitionCalls).toHaveLength(1)

      if (accepted) {
        acknowledgeCharacterScriptDefinitionStructuralWrite(structural)
      } else {
        rejectCharacterScriptDefinitionStructuralWrite(structural)
      }
      laterResult.resolve({ status: 'error', error: 'later rejected' })
      await drainDefinitionCommandMicrotasks()
      expect(getDatabase().characters[0].customscript).toEqual([script('script-1', expectedRollback)])
      stop()
    },
  )

  it('taints a never-run structural attempt before releasing a later full write', async () => {
    setupScriptDefinitions()
    const baseline = [script('script-1', 'initial')]
    const structuralFinal = [script('script-1', 'structural')]
    const structural = beginCharacterScriptDefinitionStructuralWrite(
      'characterScripts',
      'char-1',
      structuralFinal,
      { kind: 'characterScripts', characterId: 'char-1', scripts: baseline },
      0,
    )
    getDatabase().characters[0].customscript = structuralFinal
    rejectCharacterScriptDefinitionStructuralWrite(structural)

    dispatchReplaceCharacterScripts(
      'char-1',
      baseline,
      { kind: 'characterScripts', characterId: 'char-1', scripts: baseline },
      0,
    )
    await vi.advanceTimersByTimeAsync(0)
    await drainDefinitionCommandMicrotasks()

    expect(recorded.compactDefinitionCalls).toEqual([])
    expect(recorded.fullDefinitionCalls).toEqual([{ scope: 'character', kind: 'scripts', targetId: 'char-1' }])
  })
})

describe('watchServerBackedScriptDefinitions baselines', () => {
  it('refreshes baseline on server projection updates before local script edits', async () => {
    setupScriptDefinitions()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    resourceGuardState.epoch += 1
    getDatabase().characters[0].customscript = [script('script-1', 'server')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.commands).toEqual([])

    getDatabase().characters[0].customscript = [script('script-1', 'local')]
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

    resourceGuardState.epoch += 1
    getDatabase().modules[0].trigger = [trigger('module-trigger-1', 'server')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.commands).toEqual([])

    getDatabase().modules[0].trigger = [trigger('module-trigger-1', 'local')]
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

    getDatabase().characters[0].customscript = [script('script-1', 'local')]
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

  it('M8: flushes pending script-definition edits with keepalive and clears debounce', async () => {
    setupScriptDefinitions()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY * 10 })
    flushSync()

    getDatabase().characters[0].customscript = [script('script-1', 'unload local')]
    flushSync()
    flushPendingServerBackedScriptDefinitionPatches({ keepalive: true })
    await drainDefinitionCommandMicrotasks()

    expect(recorded.commands).toHaveLength(1)
    expect(recorded.commands[0].keepalive).toBe(true)
    expect(recorded.commands[0].built).toEqual({
      kind: 'replaceCharacterScripts',
      baseRevision: 1,
      characterId: 'char-1',
      scripts: [script('script-1', 'unload local')],
    })

    await vi.advanceTimersByTimeAsync(DELAY * 10)
    expect(recorded.commands).toHaveLength(1)
    stop()
  })

  it('M8: watcher teardown flushes pending script-definition edits and clears debounce', async () => {
    setupScriptDefinitions()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY * 10 })
    flushSync()

    getDatabase().characters[0].customscript = [script('script-1', 'teardown local')]
    flushSync()
    stop()
    await drainDefinitionCommandMicrotasks()

    expect(recorded.commands).toHaveLength(1)
    expect(recorded.commands[0].keepalive).toBeUndefined()
    expect(recorded.commands[0].built).toEqual({
      kind: 'replaceCharacterScripts',
      baseRevision: 1,
      characterId: 'char-1',
      scripts: [script('script-1', 'teardown local')],
    })

    await vi.advanceTimersByTimeAsync(DELAY * 10)
    expect(recorded.commands).toHaveLength(1)
  })
})

const BIG_BODY = 'x'.repeat(5000)

// One character carries a large hydrated message history (~250 KB) alongside a
// small customscript, so a whole-characters clone is distinguishable from the
// per-key scripts/triggers stringify by serialized size.
function setupHydratedScriptDefinitions(): void {
  testDatabaseSetter.database = {
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
      getDatabase().characters[0].customscript = [script('script-1', 'edited')]
      flushSync()
    })

    expect(instrumented.maxClonedSize).toBeLessThan(BIG_BODY.length)

    await vi.advanceTimersByTimeAsync(DELAY)
    await drainDefinitionCommandMicrotasks()
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
      getDatabase().characters[0].chats[0].message.push({
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
    testDatabaseSetter.database = {
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

  it('restores the changed character script when live still matches the attempted payload', async () => {
    setupTwoCharacters()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    getDatabase().characters[0].customscript = [script('script-1', 'char1-local')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()
    expect(recorded.commands).toHaveLength(1)

    getDatabase().characters[1].customscript = [script('script-2', 'char2-concurrent')]

    recorded.commands[0].rollback?.()

    expect(getDatabase().characters[0].customscript).toEqual([script('script-1', 'initial')])
    expect(getDatabase().characters[1].customscript).toEqual([script('script-2', 'char2-concurrent')])
    stop()
  })

  it('restores the changed character trigger when live still matches the attempted payload', async () => {
    setupTwoCharacters()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    getDatabase().characters[0].triggerscript = [trigger('trigger-1', 'trigger-local')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()
    expect(recorded.commands).toHaveLength(1)

    getDatabase().characters[1].triggerscript = [trigger('trigger-2', 'trigger2-concurrent')]

    recorded.commands[0].rollback?.()

    expect(getDatabase().characters[0].triggerscript).toEqual([trigger('trigger-1', 'initial trigger')])
    expect(getDatabase().characters[1].triggerscript).toEqual([trigger('trigger-2', 'trigger2-concurrent')])
    stop()
  })

  it('skips character script rollback when the same target changed after dispatch', async () => {
    setupTwoCharacters()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    getDatabase().characters[0].customscript = [script('script-1', 'char1-local')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()
    expect(recorded.commands).toHaveLength(1)

    getDatabase().characters[1].customscript = [script('script-2', 'char2-concurrent')]
    getDatabase().characters[0].customscript = [script('script-1', 'char1-newer')]

    recorded.commands[0].rollback?.()

    expect(getDatabase().characters[0].customscript).toEqual([script('script-1', 'char1-newer')])
    expect(getDatabase().characters[1].customscript).toEqual([script('script-2', 'char2-concurrent')])
    stop()
  })

  it('skips character trigger rollback when the same target changed after dispatch', async () => {
    setupTwoCharacters()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    getDatabase().characters[0].triggerscript = [trigger('trigger-1', 'trigger-local')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()
    expect(recorded.commands).toHaveLength(1)

    getDatabase().characters[0].triggerscript = [trigger('trigger-1', 'trigger-newer')]

    recorded.commands[0].rollback?.()

    expect(getDatabase().characters[0].triggerscript).toEqual([trigger('trigger-1', 'trigger-newer')])
    expect(getDatabase().characters[0].customscript).toEqual([script('script-1', 'initial')])
    stop()
  })

  it('restores the changed module script when live still matches the attempted payload', async () => {
    testDatabaseSetter.database = {
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

    getDatabase().modules[0].regex = [script('module-script-1', 'local')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()
    expect(recorded.commands).toHaveLength(1)

    getDatabase().modules[0].trigger = [trigger('module-trigger-1', 'trigger-concurrent')]

    recorded.commands[0].rollback?.()

    expect(getDatabase().modules[0].regex).toEqual([script('module-script-1', 'initial module')])
    expect(getDatabase().modules[0].trigger).toEqual([trigger('module-trigger-1', 'trigger-concurrent')])
    stop()
  })

  it('skips module script rollback when the same target changed after dispatch', async () => {
    testDatabaseSetter.database = {
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

    getDatabase().modules[0].regex = [script('module-script-1', 'local')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()
    expect(recorded.commands).toHaveLength(1)

    getDatabase().modules[0].trigger = [trigger('module-trigger-1', 'trigger-concurrent')]
    getDatabase().modules[0].regex = [script('module-script-1', 'newer')]

    recorded.commands[0].rollback?.()

    expect(getDatabase().modules[0].regex).toEqual([script('module-script-1', 'newer')])
    expect(getDatabase().modules[0].trigger).toEqual([trigger('module-trigger-1', 'trigger-concurrent')])
    stop()
  })

  it('restores the changed module trigger when live still matches the attempted payload', async () => {
    testDatabaseSetter.database = {
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

    getDatabase().modules[0].trigger = [trigger('module-trigger-1', 'local')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()
    expect(recorded.commands).toHaveLength(1)

    getDatabase().modules[0].regex = [script('module-script-1', 'regex-concurrent')]

    recorded.commands[0].rollback?.()

    expect(getDatabase().modules[0].trigger).toEqual([trigger('module-trigger-1', 'initial module trigger')])
    expect(getDatabase().modules[0].regex).toEqual([script('module-script-1', 'regex-concurrent')])
    stop()
  })

  it('skips module trigger rollback when the same target changed after dispatch', async () => {
    testDatabaseSetter.database = {
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

    getDatabase().modules[0].trigger = [trigger('module-trigger-1', 'local')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()
    expect(recorded.commands).toHaveLength(1)

    getDatabase().modules[0].regex = [script('module-script-1', 'regex-concurrent')]
    getDatabase().modules[0].trigger = [trigger('module-trigger-1', 'newer')]

    recorded.commands[0].rollback?.()

    expect(getDatabase().modules[0].trigger).toEqual([trigger('module-trigger-1', 'newer')])
    expect(getDatabase().modules[0].regex).toEqual([script('module-script-1', 'regex-concurrent')])
    stop()
  })

  it('does not let stale no-op rollback suppress watcher dispatch for a newer same-target edit', async () => {
    setupTwoCharacters()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    getDatabase().characters[0].customscript = [script('script-1', 'edit-A')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()
    expect(recorded.commands).toHaveLength(1)

    getDatabase().characters[0].customscript = [script('script-1', 'edit-B')]
    recorded.commands[0].rollback?.()
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()

    expect(recorded.commands.map((entry) => entry.built)).toEqual([
      {
        kind: 'replaceCharacterScripts',
        baseRevision: 1,
        characterId: 'char-1',
        scripts: [script('script-1', 'edit-A')],
      },
      {
        kind: 'replaceCharacterScripts',
        baseRevision: 1,
        characterId: 'char-1',
        scripts: [script('script-1', 'edit-B')],
      },
    ])
    expect(getDatabase().characters[0].customscript).toEqual([script('script-1', 'edit-B')])
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
    getDatabase().characters[0].customscript = [script('script-1', 'edit-A')]
    flushSync()
    getDatabase().characters[0].customscript = [script('script-1', 'edit-B')]
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
    expect(getDatabase().characters[0].customscript).toEqual([script('script-1', 'initial')])
    stop()
  })

  it('skips coalesced character-script rollback when live changed after the final attempted edit', async () => {
    setupScriptDefinitions()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    getDatabase().characters[0].customscript = [script('script-1', 'edit-A')]
    flushSync()
    getDatabase().characters[0].customscript = [script('script-1', 'edit-B')]
    flushSync()

    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()

    expect(recorded.commands.map((entry) => entry.built)).toEqual([
      {
        kind: 'replaceCharacterScripts',
        baseRevision: 1,
        characterId: 'char-1',
        scripts: [script('script-1', 'edit-B')],
      },
    ])

    getDatabase().characters[0].customscript = [script('script-1', 'edit-C')]

    recorded.commands[0].rollback?.()
    expect(getDatabase().characters[0].customscript).toEqual([script('script-1', 'edit-C')])
    stop()
  })

  it('rolls a coalesced module-trigger edit back to the pre-first-edit baseline', async () => {
    setupScriptDefinitions()
    const stop = watchServerBackedScriptDefinitions({ delayMs: DELAY })
    flushSync()

    getDatabase().modules[0].trigger = [trigger('module-trigger-1', 'edit-A')]
    flushSync()
    getDatabase().modules[0].trigger = [trigger('module-trigger-1', 'edit-B')]
    flushSync()

    expect(recorded.commands).toEqual([])

    await vi.advanceTimersByTimeAsync(DELAY)
    await drainDefinitionCommandMicrotasks()

    expect(recorded.commands.map((entry) => entry.built)).toEqual([
      {
        kind: 'replaceModuleTriggers',
        baseRevision: 1,
        moduleId: 'module-1',
        triggers: [trigger('module-trigger-1', 'edit-B')],
      },
    ])
    expect(recorded.moduleDefinitionCalls).toEqual([
      {
        kind: 'triggers',
        optimisticCollectionEpoch: 0,
        acknowledgeOptimistic: true,
      },
    ])

    recorded.commands[0].rollback?.()
    expect(getDatabase().modules[0].trigger).toEqual([trigger('module-trigger-1', 'initial module trigger')])
    stop()
  })
})

// Scope the watcher's per-fire scan-and-stringify to the mounting panel's rows.

function setupMultiCharacterScriptDb(): void {
  testDatabaseSetter.database = {
    characters: [
      {
        chaId: 'char-1',
        // chats/chatPage keep the stores-level moduleUpdate $effect happy when
        // these tests flip selectedCharID.
        chats: [],
        chatPage: 0,
        customscript: [script('script-1', 'initial')],
        triggerscript: [trigger('trigger-1', 'initial trigger')],
      },
      {
        chaId: 'char-2',
        chats: [],
        chatPage: 0,
        // The sibling carries a LARGE script body so a whole-DB stringify is
        // distinguishable from the scoped one by serialized size.
        customscript: [script('script-2', BIG_BODY)],
        triggerscript: [trigger('trigger-2', 'sibling trigger')],
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

describe('watchServerBackedScriptDefinitions — scoped change detection (L31)', () => {
  it('character scope collects only the selected character, not siblings/modules', () => {
    setupMultiCharacterScriptDb()
    selectedCharID.set(0)
    const stop = watchServerBackedScriptDefinitions({
      scope: { kind: 'character' },
      delayMs: DELAY,
    })
    flushSync()

    const keys = [...collectScriptDefinitionCollectionSnapshots({ kind: 'character' }).keys()].sort()
    expect(keys).toEqual(['characterScripts:char-1', 'characterTriggers:char-1'])
    stop()
  })

  it('module scope collects only the open module', () => {
    setupMultiCharacterScriptDb()

    const keys = [
      ...collectScriptDefinitionCollectionSnapshots({
        kind: 'module',
        moduleId: 'module-1',
      }).keys(),
    ].sort()
    expect(keys).toEqual(['moduleScripts:module-1', 'moduleTriggers:module-1'])
  })

  it('all scope (default) still scans the whole DB — regression', () => {
    setupMultiCharacterScriptDb()

    const keys = [...collectScriptDefinitionCollectionSnapshots().keys()].sort()
    expect(keys).toEqual([
      'characterScripts:char-1',
      'characterScripts:char-2',
      'characterTriggers:char-1',
      'characterTriggers:char-2',
      'moduleScripts:module-1',
      'moduleTriggers:module-1',
    ])
  })

  it('L31: a character-scoped fire never stringifies the sibling scripts (clone cost stays scoped)', async () => {
    setupMultiCharacterScriptDb()
    selectedCharID.set(0)
    const stop = watchServerBackedScriptDefinitions({
      scope: { kind: 'character' },
      delayMs: DELAY,
    })
    flushSync()

    // An edit to the selected character fires a scoped scan: the sibling's
    // large script body is never serialized.
    const instrumented = withCloneInstrumentation(() => {
      getDatabase().characters[0].customscript = [script('script-1', 'edited')]
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

  it('character scope ignores a sibling edit but re-subscribes after a selection switch', async () => {
    setupMultiCharacterScriptDb()
    selectedCharID.set(0)
    const stop = watchServerBackedScriptDefinitions({
      scope: { kind: 'character' },
      delayMs: DELAY,
    })
    flushSync()

    // A sibling edit is out of scope → never dispatched.
    getDatabase().characters[1].customscript = [script('script-2', 'sibling edit')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.commands).toEqual([])

    // Switch to the sibling: the effect re-baselines (no spurious dispatch)...
    selectedCharID.set(1)
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.commands).toEqual([])

    // ...and an edit to the now-selected character IS dispatched.
    getDatabase().characters[1].customscript = [script('script-2', 'tracked edit')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()
    expect(recorded.commands.map((entry) => entry.built)).toEqual([
      {
        kind: 'replaceCharacterScripts',
        baseRevision: 1,
        characterId: 'char-2',
        scripts: [script('script-2', 'tracked edit')],
      },
    ])
    stop()
  })

  it('module scope dispatches only the open module and ignores character edits', async () => {
    setupMultiCharacterScriptDb()
    const stop = watchServerBackedScriptDefinitions({
      scope: { kind: 'module', moduleId: 'module-1' },
      delayMs: DELAY,
    })
    flushSync()

    // A character edit is out of scope for a module-scoped watcher.
    getDatabase().characters[0].customscript = [script('script-1', 'char edit')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.commands).toEqual([])

    // The open module's trigger edit IS dispatched.
    getDatabase().modules[0].trigger = [trigger('module-trigger-1', 'module edit')]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()
    expect(recorded.commands.map((entry) => entry.built)).toEqual([
      {
        kind: 'replaceModuleTriggers',
        baseRevision: 1,
        moduleId: 'module-1',
        triggers: [trigger('module-trigger-1', 'module edit')],
      },
    ])
    stop()
  })
})

describe('applyModuleScriptDefinitionDraft', () => {
  it('normalizes module draft ids, updates live/draft rows, and dispatches replacements', async () => {
    setupScriptDefinitions()
    const liveModule = getDatabase().modules[0]
    const draftModule = {
      id: liveModule.id,
      regex: [...liveModule.regex, scriptWithoutId('new module script')],
      trigger: [...liveModule.trigger, triggerWithoutId('new module trigger')],
    }

    const applied = applyModuleScriptDefinitionDraft(
      liveModule.id,
      draftModule as never,
      draftModule.regex,
      draftModule.trigger,
      DELAY,
    )

    expect(applied).toBe(true)
    expect(liveModule.regex).toHaveLength(2)
    expect(liveModule.trigger).toHaveLength(2)
    expect(draftModule.regex).toEqual(liveModule.regex)
    expect(draftModule.trigger).toEqual(liveModule.trigger)
    expect(liveModule.regex[1].id).toEqual(expect.any(String))
    expect(liveModule.trigger[1].id).toEqual(expect.any(String))

    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()

    expect(recorded.commands.map((entry) => entry.built)).toEqual([
      {
        kind: 'replaceModuleScripts',
        baseRevision: 1,
        moduleId: liveModule.id,
        scripts: liveModule.regex,
      },
      {
        kind: 'replaceModuleTriggers',
        baseRevision: 1,
        moduleId: liveModule.id,
        triggers: liveModule.trigger,
      },
    ])
    expect(recorded.moduleDefinitionCalls).toEqual([
      {
        kind: 'scripts',
        optimisticCollectionEpoch: 0,
        acknowledgeOptimistic: true,
      },
      {
        kind: 'triggers',
        optimisticCollectionEpoch: 0,
        acknowledgeOptimistic: true,
      },
    ])
  })

  it('keeps create-mode module drafts normalized without dispatching before the module exists', async () => {
    setupScriptDefinitions()
    const draftModule = {
      id: 'module-new',
      regex: [scriptWithoutId('draft script')],
      trigger: [triggerWithoutId('draft trigger')],
    }

    const applied = applyModuleScriptDefinitionDraft(
      draftModule.id,
      draftModule as never,
      draftModule.regex,
      draftModule.trigger,
      DELAY,
    )

    expect(applied).toBe(true)
    expect((draftModule.regex[0] as { id?: string }).id).toEqual(expect.any(String))
    expect((draftModule.trigger[0] as { id?: string }).id).toEqual(expect.any(String))

    await vi.advanceTimersByTimeAsync(DELAY)
    await Promise.resolve()

    expect(recorded.commands).toEqual([])
    expect(getDatabase().modules.map((module) => module.id)).toEqual(['module-1'])
  })

  it('ModuleMenu wires module regex and trigger drafts through the module script bridge', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/lib/Setting/Pages/Module/ModuleMenu.svelte'), 'utf8')

    expect(source).toContain('applyModuleScriptDefinitionDraft')
    expect(source).toContain('snapshotModuleScriptDraft')
    expect(source).toContain('currentModule?.regex ?? []')
    expect(source).toContain('currentModule?.trigger ?? []')
  })
})
