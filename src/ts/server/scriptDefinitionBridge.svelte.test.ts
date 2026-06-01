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
