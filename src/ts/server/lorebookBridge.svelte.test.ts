import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// No-data-loss invariant for `watchServerBackedLorebooks`.
// The watcher auto-persists any lorebook change it diffs; stubbing character
// `globalLore` makes a `[real]`→`[]` (hydrated→stub) transition possible, which —
// without the hydrated registry — the watcher would persist as a DELETION. Per the
// handover, keep `stores.svelte` real (DBState is the live $state the watcher reads)
// and mock only the command layer + the projection guard. Drive the reactive effect
// with flushSync() and the debounce with fake timers.

const recorded = vi.hoisted(() => ({
  commands: [] as Array<Record<string, unknown> & { rollback?: () => void }>,
}))
const projectionGuardState = vi.hoisted(() => ({ epoch: 0 }))
vi.mock('./commands', () => ({
  canUseServerCommands: () => true,
  runServerCommand: vi.fn(
    async (args: { command: (rev: number) => Promise<unknown>; rollback?: () => void; keepalive?: boolean }) => {
      const { command } = args
      const built = await command(1)
      recorded.commands.push({
        ...(built as Record<string, unknown>),
        ...(args.keepalive ? { keepalive: args.keepalive } : {}),
        ...(args.rollback ? { rollback: args.rollback } : {}),
      })
      return { status: 'ok', revision: 1 }
    },
  ),
  // Builders: identity stubs that tag the command kind so the test can assert which
  // entity (if any) the watcher tried to persist.
  createGlobalLorebookCommand: async (a: unknown) => ({ kind: 'createGlobal', a }),
  deleteCharacterLorebookEntryCommand: async (a: unknown) => ({ kind: 'deleteCharacterEntry', a }),
  deleteChatLorebookEntryCommand: async (a: unknown) => ({ kind: 'deleteChatEntry', a }),
  deleteGlobalLorebookCommand: async (a: unknown) => ({ kind: 'deleteGlobal', a }),
  deleteGlobalLorebookEntryCommand: async (a: unknown) => ({ kind: 'deleteGlobalEntry', a }),
  deleteModuleLorebookEntryCommand: async (a: unknown) => ({ kind: 'deleteModuleEntry', a }),
  reorderCharacterLorebookEntriesCommand: async (a: unknown) => ({ kind: 'reorderCharacterEntries', a }),
  reorderChatLorebookEntriesCommand: async (a: unknown) => ({ kind: 'reorderChatEntries', a }),
  reorderGlobalLorebooksCommand: async (a: unknown) => ({ kind: 'reorderGlobal', a }),
  reorderGlobalLorebookEntriesCommand: async (a: unknown) => ({ kind: 'reorderGlobalEntries', a }),
  reorderModuleLorebookEntriesCommand: async (a: unknown) => ({ kind: 'reorderModuleEntries', a }),
  replaceCharacterLorebooksCommand: async (a: { characterId?: string; entries?: unknown[] }) => ({
    kind: 'replaceCharacter',
    ...a,
  }),
  replaceChatLorebooksCommand: async (a: unknown) => ({ kind: 'replaceChat', a }),
  replaceGlobalLorebookEntriesCommand: async (a: unknown) => ({ kind: 'replaceGlobalEntries', a }),
  replaceModuleLorebooksCommand: async (a: { moduleId?: string; entries?: unknown[] }) => ({
    kind: 'replaceModule',
    ...a,
  }),
  selectGlobalLorebookCommand: async (a: unknown) => ({ kind: 'selectGlobal', a }),
  updateGlobalLorebookCommand: async (a: unknown) => ({ kind: 'updateGlobal', a }),
  upsertCharacterLorebookEntryCommand: async (a: unknown) => ({ kind: 'upsertCharacterEntry', a }),
  upsertChatLorebookEntryCommand: async (a: unknown) => ({ kind: 'upsertChatEntry', a }),
  upsertGlobalLorebookEntryCommand: async (a: unknown) => ({ kind: 'upsertGlobalEntry', a }),
  upsertModuleLorebookEntryCommand: async (a: unknown) => ({ kind: 'upsertModuleEntry', a }),
}))
vi.mock('./projectionWriteGuard.svelte', () => ({
  getServerProjectionApplyEpoch: () => projectionGuardState.epoch,
  withServerProjectionApply: (fn: () => unknown) => {
    const result = fn()
    projectionGuardState.epoch += 1
    return result
  },
  withTrustedServerProjectionWrite: (fn: () => unknown) => fn(),
}))

import { DBState, selectedCharID } from '../stores.svelte'
import { applyServerCharacterLorebookProjection } from '../storage/database.svelte'
import {
  applyLorebookEntryDraftEdit,
  collectLorebookCollectionSnapshots,
  createGlobalLorebook,
  currentGlobalLorebookStateSnapshot,
  currentLorebookCollectionScopedSnapshot,
  currentLorebookEntryScopedSnapshot,
  currentLorebookStateSnapshot,
  deleteGlobalLorebook,
  dispatchCreateGlobalLorebook,
  dispatchDeleteGlobalLorebook,
  dispatchReorderGlobalLorebooks,
  dispatchReplaceCharacterLorebooks,
  dispatchSelectGlobalLorebook,
  dispatchUpdateGlobalLorebook,
  flushPendingLorebookEntryDraftEdit,
  flushPendingServerBackedLorebookPatches,
  markCharacterLorebookHydrated,
  recordHydratedCharacterLorebooks,
  replaceCharacterLorebookCollection,
  resetLorebookHydration,
  resetServerBackedLorebookBridgeForTests,
  restoreLorebookEntryState,
  restoreLorebookState,
  renameGlobalLorebook,
  setActiveChatLorebookLocalActivation,
  watchServerBackedLorebooks,
} from './lorebookBridge.svelte'
import { withCloneInstrumentation } from '../__tests__/cloneCostHarness'

type Entry = { key?: string; content?: string; id?: string; folder?: string }
type GlobalLorebookFixture = { id: string; name: string; data: Entry[] }

const DELAY = 50

function setupCharacter(globalLore: unknown): void {
  ;(DBState as { db: unknown }).db = {
    characters: [{ chaId: 'c1', chats: [], globalLore }],
    loreBook: [],
    loreBookPage: 0,
    modules: [],
  }
  selectedCharID.set(0)
}

function setupGlobalLorebooks(
  loreBook: GlobalLorebookFixture[] = [{ id: 'g1', name: 'Initial', data: [] }],
  loreBookPage = 0,
): void {
  ;(DBState as { db: unknown }).db = {
    characters: [],
    loreBook,
    loreBookPage,
    modules: [],
  }
  selectedCharID.set(-1)
}

function globalLorebookIds(): string[] {
  return (DBState.db.loreBook as unknown as GlobalLorebookFixture[]).map((lorebook) => lorebook.id)
}

function characterReplaceCommands(): Array<Record<string, unknown> & { rollback?: () => void }> {
  return recorded.commands.filter((c) => c.kind === 'replaceCharacter')
}

function characterEntryCommands(): Array<Record<string, unknown> & { a?: unknown; rollback?: () => void }> {
  return recorded.commands.filter((c) => c.kind === 'upsertCharacterEntry')
}

function characterEntryDeleteCommands(): Array<Record<string, unknown> & { a?: unknown; rollback?: () => void }> {
  return recorded.commands.filter((c) => c.kind === 'deleteCharacterEntry')
}

function characterEntryReorderCommands(): Array<Record<string, unknown> & { a?: unknown; rollback?: () => void }> {
  return recorded.commands.filter((c) => c.kind === 'reorderCharacterEntries')
}

function globalCreateCommands(): Array<Record<string, unknown> & { a?: unknown; rollback?: () => void }> {
  return recorded.commands.filter((c) => c.kind === 'createGlobal')
}

function globalDeleteCommands(): Array<Record<string, unknown> & { a?: unknown; rollback?: () => void }> {
  return recorded.commands.filter((c) => c.kind === 'deleteGlobal')
}

function globalUpdateCommands(): Array<Record<string, unknown> & { a?: unknown; rollback?: () => void }> {
  return recorded.commands.filter((c) => c.kind === 'updateGlobal')
}

async function flushServerCommandRecording(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function exportedFunctionSource(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}`)
  expect(start).toBeGreaterThanOrEqual(0)
  const next = source.indexOf('\nexport function ', start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

function localFunctionSource(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`)
  expect(start).toBeGreaterThanOrEqual(0)
  const next = source.indexOf('\nfunction ', start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

beforeEach(() => {
  vi.useFakeTimers()
  projectionGuardState.epoch = 0
  resetLorebookHydration()
  recorded.commands.length = 0
})

afterEach(() => {
  resetServerBackedLorebookBridgeForTests()
  vi.useRealTimers()
  selectedCharID.set(-1)
  recorded.commands.length = 0
})

describe('watchServerBackedLorebooks — no-data-loss invariant', () => {
  it('persists an edit to a HYDRATED character globalLore (the watcher is alive)', async () => {
    setupCharacter([{ key: 'a', content: 'A' }] as Entry[])
    markCharacterLorebookHydrated('c1')
    const stop = watchServerBackedLorebooks({ delayMs: DELAY })
    flushSync() // initialize the snapshot baseline

    recorded.commands.length = 0
    ;(DBState.db.characters[0].globalLore as Entry[]).push({ key: 'b', content: 'B' })
    flushSync() // diff → queue the replacement
    await vi.advanceTimersByTimeAsync(DELAY)

    const cmds = characterEntryCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].a).toMatchObject({ characterId: 'c1', entry: { content: 'B' } })
    stop()
  })

  it('NEVER persists a re-stubbed (no-longer-hydrated) character — the data-loss path', async () => {
    setupCharacter([{ key: 'a', content: 'A' }] as Entry[])
    markCharacterLorebookHydrated('c1')
    const stop = watchServerBackedLorebooks({ delayMs: DELAY })
    flushSync() // baseline = hydrated [A]

    recorded.commands.length = 0
    // A projection re-apply re-stubs every character: reset the registry, then the
    // re-applied stub wipes globalLore to [] (the bootstrap default).
    resetLorebookHydration()
    ;(DBState.db.characters[0] as { globalLore: unknown }).globalLore = []
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.commands).toHaveLength(0)
    stop()
  })

  it('NEVER persists a character that was never hydrated (a pure stub)', async () => {
    setupCharacter([] as Entry[]) // stubbed-empty, never marked hydrated
    const stop = watchServerBackedLorebooks({ delayMs: DELAY })
    flushSync()

    recorded.commands.length = 0
    // Even a spurious change to a stub must not be persisted.
    ;(DBState.db.characters[0] as { globalLore: unknown }).globalLore = [{ key: 'x', content: 'X' }]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.commands).toHaveLength(0)
    stop()
  })

  it('recordHydratedCharacterLorebooks marks characters whose projected globalLore is present', async () => {
    // Resident (array) → hydrated; stubbed (absent) → not.
    recordHydratedCharacterLorebooks([
      { chaId: 'resident', globalLore: [{ key: 'k' }] },
      { chaId: 'stub' /* globalLore absent */ },
    ])
    setupCharacter([{ key: 'a', content: 'A' }] as Entry[])
    ;(DBState.db.characters[0] as { chaId: string }).chaId = 'resident'
    const stop = watchServerBackedLorebooks({ delayMs: DELAY })
    flushSync()

    recorded.commands.length = 0
    ;(DBState.db.characters[0].globalLore as Entry[]).push({ key: 'b', content: 'B' })
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    // 'resident' is tracked → its edit persists.
    expect(characterEntryCommands().map((c) => (c.a as { characterId?: string }).characterId)).toEqual(['resident'])
    stop()
  })

  it('M11: foreign character-lorebook projection apply refreshes baseline without echoing, then local edits dispatch', async () => {
    setupCharacter([{ key: 'a', content: 'A' }] as Entry[])
    markCharacterLorebookHydrated('c1')
    const stop = watchServerBackedLorebooks({ delayMs: DELAY })
    flushSync()

    recorded.commands.length = 0
    const applied = applyServerCharacterLorebookProjection('c1', [{ key: 'server', content: 'Server' }])
    expect(applied).toBe(true)
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.commands).toHaveLength(0)

    recorded.commands.length = 0
    ;(DBState.db.characters[0].globalLore as Entry[]).push({
      key: 'local',
      content: 'Local',
    })
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    const cmds = characterReplaceCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].characterId).toBe('c1')
    expect((cmds[0].entries as Entry[]).map((entry) => entry.content)).toEqual(['Server', 'Local'])
    stop()
  })

  it('L24: global lorebook rename rollback suppresses watcher echo and keeps later edits live', async () => {
    setupGlobalLorebooks()
    const stop = watchServerBackedLorebooks({ scope: { kind: 'global' }, delayMs: DELAY })
    flushSync()

    DBState.db.loreBook[0].name = 'Conflict'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    const firstUpdates = recorded.commands.filter((command) => command.kind === 'updateGlobal')
    expect(firstUpdates).toHaveLength(1)
    expect(firstUpdates[0].a).toMatchObject({
      lorebookId: 'g1',
      patch: { name: 'Conflict' },
    })

    firstUpdates[0].rollback?.()
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(DBState.db.loreBook[0].name).toBe('Initial')
    expect(recorded.commands.filter((command) => command.kind === 'updateGlobal')).toHaveLength(1)

    DBState.db.loreBook[0].name = 'User Edit After Rollback'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(
      recorded.commands
        .filter((command) => command.kind === 'updateGlobal')
        .map((command) => (command.a as { patch: { name: string } }).patch),
    ).toEqual([{ name: 'Conflict' }, { name: 'User Edit After Rollback' }])
    stop()
  })

  it('L24: global lorebook direct rollback parity routes every dispatcher through suppressed helpers', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/ts/server/lorebookBridge.svelte.ts'), 'utf8')

    expect(exportedFunctionSource(source, 'dispatchCreateGlobalLorebook')).toContain(
      'rollback: () => rollbackServerBackedGlobalLorebooks(previous)',
    )
    expect(exportedFunctionSource(source, 'dispatchDeleteGlobalLorebook')).toContain(
      'rollback: () => rollbackServerBackedGlobalLorebooks(previous)',
    )
    expect(exportedFunctionSource(source, 'dispatchSelectGlobalLorebook')).toContain(
      'rollback: () => rollbackServerBackedGlobalLorebooks(previous)',
    )
    expect(exportedFunctionSource(source, 'dispatchUpdateGlobalLorebook')).toContain(
      'rollback: () => rollbackServerBackedLorebooks(previous)',
    )
    expect(exportedFunctionSource(source, 'dispatchReorderGlobalLorebooks')).toContain(
      'rollback: () => rollbackServerBackedLorebooks(previous)',
    )

    const globalRollback = localFunctionSource(source, 'rollbackServerBackedGlobalLorebooks')
    expect(globalRollback).toContain('withSuppressedLorebookWatcher')
    expect(globalRollback).toContain('restoreGlobalLorebookState(snapshot)')

    const fullRollback = localFunctionSource(source, 'rollbackServerBackedLorebooks')
    expect(fullRollback).toContain('withSuppressedLorebookWatcher')
    expect(fullRollback).toContain('restoreLorebookState(snapshot)')
  })

  it('L24: global lorebook direct rollback closures restore under an active watcher without echoes', async () => {
    const scenarios: Array<{
      label: string
      commandKind: string
      run: () => void
      expectRestored: () => void
    }> = [
      {
        label: 'create',
        commandKind: 'createGlobal',
        run: () => {
          setupGlobalLorebooks()
          const previous = currentGlobalLorebookStateSnapshot()
          const created = { id: 'g2', name: 'Created', data: [] }
          DBState.db.loreBook.push(created as never)
          dispatchCreateGlobalLorebook(created, previous)
        },
        expectRestored: () => {
          expect(globalLorebookIds()).toEqual(['g1'])
        },
      },
      {
        label: 'delete',
        commandKind: 'deleteGlobal',
        run: () => {
          setupGlobalLorebooks([
            { id: 'g1', name: 'Initial', data: [] },
            { id: 'g2', name: 'Second', data: [] },
          ])
          const previous = currentGlobalLorebookStateSnapshot()
          DBState.db.loreBook.splice(1, 1)
          dispatchDeleteGlobalLorebook('g2', previous)
        },
        expectRestored: () => {
          expect(globalLorebookIds()).toEqual(['g1', 'g2'])
        },
      },
      {
        label: 'reorder',
        commandKind: 'reorderGlobal',
        run: () => {
          setupGlobalLorebooks([
            { id: 'g1', name: 'Initial', data: [] },
            { id: 'g2', name: 'Second', data: [] },
          ])
          const previous = currentLorebookStateSnapshot()
          DBState.db.loreBook.reverse()
          dispatchReorderGlobalLorebooks(previous)
        },
        expectRestored: () => {
          expect(globalLorebookIds()).toEqual(['g1', 'g2'])
        },
      },
      {
        label: 'select',
        commandKind: 'selectGlobal',
        run: () => {
          setupGlobalLorebooks(
            [
              { id: 'g1', name: 'Initial', data: [] },
              { id: 'g2', name: 'Second', data: [] },
            ],
            0,
          )
          const previous = currentGlobalLorebookStateSnapshot()
          DBState.db.loreBookPage = 1
          dispatchSelectGlobalLorebook('g2', previous)
        },
        expectRestored: () => {
          expect(DBState.db.loreBookPage).toBe(0)
        },
      },
      {
        label: 'update',
        commandKind: 'updateGlobal',
        run: () => {
          setupGlobalLorebooks()
          const previous = currentLorebookStateSnapshot()
          DBState.db.loreBook[0].name = 'Conflict'
          dispatchUpdateGlobalLorebook('g1', { name: 'Conflict' }, previous)
        },
        expectRestored: () => {
          expect(DBState.db.loreBook[0].name).toBe('Initial')
        },
      },
    ]

    for (const scenario of scenarios) {
      recorded.commands.length = 0
      scenario.run()
      await flushServerCommandRecording()

      const command = recorded.commands.find((entry) => entry.kind === scenario.commandKind)
      expect(command?.rollback).toEqual(expect.any(Function))

      const stop = watchServerBackedLorebooks({ scope: { kind: 'global' }, delayMs: DELAY })
      flushSync()
      recorded.commands.length = 0

      try {
        command?.rollback?.()
        flushSync()
        await vi.advanceTimersByTimeAsync(DELAY)

        scenario.expectRestored()
        expect(recorded.commands).toEqual([])
      } finally {
        stop()
      }
    }
  })
})

describe('global lorebook modal bridge helpers', () => {
  it('routes lorepreset create, rename, and delete writes through bridge helpers', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/lib/Setting/lorepreset.svelte'), 'utf8')

    expect(source).not.toContain('withTrustedServerProjectionWrite')
    expect(source).not.toContain('currentGlobalLorebookStateSnapshot')
    expect(source).not.toContain('dispatchCreateGlobalLorebook')
    expect(source).not.toContain('dispatchDeleteGlobalLorebook')
    expect(source).toContain('createGlobalLorebook()')
    expect(source).toContain('renameGlobalLorebook(ind, value)')
    expect(source).toContain('deleteGlobalLorebook(ind)')
  })

  it('creates a global lorebook, dispatches create, and rolls back to the previous list', async () => {
    setupGlobalLorebooks()

    expect(createGlobalLorebook()).toBe(true)
    await flushServerCommandRecording()

    const lorebooks = DBState.db.loreBook as unknown as GlobalLorebookFixture[]
    expect(lorebooks).toHaveLength(2)
    expect(lorebooks[1]).toMatchObject({
      id: expect.any(String),
      name: 'New LoreBook',
      data: [],
    })

    const creates = globalCreateCommands()
    expect(creates).toHaveLength(1)
    expect(creates[0].a).toMatchObject({
      lorebook: {
        id: lorebooks[1].id,
        name: 'New LoreBook',
        data: [],
      },
    })

    creates[0].rollback?.()
    expect(globalLorebookIds()).toEqual(['g1'])
  })

  it('deletes a global lorebook, resets page, dispatches delete, and rolls back list/page', async () => {
    setupGlobalLorebooks(
      [
        { id: 'g1', name: 'Initial', data: [] },
        { id: 'g2', name: 'Second', data: [] },
      ],
      1,
    )

    expect(deleteGlobalLorebook(1)).toBe(true)
    await flushServerCommandRecording()

    expect(globalLorebookIds()).toEqual(['g1'])
    expect(DBState.db.loreBookPage).toBe(0)

    const deletes = globalDeleteCommands()
    expect(deletes).toHaveLength(1)
    expect(deletes[0].a).toMatchObject({ lorebookId: 'g2' })

    deletes[0].rollback?.()
    expect(globalLorebookIds()).toEqual(['g1', 'g2'])
    expect(DBState.db.loreBookPage).toBe(1)
  })

  it('does not delete the only global lorebook', async () => {
    setupGlobalLorebooks()

    expect(deleteGlobalLorebook(0)).toBe(false)
    await flushServerCommandRecording()

    expect(globalLorebookIds()).toEqual(['g1'])
    expect(DBState.db.loreBookPage).toBe(0)
    expect(globalDeleteCommands()).toHaveLength(0)
  })

  it('renames through the bridge and keeps watcher update rollback suppressed', async () => {
    setupGlobalLorebooks()
    const stop = watchServerBackedLorebooks({ scope: { kind: 'global' }, delayMs: DELAY })
    flushSync()
    recorded.commands.length = 0

    try {
      expect(renameGlobalLorebook(0, 'Renamed')).toBe(true)
      expect(DBState.db.loreBook[0].name).toBe('Renamed')
      flushSync()
      await vi.advanceTimersByTimeAsync(DELAY)

      const updates = globalUpdateCommands()
      expect(updates).toHaveLength(1)
      expect(updates[0].a).toMatchObject({
        lorebookId: 'g1',
        patch: { name: 'Renamed' },
      })

      updates[0].rollback?.()
      flushSync()
      await vi.advanceTimersByTimeAsync(DELAY)

      expect(DBState.db.loreBook[0].name).toBe('Initial')
      expect(globalUpdateCommands()).toHaveLength(1)
    } finally {
      stop()
    }
  })
})

// Scope the watcher's change-detection snapshot to the mounting panel's collection.

function setupMultiCollectionDb(): void {
  ;(DBState as { db: unknown }).db = {
    loreBook: [{ id: 'g1', name: 'Global One', data: [{ key: 'gk', content: 'GC', id: 'ge1' }] }],
    loreBookPage: 0,
    characters: [
      {
        chaId: 'c0',
        globalLore: [{ key: 'c0g', content: 'C0G', id: 'c0g1' }],
        chats: [{ id: 'c0chat', localLore: [{ key: 'c0l', content: 'C0L', id: 'c0l1' }] }],
      },
      {
        chaId: 'c1',
        globalLore: [{ key: 'c1g', content: 'C1G', id: 'c1g1' }],
        chats: [{ id: 'c1chat', localLore: [{ key: 'c1l', content: 'C1L', id: 'c1l1' }] }],
      },
    ],
    modules: [
      { id: 'm0', lorebook: [{ key: 'm0', content: 'M0', id: 'm0e1' }] },
      { id: 'm1', lorebook: [{ key: 'm1', content: 'M1', id: 'm1e1' }] },
    ],
  }
  selectedCharID.set(0)
}

function setupSelectedCharacterLocalLoreCacheDb(): void {
  ;(DBState as { db: unknown }).db = {
    loreBook: [],
    loreBookPage: 0,
    characters: [
      {
        chaId: 'cache-char',
        chatPage: 0,
        globalLore: [{ key: 'stubbed-global', content: 'Not hydrated', id: 'stubbed-global-1' }],
        chats: [
          {
            id: 'open-chat',
            name: 'Open Chat',
            localLore: [{ key: 'open', content: 'Open lore', id: 'open-lore-1' }],
          },
          {
            id: 'closed-chat',
            name: 'Closed Chat',
            localLore: [{ key: 'closed', content: 'Closed lore', id: 'closed-lore-1' }],
          },
        ],
      },
    ],
    modules: [],
  }
  selectedCharID.set(0)
}

function setupActiveChatLocalActivationDb(chatId: string | null = 'active-chat'): void {
  const chat: Record<string, unknown> = {
    name: 'Active Chat',
    localLore: [],
  }
  if (chatId !== null) {
    chat.id = chatId
  }

  ;(DBState as { db: unknown }).db = {
    loreBook: [],
    loreBookPage: 0,
    characters: [
      {
        chaId: 'activation-char',
        chatPage: 0,
        globalLore: [],
        chats: [chat],
      },
    ],
    modules: [],
  }
  selectedCharID.set(0)
}

function stripIdsForScopedEnsureRegression(): void {
  const db = DBState.db as any
  delete db.loreBook[0].id
  delete db.loreBook[0].data[0].id
  for (const character of db.characters) {
    delete character.globalLore[0].id
    delete character.chats[0].localLore[0].id
  }
  for (const module of db.modules) {
    delete module.lorebook[0].id
  }
}

function chatReplaceChatIds(): string[] {
  return recorded.commands.filter((c) => c.kind === 'replaceChat').map((c) => (c.a as { chatId?: string }).chatId ?? '')
}

function chatReplaceCommands(): Array<Record<string, unknown> & { a?: unknown; rollback?: () => void }> {
  return recorded.commands.filter((c) => c.kind === 'replaceChat')
}

function chatEntryCommands(): Array<Record<string, unknown> & { a?: unknown; rollback?: () => void }> {
  return recorded.commands.filter((c) => c.kind === 'upsertChatEntry')
}

function chatEntryDeleteCommands(): Array<Record<string, unknown> & { a?: unknown; rollback?: () => void }> {
  return recorded.commands.filter((c) => c.kind === 'deleteChatEntry')
}

function moduleReplaceCommands(): Array<Record<string, unknown>> {
  return recorded.commands.filter((c) => c.kind === 'replaceModule')
}

function moduleEntryCommands(): Array<Record<string, unknown> & { a?: unknown }> {
  return recorded.commands.filter((c) => c.kind === 'upsertModuleEntry')
}

function setupK4EditorDb(): void {
  const entries = Array.from({ length: 24 }, (_unused, index) => ({
    id: `entry-${index}`,
    key: `key-${index}`,
    secondkey: '',
    insertorder: index,
    comment: `Entry ${index}`,
    content: `${'x'.repeat(240)}-${index}`,
    mode: 'normal',
    alwaysActive: false,
    selective: false,
  }))

  ;(DBState as { db: unknown }).db = {
    loreBook: [{ id: 'global-k4', name: 'Global K4', data: entries.slice(0, 6) }],
    loreBookPage: 0,
    characters: [
      {
        chaId: 'c-k4',
        globalLore: entries,
        chats: [
          {
            id: 'chat-k4',
            localLore: [
              {
                id: 'chat-entry-0',
                key: 'chat-key',
                secondkey: '',
                insertorder: 0,
                comment: 'Chat entry',
                content: 'chat content',
                mode: 'normal',
                alwaysActive: false,
                selective: false,
              },
            ],
          },
        ],
      },
      {
        chaId: 'c-k4-sibling',
        globalLore: [
          {
            id: 'sibling-entry',
            key: 'sibling',
            secondkey: '',
            insertorder: 0,
            comment: 'Sibling',
            content: 'sibling content',
            mode: 'normal',
            alwaysActive: false,
            selective: false,
          },
        ],
        chats: [],
      },
    ],
    modules: [],
  }
  selectedCharID.set(0)
  markCharacterLorebookHydrated('c-k4')
  markCharacterLorebookHydrated('c-k4-sibling')
}

function setupK4ModuleDb(): void {
  const entries = Array.from({ length: 18 }, (_unused, index) => ({
    id: `module-entry-${index}`,
    key: `module-key-${index}`,
    secondkey: '',
    insertorder: index,
    comment: `Module Entry ${index}`,
    content: `${'m'.repeat(220)}-${index}`,
    mode: 'normal',
    alwaysActive: false,
    selective: false,
  }))

  ;(DBState as { db: unknown }).db = {
    loreBook: [],
    loreBookPage: 0,
    characters: [],
    modules: [
      {
        id: 'module-k4',
        name: 'Module K4',
        description: '',
        lorebook: entries,
      },
    ],
  }
  selectedCharID.set(-1)
}

describe('K4 lorebook editor entry draft scope', () => {
  it('K4: a single typing draft clones only the edited entry before debounce settle', () => {
    setupK4EditorDb()
    const collectionSize = JSON.stringify(DBState.db.characters[0].globalLore).length

    const firstDraft = {
      ...(DBState.db.characters[0].globalLore as Entry[])[7],
      content: 'draft one',
    } as Entry

    const first = withCloneInstrumentation(() =>
      applyLorebookEntryDraftEdit({ kind: 'character', characterId: 'c-k4' }, 7, firstDraft as any, DELAY),
    )

    expect(first.result).toBe(true)
    expect(first.maxClonedSize).toBeLessThan(collectionSize)
    expect(recorded.commands).toHaveLength(0)
  })

  it('K4: the debounced final server write sends only the final edited entry', async () => {
    setupK4EditorDb()

    applyLorebookEntryDraftEdit(
      { kind: 'character', characterId: 'c-k4' },
      5,
      { ...(DBState.db.characters[0].globalLore as Entry[])[5], content: 'intermediate' } as any,
      DELAY,
    )
    applyLorebookEntryDraftEdit(
      { kind: 'character', characterId: 'c-k4' },
      5,
      { ...(DBState.db.characters[0].globalLore as Entry[])[5], content: 'final draft' } as any,
      DELAY,
    )

    expect(characterEntryCommands()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(DELAY)

    const cmds = characterEntryCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].a).toMatchObject({
      characterId: 'c-k4',
      entryId: 'entry-5',
      entry: { id: 'entry-5', content: 'final draft' },
    })
    expect(characterReplaceCommands()).toHaveLength(0)
  })

  it('K4: flushing a draft sends the final entry before the debounce delay', async () => {
    setupK4EditorDb()

    applyLorebookEntryDraftEdit(
      { kind: 'character', characterId: 'c-k4' },
      3,
      { ...(DBState.db.characters[0].globalLore as Entry[])[3], content: 'blur final' } as any,
      DELAY * 10,
    )
    flushPendingLorebookEntryDraftEdit({ kind: 'character', characterId: 'c-k4' })
    await vi.advanceTimersByTimeAsync(0)

    const cmds = characterEntryCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].a).toMatchObject({
      characterId: 'c-k4',
      entryId: 'entry-3',
      entry: { id: 'entry-3', content: 'blur final' },
    })

    await vi.advanceTimersByTimeAsync(DELAY * 10)
    expect(characterEntryCommands()).toHaveLength(1)
  })

  it('M8: bridge flush sends pending lorebook replacements with keepalive and clears debounce', async () => {
    setupK4EditorDb()

    applyLorebookEntryDraftEdit(
      { kind: 'character', characterId: 'c-k4' },
      4,
      { ...(DBState.db.characters[0].globalLore as Entry[])[4], content: 'unload final' } as any,
      DELAY * 10,
    )
    flushPendingServerBackedLorebookPatches({ keepalive: true })
    await vi.advanceTimersByTimeAsync(0)

    const cmds = characterEntryCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].keepalive).toBe(true)
    expect(cmds[0].a).toMatchObject({
      characterId: 'c-k4',
      entryId: 'entry-4',
      entry: { id: 'entry-4', content: 'unload final' },
    })

    await vi.advanceTimersByTimeAsync(DELAY * 10)
    expect(characterEntryCommands()).toHaveLength(1)
  })

  it('M8: watcher teardown flushes pending lorebook replacements and clears debounce', async () => {
    setupK4EditorDb()
    const stop = watchServerBackedLorebooks({ scope: { kind: 'character' }, delayMs: DELAY * 10 })
    flushSync()

    recorded.commands.length = 0
    ;(DBState.db.characters[0].globalLore as Entry[]).push({
      key: 'teardown',
      content: 'Teardown lore',
    })
    flushSync()
    stop()
    await vi.advanceTimersByTimeAsync(0)

    const cmds = characterEntryCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].keepalive).toBeUndefined()
    expect(cmds[0].a).toMatchObject({ characterId: 'c-k4', entry: { content: 'Teardown lore' } })

    await vi.advanceTimersByTimeAsync(DELAY * 10)
    expect(characterEntryCommands()).toHaveLength(1)
  })

  it('K4: immediate flush with an active watcher sends one replacement only', async () => {
    setupK4EditorDb()
    const stop = watchServerBackedLorebooks({ scope: { kind: 'character' }, delayMs: DELAY })
    flushSync()

    recorded.commands.length = 0
    try {
      applyLorebookEntryDraftEdit(
        { kind: 'character', characterId: 'c-k4' },
        3,
        { ...(DBState.db.characters[0].globalLore as Entry[])[3], content: 'blur final' } as any,
        DELAY * 10,
      )
      flushPendingLorebookEntryDraftEdit({ kind: 'character', characterId: 'c-k4' })
      flushSync()
      await vi.advanceTimersByTimeAsync(0)

      const cmds = characterEntryCommands()
      expect(cmds).toHaveLength(1)
      expect(cmds[0].a).toMatchObject({
        characterId: 'c-k4',
        entryId: 'entry-3',
        entry: { id: 'entry-3', content: 'blur final' },
      })

      await vi.advanceTimersByTimeAsync(DELAY)
      expect(characterEntryCommands()).toHaveLength(1)
    } finally {
      stop()
    }
  })

  it('K4: module external entry drafts avoid collection clones and flush final module entry', async () => {
    setupK4ModuleDb()
    const module = (DBState.db.modules as any[])[0] as { lorebook: Entry[] }
    const collectionSize = JSON.stringify(module.lorebook).length
    const originalEntries = module.lorebook
    const untouchedSibling = module.lorebook[2]
    const editedEntry = module.lorebook[9]

    const instrumented = withCloneInstrumentation(() =>
      applyLorebookEntryDraftEdit(
        { kind: 'module', moduleId: 'module-k4' },
        9,
        { ...module.lorebook[9], content: 'module draft final' } as any,
        DELAY * 10,
      ),
    )

    expect(instrumented.result).toBe(true)
    expect(instrumented.maxClonedSize).toBeLessThan(collectionSize)
    expect(module.lorebook).toBe(originalEntries)
    expect(module.lorebook[2]).toBe(untouchedSibling)
    expect(module.lorebook[9]).toBe(editedEntry)
    expect(module.lorebook[9].content).toBe('module draft final')
    expect(moduleEntryCommands()).toHaveLength(0)

    flushPendingLorebookEntryDraftEdit({ kind: 'module', moduleId: 'module-k4' })
    await vi.advanceTimersByTimeAsync(0)

    const cmds = moduleEntryCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].a).toMatchObject({
      moduleId: 'module-k4',
      entryId: 'module-entry-9',
      entry: { id: 'module-entry-9', content: 'module draft final' },
    })

    await vi.advanceTimersByTimeAsync(DELAY * 10)
    expect(moduleEntryCommands()).toHaveLength(1)
  })

  it('K4: ModuleMenu wires external LoreBookList typing through module draft handlers', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/lib/Setting/Pages/Module/ModuleMenu.svelte'), 'utf8')
    const lorebookList = source.slice(
      source.indexOf('<LoreBookList'),
      source.indexOf('<div class="text-textcolor2 mt-2 flex">'),
    )

    expect(source).toContain("applyLorebookEntryDraftEdit({ kind: 'module', moduleId }, index, value)")
    expect(source).toContain("flushPendingLorebookEntryDraftEdit({ kind: 'module', moduleId })")
    expect(lorebookList).toContain('onEntryChange={updateModuleLorebookValue}')
    expect(lorebookList).toContain('onEntrySettled={flushModuleLorebookValue}')
    expect(lorebookList).toContain('onCollectionChange={updateModuleLorebookCollection}')
  })

  it('Batch 4: lorebook components route collection writes through bridge helpers', () => {
    const setting = readFileSync(path.join(process.cwd(), 'src/lib/SideBars/LoreBook/LoreBookSetting.svelte'), 'utf8')
    const list = readFileSync(path.join(process.cwd(), 'src/lib/SideBars/LoreBook/LoreBookList.svelte'), 'utf8')

    for (const source of [setting, list]) {
      expect(source).not.toContain('withTrustedServerProjectionWrite')
      expect(source).not.toContain('currentLorebookCollectionScopedSnapshot')
      expect(source).not.toContain('dispatchReplaceCharacterLorebooks')
      expect(source).not.toContain('dispatchReplaceChatLorebooks')
      expect(source).not.toContain('dispatchReplaceGlobalLorebookEntries')
    }

    expect(setting).toContain('replaceCharacterLorebookCollection')
    expect(setting).toContain('replaceChatLorebookCollection')
    expect(list).toContain('replaceGlobalLorebookEntryCollection')
  })

  it('Batch 5: LoreBookData local activation delegates trusted writes to the bridge', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/lib/SideBars/LoreBook/LoreBookData.svelte'), 'utf8')

    expect(source).not.toContain('withTrustedServerProjectionWrite')
    expect(source).not.toContain('currentLorebookCollectionScopedSnapshot')
    expect(source).not.toContain('dispatchReplaceChatLorebooks')
    expect(source).toContain('setActiveChatLorebookLocalActivation')
  })

  it('Batch 5: activating a global lorebook locally assigns an id, creates child lore, and dispatches', async () => {
    setupActiveChatLocalActivationDb()
    const book = {
      key: 'parent-key',
      secondkey: '',
      insertorder: 100,
      comment: 'Parent lore',
      content: 'Parent content',
      mode: 'normal',
      alwaysActive: false,
      selective: false,
    } as Entry

    const applied = setActiveChatLorebookLocalActivation(book as any, true, DELAY)

    expect(applied).toBe(true)
    expect(book.id).toEqual(expect.any(String))
    expect(DBState.db.characters[0].chats[0].localLore).toEqual([
      {
        key: '',
        comment: '',
        content: '',
        mode: 'child',
        insertorder: 100,
        alwaysActive: true,
        secondkey: '',
        selective: false,
        id: book.id,
      },
    ])

    await vi.advanceTimersByTimeAsync(DELAY)

    const cmds = chatEntryCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].a).toMatchObject({
      chatId: 'active-chat',
      entryId: book.id,
      entry: {
        id: book.id,
        mode: 'child',
        alwaysActive: true,
      },
    })

    cmds[0].rollback?.()
    expect(DBState.db.characters[0].chats[0].localLore).toEqual([])
  })

  it('Batch 5: local activation dispatch uses the cloned activation snapshot after later live mutations', async () => {
    setupActiveChatLocalActivationDb()
    const book = {
      key: 'parent-key',
      secondkey: '',
      insertorder: 100,
      comment: 'Parent lore',
      content: 'Parent content',
      mode: 'normal',
      alwaysActive: false,
      selective: false,
    } as Entry

    const applied = setActiveChatLorebookLocalActivation(book as any, true, DELAY)
    const activatedId = book.id

    expect(applied).toBe(true)
    expect(activatedId).toEqual(expect.any(String))

    DBState.db.characters[0].chats[0].localLore.push({
      key: 'later',
      comment: 'Later mutation',
      content: 'This should not be in the delayed activation command',
      mode: 'normal',
      insertorder: 100,
      alwaysActive: false,
      secondkey: '',
      selective: false,
      id: 'later-live-entry',
    } as never)

    await vi.advanceTimersByTimeAsync(DELAY)

    const upserts = chatEntryCommands()
    expect(upserts).toHaveLength(1)
    expect(upserts[0].a).toMatchObject({
      chatId: 'active-chat',
      entryId: activatedId,
      entry: {
        id: activatedId,
        mode: 'child',
        alwaysActive: true,
      },
    })
    expect((upserts[0].a as { entry?: { id?: string } }).entry?.id).not.toBe('later-live-entry')
    expect(chatReplaceCommands()).toHaveLength(0)
  })

  it('Batch 5: deactivating a local activation removes the child lore and dispatches', async () => {
    setupActiveChatLocalActivationDb()
    DBState.db.characters[0].chats[0].localLore = [
      {
        key: '',
        comment: '',
        content: '',
        mode: 'child',
        insertorder: 100,
        alwaysActive: true,
        secondkey: '',
        selective: false,
        id: 'parent-entry',
      },
    ] as never

    const applied = setActiveChatLorebookLocalActivation({ id: 'parent-entry' } as any, false, DELAY)

    expect(applied).toBe(true)
    expect(DBState.db.characters[0].chats[0].localLore).toEqual([])

    await vi.advanceTimersByTimeAsync(DELAY)

    const cmds = chatEntryDeleteCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].a).toMatchObject({
      chatId: 'active-chat',
      entryId: 'parent-entry',
    })
  })

  it('Batch 5: local activation is a no-op without a current chat id', async () => {
    setupActiveChatLocalActivationDb(null)
    const book = {
      key: 'parent-key',
      secondkey: '',
      insertorder: 100,
      comment: 'Parent lore',
      content: 'Parent content',
      mode: 'normal',
      alwaysActive: false,
      selective: false,
    } as Entry

    const applied = setActiveChatLorebookLocalActivation(book as any, true, DELAY)

    expect(applied).toBe(false)
    expect(book.id).toBeUndefined()
    expect(DBState.db.characters[0].chats[0].localLore).toEqual([])

    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.commands).toHaveLength(0)
  })

  it('K4: failed entry-draft rollback restores only the edited entry', () => {
    setupK4EditorDb()
    const previous = currentLorebookEntryScopedSnapshot({ kind: 'character', characterId: 'c-k4' }, 2)

    ;(DBState.db.characters[0].globalLore as Entry[])[2].content = 'failed optimistic edit'
    ;(DBState.db.characters[0].globalLore as Entry[])[4].content = 'same collection sibling edit'
    ;(DBState.db.characters[1].globalLore as Entry[])[0].content = 'other character edit'

    restoreLorebookEntryState(previous)

    expect((DBState.db.characters[0].globalLore as Entry[])[2].content).toContain('-2')
    expect((DBState.db.characters[0].globalLore as Entry[])[4].content).toBe('same collection sibling edit')
    expect((DBState.db.characters[1].globalLore as Entry[])[0].content).toBe('other character edit')
  })

  it('L27: coalesced entry-draft rollback restores the first pre-edit collection', async () => {
    setupK4EditorDb()
    const scope = { kind: 'character', characterId: 'c-k4' } as const
    const originalContents = (DBState.db.characters[0].globalLore as Entry[]).map((entry) => entry.content)

    applyLorebookEntryDraftEdit(
      scope,
      2,
      {
        ...(DBState.db.characters[0].globalLore as Entry[])[2],
        content: 'draft first entry',
      } as any,
      DELAY,
    )
    applyLorebookEntryDraftEdit(
      scope,
      4,
      {
        ...(DBState.db.characters[0].globalLore as Entry[])[4],
        content: 'draft second entry',
      } as any,
      DELAY,
    )

    expect((DBState.db.characters[0].globalLore as Entry[])[2].content).toBe('draft first entry')
    expect((DBState.db.characters[0].globalLore as Entry[])[4].content).toBe('draft second entry')

    await vi.advanceTimersByTimeAsync(DELAY)

    const cmds = characterReplaceCommands()
    expect(cmds).toHaveLength(1)
    expect((cmds[0].entries as Entry[])[2].content).toBe('draft first entry')
    expect((cmds[0].entries as Entry[])[4].content).toBe('draft second entry')

    cmds[0].rollback?.()

    expect((DBState.db.characters[0].globalLore as Entry[]).map((entry) => entry.content)).toEqual(originalContents)
  })

  it('K4: collection operations still use collection-level replacement rollback', async () => {
    setupK4EditorDb()
    const previous = currentLorebookCollectionScopedSnapshot({
      kind: 'character',
      characterId: 'c-k4',
    })
    const originalIds = (DBState.db.characters[0].globalLore as Entry[]).map((entry) => entry.id)
    const reordered = [...(DBState.db.characters[0].globalLore as Entry[])]
    const moved = reordered.shift()
    if (moved) {
      moved.folder = 'folder-k4'
      reordered.push(moved)
    }

    DBState.db.characters[0].globalLore = reordered as any
    dispatchReplaceCharacterLorebooks('c-k4', reordered as any, previous, DELAY)
    await vi.advanceTimersByTimeAsync(DELAY)

    const cmds = characterReplaceCommands()
    expect(cmds).toHaveLength(1)
    expect((cmds[0].entries as Entry[]).map((entry) => entry.id)).toEqual([...originalIds.slice(1), originalIds[0]])
    ;(DBState.db.characters[0].globalLore as Entry[])[1].content = 'collection failed edit'
    restoreLorebookState(previous)
    expect((DBState.db.characters[0].globalLore as Entry[]).map((entry) => entry.id)).toEqual(originalIds)
  })

  it('Batch 4: collection replacement helper owns the optimistic write, clone, dispatch, and rollback', async () => {
    setupK4EditorDb()
    const originalIds = (DBState.db.characters[0].globalLore as Entry[]).map((entry) => entry.id)
    const nextEntries = [
      ...(DBState.db.characters[0].globalLore as Entry[]),
      {
        id: 'helper-entry',
        key: 'helper',
        secondkey: '',
        insertorder: 100,
        comment: 'Helper',
        content: 'Helper lore',
        mode: 'normal',
        alwaysActive: false,
        selective: false,
      },
    ]

    const replaced = replaceCharacterLorebookCollection('c-k4', nextEntries as any, DELAY)

    expect(replaced).toBe(true)
    expect(DBState.db.characters[0].globalLore).not.toBe(nextEntries)
    expect((DBState.db.characters[0].globalLore as Entry[]).at(-1)?.content).toBe('Helper lore')

    nextEntries[nextEntries.length - 1].content = 'caller mutation after replace'
    expect((DBState.db.characters[0].globalLore as Entry[]).at(-1)?.content).toBe('Helper lore')

    await vi.advanceTimersByTimeAsync(DELAY)

    const cmds = characterEntryCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].a).toMatchObject({
      characterId: 'c-k4',
      entryId: 'helper-entry',
      entry: { id: 'helper-entry', content: 'Helper lore' },
    })

    cmds[0].rollback?.()
    expect((DBState.db.characters[0].globalLore as Entry[]).map((entry) => entry.id)).toEqual(originalIds)
  })

  it('K4: simple collection delete and pure reorder use compact entry commands', async () => {
    setupK4EditorDb()
    const entries = DBState.db.characters[0].globalLore as Entry[]

    const deletePrevious = currentLorebookCollectionScopedSnapshot({
      kind: 'character',
      characterId: 'c-k4',
    })
    entries.splice(3, 1)
    dispatchReplaceCharacterLorebooks('c-k4', entries as any, deletePrevious, DELAY)
    await vi.advanceTimersByTimeAsync(DELAY)

    const deletes = characterEntryDeleteCommands()
    expect(deletes).toHaveLength(1)
    expect(deletes[0].a).toMatchObject({ characterId: 'c-k4', entryId: 'entry-3' })

    recorded.commands.length = 0
    const reorderPrevious = currentLorebookCollectionScopedSnapshot({
      kind: 'character',
      characterId: 'c-k4',
    })
    const moved = entries.shift()
    if (moved) entries.push(moved)
    dispatchReplaceCharacterLorebooks('c-k4', entries as any, reorderPrevious, DELAY)
    await vi.advanceTimersByTimeAsync(DELAY)

    const reorders = characterEntryReorderCommands()
    expect(reorders).toHaveLength(1)
    expect(reorders[0].a).toMatchObject({
      characterId: 'c-k4',
      entryIds: entries.map((entry) => entry.id),
    })
  })
})

describe('watchServerBackedLorebooks — scoped change detection (Phase 6)', () => {
  it('global scope collects only the global lorebook list', () => {
    setupMultiCollectionDb()
    markCharacterLorebookHydrated('c0')
    markCharacterLorebookHydrated('c1')

    const keys = [...collectLorebookCollectionSnapshots({ kind: 'global' }).keys()].sort()
    expect(keys).toEqual(['global:g1', 'globalMeta:g1'])
    // No character/chat/module entries leak into a global-scoped fire.
    expect(keys.some((k) => k.startsWith('character:'))).toBe(false)
    expect(keys.some((k) => k.startsWith('chat:'))).toBe(false)
    expect(keys.some((k) => k.startsWith('module:'))).toBe(false)
  })

  it('module scope collects only the open module, not all modules', () => {
    setupMultiCollectionDb()

    const keys = [...collectLorebookCollectionSnapshots({ kind: 'module', moduleId: 'm0' }).keys()]
    expect(keys).toEqual(['module:m0'])
    // 'm1' and every global/character/chat entry are out of scope.
    expect(keys).not.toContain('module:m1')
  })

  it('character scope collects only the selected character, not siblings/modules/global', () => {
    setupMultiCollectionDb()
    markCharacterLorebookHydrated('c0')
    markCharacterLorebookHydrated('c1')
    selectedCharID.set(0)

    // Start a character-scoped watcher so the selected-char mirror tracks c0.
    const stop = watchServerBackedLorebooks({ scope: { kind: 'character' }, delayMs: DELAY })
    flushSync()

    const keys = [...collectLorebookCollectionSnapshots({ kind: 'character' }).keys()].sort()
    expect(keys).toEqual(['character:c0', 'chat:c0chat'])
    // c1 (sibling), modules, and the global list are never scanned.
    expect(keys).not.toContain('character:c1')
    expect(keys).not.toContain('chat:c1chat')
    expect(keys.some((k) => k.startsWith('module:') || k.startsWith('global'))).toBe(false)
    stop()
  })

  it('all scope (default) still scans the whole DB — regression', () => {
    setupMultiCollectionDb()
    markCharacterLorebookHydrated('c0')
    markCharacterLorebookHydrated('c1')

    const keys = [...collectLorebookCollectionSnapshots({ kind: 'all' }).keys()].sort()
    expect(keys).toEqual([
      'character:c0',
      'character:c1',
      'chat:c0chat',
      'chat:c1chat',
      'global:g1',
      'globalMeta:g1',
      'module:m0',
      'module:m1',
    ])
  })

  it('a scoped fire performs far fewer snapshot clones than the whole-DB scan', () => {
    setupMultiCollectionDb()
    markCharacterLorebookHydrated('c0')
    markCharacterLorebookHydrated('c1')
    selectedCharID.set(0)
    const stop = watchServerBackedLorebooks({ scope: { kind: 'character' }, delayMs: DELAY })
    flushSync()

    const scoped = withCloneInstrumentation(() => collectLorebookCollectionSnapshots({ kind: 'character' }))
    const whole = withCloneInstrumentation(() => collectLorebookCollectionSnapshots({ kind: 'all' }))

    // The whole-DB scan stringifies every character + chat + module + global; the
    // character scope stringifies the hydrated character globalLore and reuses
    // the selected chat's cached localLore snapshot.
    expect(scoped.result.size).toBe(2)
    expect(scoped.jsonCloneCount).toBeLessThan(whole.jsonCloneCount)
    expect(scoped.jsonCloneCount).toBe(1)
    stop()
  })

  it('L28: unchanged selected-character chat localLore references reuse cached snapshots', () => {
    setupSelectedCharacterLocalLoreCacheDb()
    const stop = watchServerBackedLorebooks({ scope: { kind: 'character' }, delayMs: DELAY })
    flushSync()

    const reused = withCloneInstrumentation(() => collectLorebookCollectionSnapshots({ kind: 'character' }))

    expect([...reused.result.keys()].sort()).toEqual(['chat:closed-chat', 'chat:open-chat'])
    expect(reused.jsonCloneCount).toBe(0)
    stop()
  })

  it('L28: replacing one localLore array stringifies only that chat', () => {
    setupSelectedCharacterLocalLoreCacheDb()
    const stop = watchServerBackedLorebooks({ scope: { kind: 'character' }, delayMs: DELAY })
    flushSync()
    const before = collectLorebookCollectionSnapshots({ kind: 'character' })

    const closedChat = DBState.db.characters[0].chats[1]
    closedChat.localLore = [
      ...(closedChat.localLore as Entry[]),
      { key: 'closed-new', content: 'Closed replacement', id: 'closed-lore-2' },
    ] as never

    const changed = withCloneInstrumentation(() => collectLorebookCollectionSnapshots({ kind: 'character' }))

    expect(changed.jsonCloneCount).toBe(1)
    expect(changed.result.get('chat:open-chat')).toBe(before.get('chat:open-chat'))
    expect(changed.result.get('chat:closed-chat')).not.toBe(before.get('chat:closed-chat'))
    stop()
  })

  it('L28: prunes disappeared chat ids from the localLore snapshot cache', () => {
    setupSelectedCharacterLocalLoreCacheDb()
    const stop = watchServerBackedLorebooks({ scope: { kind: 'character' }, delayMs: DELAY })
    flushSync()

    const removedChat = DBState.db.characters[0].chats[1]
    DBState.db.characters[0].chats = [DBState.db.characters[0].chats[0]] as never
    collectLorebookCollectionSnapshots({ kind: 'character' })
    DBState.db.characters[0].chats = [DBState.db.characters[0].chats[0], removedChat] as never

    const reappeared = withCloneInstrumentation(() => collectLorebookCollectionSnapshots({ kind: 'character' }))

    expect(reappeared.jsonCloneCount).toBe(1)
    expect([...reappeared.result.keys()].sort()).toEqual(['chat:closed-chat', 'chat:open-chat'])
    stop()
  })

  it('L32: a character-scoped watcher first-run id ensure touches only the selected character collections', () => {
    setupMultiCollectionDb()
    stripIdsForScopedEnsureRegression()
    markCharacterLorebookHydrated('c0')
    markCharacterLorebookHydrated('c1')
    selectedCharID.set(0)

    const stop = watchServerBackedLorebooks({ scope: { kind: 'character' }, delayMs: DELAY })
    flushSync()

    expect((DBState.db.characters[0].globalLore as Entry[])[0].id).toEqual(expect.any(String))
    expect((DBState.db.characters[0].chats[0].localLore as Entry[])[0].id).toEqual(expect.any(String))
    expect((DBState.db.characters[1].globalLore as Entry[])[0].id).toBeUndefined()
    expect((DBState.db.characters[1].chats[0].localLore as Entry[])[0].id).toBeUndefined()
    expect(((DBState.db.modules as any[])[0].lorebook as Entry[])[0].id).toBeUndefined()
    expect(((DBState.db.modules as any[])[1].lorebook as Entry[])[0].id).toBeUndefined()
    expect(((DBState.db.loreBook as any[])[0] as { id?: string }).id).toBeUndefined()
    expect(((DBState.db.loreBook as any[])[0].data as Entry[])[0].id).toBeUndefined()

    selectedCharID.set(1)
    flushSync()

    expect((DBState.db.characters[1].globalLore as Entry[])[0].id).toEqual(expect.any(String))
    expect((DBState.db.characters[1].chats[0].localLore as Entry[])[0].id).toEqual(expect.any(String))
    expect(((DBState.db.modules as any[])[0].lorebook as Entry[])[0].id).toBeUndefined()
    expect(((DBState.db.loreBook as any[])[0] as { id?: string }).id).toBeUndefined()
    stop()
  })

  it('L32: a global-scoped watcher first-run id ensure touches only the global lorebook list', () => {
    setupMultiCollectionDb()
    stripIdsForScopedEnsureRegression()
    markCharacterLorebookHydrated('c0')
    markCharacterLorebookHydrated('c1')

    const stop = watchServerBackedLorebooks({ scope: { kind: 'global' }, delayMs: DELAY })
    flushSync()

    expect(((DBState.db.loreBook as any[])[0] as { id?: string }).id).toEqual(expect.any(String))
    expect(((DBState.db.loreBook as any[])[0].data as Entry[])[0].id).toEqual(expect.any(String))
    expect((DBState.db.characters[0].globalLore as Entry[])[0].id).toBeUndefined()
    expect((DBState.db.characters[0].chats[0].localLore as Entry[])[0].id).toBeUndefined()
    expect(((DBState.db.modules as any[])[0].lorebook as Entry[])[0].id).toBeUndefined()
    stop()
  })

  it('L32: the global lorebook modal mount does not call the broad id ensure', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/lib/Setting/lorepreset.svelte'), 'utf8')
    const mountEffect = source.slice(source.indexOf('$effect'), source.indexOf('</script>'))

    expect(mountEffect).toContain('ensureGlobalLorebookListIds()')
    expect(mountEffect).not.toContain('ensureAllClientLorebookIds')
  })

  it('character-scoped watcher dispatches a selected-character edit but ignores a sibling chat edit', async () => {
    setupMultiCollectionDb()
    markCharacterLorebookHydrated('c0')
    markCharacterLorebookHydrated('c1')
    selectedCharID.set(0)
    const stop = watchServerBackedLorebooks({ scope: { kind: 'character' }, delayMs: DELAY })
    flushSync() // baseline = c0 only

    // A sibling character's chat edit is out of scope → never dispatched.
    recorded.commands.length = 0
    DBState.db.characters[1].chats[0].localLore = [
      ...(DBState.db.characters[1].chats[0].localLore as Entry[]),
      { key: 'x', content: 'X' },
    ] as never
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(chatReplaceChatIds()).not.toContain('c1chat')

    // The selected character's own chat edit IS dispatched.
    recorded.commands.length = 0
    DBState.db.characters[0].chats[0].localLore = [
      ...(DBState.db.characters[0].chats[0].localLore as Entry[]),
      { key: 'y', content: 'Y' },
    ] as never
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(chatEntryCommands().map((c) => (c.a as { chatId?: string }).chatId)).toContain('c0chat')
    stop()
  })

  it('L28: character-scoped watcher dispatches a non-open chat localLore replacement', async () => {
    setupSelectedCharacterLocalLoreCacheDb()
    const stop = watchServerBackedLorebooks({ scope: { kind: 'character' }, delayMs: DELAY })
    flushSync()

    recorded.commands.length = 0
    const closedChat = DBState.db.characters[0].chats[1]
    closedChat.localLore = [
      ...(closedChat.localLore as Entry[]),
      { key: 'closed-dispatch', content: 'Non-open replacement', id: 'closed-lore-2' },
    ] as never
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    const cmds = chatEntryCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].a).toMatchObject({
      chatId: 'closed-chat',
      entryId: 'closed-lore-2',
      entry: { id: 'closed-lore-2', content: 'Non-open replacement' },
    })
    stop()
  })

  it('L28: flushed direct chat entry edits advance the character-scope localLore cache baseline', async () => {
    setupSelectedCharacterLocalLoreCacheDb()
    const stop = watchServerBackedLorebooks({ scope: { kind: 'character' }, delayMs: DELAY })
    flushSync()

    const closedChat = DBState.db.characters[0].chats[1]
    applyLorebookEntryDraftEdit(
      { kind: 'chat', chatId: 'closed-chat' },
      0,
      { ...(closedChat.localLore as Entry[])[0], content: 'Draft B' } as any,
      DELAY * 10,
    )
    flushPendingLorebookEntryDraftEdit({ kind: 'chat', chatId: 'closed-chat' })
    await vi.advanceTimersByTimeAsync(0)
    flushSync()

    const directCmds = chatEntryCommands()
    expect(directCmds).toHaveLength(1)
    expect(directCmds[0].a).toMatchObject({
      chatId: 'closed-chat',
      entryId: 'closed-lore-1',
      entry: { id: 'closed-lore-1', content: 'Draft B' },
    })

    recorded.commands.length = 0
    closedChat.localLore = [
      ...(closedChat.localLore as Entry[]),
      { key: 'queued-c', content: 'Queued C', id: 'queued-c-id' },
    ] as never
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    const cmds = chatEntryCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].a).toMatchObject({
      chatId: 'closed-chat',
      entryId: 'queued-c-id',
      entry: { id: 'queued-c-id', content: 'Queued C' },
    })

    cmds[0].rollback?.()
    expect((closedChat.localLore as Entry[]).map((entry) => entry.content)).toEqual(['Draft B'])
    stop()
  })

  it('character scope re-subscribes to the newly selected character after a switch', async () => {
    setupMultiCollectionDb()
    markCharacterLorebookHydrated('c0')
    markCharacterLorebookHydrated('c1')
    selectedCharID.set(0)
    const stop = watchServerBackedLorebooks({ scope: { kind: 'character' }, delayMs: DELAY })
    flushSync()

    // Switch to c1: the effect re-runs and re-baselines to c1 (no spurious dispatch).
    recorded.commands.length = 0
    selectedCharID.set(1)
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(characterReplaceCommands()).toHaveLength(0)

    // An edit to the now-selected c1 is dispatched...
    recorded.commands.length = 0
    ;(DBState.db.characters[1].globalLore as Entry[]).push({ key: 'b', content: 'B' })
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(characterEntryCommands().map((c) => (c.a as { characterId?: string }).characterId)).toEqual(['c1'])

    // ...while an edit to the no-longer-selected c0 is ignored.
    recorded.commands.length = 0
    ;(DBState.db.characters[0].globalLore as Entry[]).push({ key: 'z', content: 'Z' })
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(characterReplaceCommands()).toHaveLength(0)
    stop()
  })
})
