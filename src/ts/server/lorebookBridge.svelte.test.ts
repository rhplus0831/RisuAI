import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// No-data-loss invariant for `watchServerBackedLorebooks`.
// The watcher auto-persists any lorebook change it diffs; stubbing character
// `globalLore` makes a `[real]`→`[]` (hydrated→stub) transition possible, which —
// without the hydrated registry — the watcher would persist as a DELETION. Per the
// handover, keep the resource-backed database real (it is the live $state the watcher reads)
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

import { selectedCharID } from '../stores.svelte'
import { getResourceDatabase as getDatabase, replaceResourceDatabase as setDatabaseLite } from './resourceState.svelte'
import {
  applyLorebookEntryDraftEdit,
  applyServerCharacterLorebookResource,
  changedLorebookEntryDraftFields,
  clearDirtyLorebookEntryFieldsMatchingProjection,
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
  dispatchReplaceChatLorebooks,
  dispatchReplaceCharacterLorebooks,
  dispatchReplaceGlobalLorebookEntries,
  dispatchReplaceModuleLorebooks,
  dispatchSelectGlobalLorebook,
  dispatchUpdateGlobalLorebook,
  flushPendingLorebookEntryDraftEdit,
  flushPendingServerBackedLorebookPatches,
  mergeLorebookEntryProjectionDraft,
  markCharacterLorebookHydrated,
  recordHydratedCharacterLorebooks,
  replaceCharacterLorebookCollection,
  replaceModuleLorebookCollectionDraft,
  resetLorebookHydration,
  resetServerBackedLorebookBridgeForTests,
  restoreLorebookEntryState,
  restoreLorebookState,
  renameGlobalLorebook,
  scopedLorebookStateSnapshot,
  selectGlobalLorebook,
  setActiveChatLorebookLocalActivation,
  watchServerBackedLorebooks,
} from './lorebookBridge.svelte'
import { withCloneInstrumentation } from '../__tests__/cloneCostHarness'

type Entry = { key?: string; content?: string; id?: string; folder?: string; comment?: string }
type GlobalLorebookFixture = { id: string; name: string; data: Entry[] }

const DELAY = 50

const testDatabaseState = {
  set db(value: unknown) {
    setDatabaseLite(value as any)
  },
}

function setupCharacter(globalLore: unknown): void {
  testDatabaseState.db = {
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
  testDatabaseState.db = {
    characters: [],
    loreBook,
    loreBookPage,
    modules: [],
  }
  selectedCharID.set(-1)
}

function globalLorebookIds(): string[] {
  return (getDatabase().loreBook as unknown as GlobalLorebookFixture[]).map((lorebook) => lorebook.id)
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

function globalEntryCommands(): Array<Record<string, unknown> & { a?: unknown; rollback?: () => void }> {
  return recorded.commands.filter((c) => c.kind === 'upsertGlobalEntry')
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

function globalReorderCommands(): Array<Record<string, unknown> & { a?: unknown; rollback?: () => void }> {
  return recorded.commands.filter((c) => c.kind === 'reorderGlobal')
}

function globalSelectCommands(): Array<Record<string, unknown> & { a?: unknown; rollback?: () => void }> {
  return recorded.commands.filter((c) => c.kind === 'selectGlobal')
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

describe('Phase 2 lorebook entry dirty projection merge', () => {
  function loreEntry(overrides: Partial<Entry> = {}): Entry {
    return {
      id: 'entry-1',
      key: 'initial key',
      content: 'initial content',
      comment: 'initial comment',
      ...overrides,
    }
  }

  it('preserves dirty entry fields while refreshing clean projection fields', () => {
    const previous = loreEntry({ content: 'initial content', comment: 'initial comment' })
    const draft = loreEntry({ content: 'local newer content', comment: 'initial comment' })
    const projection = loreEntry({
      content: 'older projected content',
      comment: 'projected clean comment',
      key: 'projected clean key',
    })
    const dirtyFields = new Set(changedLorebookEntryDraftFields(previous as any, draft as any))

    clearDirtyLorebookEntryFieldsMatchingProjection(dirtyFields as any, draft as any, projection as any)
    const merged = mergeLorebookEntryProjectionDraft(draft as any, projection as any, dirtyFields as any) as Entry

    expect([...dirtyFields]).toEqual(['content'])
    expect(merged.content).toBe('local newer content')
    expect(merged.comment).toBe('projected clean comment')
    expect(merged.key).toBe('projected clean key')
  })

  it('clears exact catch-up dirty fields so later clean projections can replace them', () => {
    const previous = loreEntry({ content: 'initial content', comment: 'initial comment' })
    let draft = loreEntry({ content: 'local content', comment: 'initial comment' })
    const staleProjection = loreEntry({ content: 'older projected content', comment: 'projected clean comment' })
    const caughtUpProjection = loreEntry({ content: 'local content', comment: 'projected clean comment' })
    const laterCleanProjection = loreEntry({ content: 'server later content', comment: 'projected clean comment' })
    const dirtyFields = new Set(changedLorebookEntryDraftFields(previous as any, draft as any))

    clearDirtyLorebookEntryFieldsMatchingProjection(dirtyFields as any, draft as any, staleProjection as any)
    draft = mergeLorebookEntryProjectionDraft(draft as any, staleProjection as any, dirtyFields as any) as Entry

    expect(dirtyFields).toEqual(new Set(['content']))
    expect(draft).toMatchObject({
      content: 'local content',
      comment: 'projected clean comment',
    })

    clearDirtyLorebookEntryFieldsMatchingProjection(dirtyFields as any, draft as any, caughtUpProjection as any)
    draft = mergeLorebookEntryProjectionDraft(draft as any, laterCleanProjection as any, dirtyFields as any) as Entry

    expect(dirtyFields.size).toBe(0)
    expect(draft.content).toBe('server later content')
  })

  it('LoreBookData uses dirty projection merge instead of blind draft replacement', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/lib/SideBars/LoreBook/LoreBookData.svelte'), 'utf8')

    expect(source).toContain('dirtyDraftFields')
    expect(source).toContain('changedLorebookEntryDraftFields')
    expect(source).toContain('clearDirtyLorebookEntryFieldsMatchingProjection')
    expect(source).toContain('mergeLorebookEntryProjectionDraft')
  })

  it('LoreBookData clears matching dirty fields before the value/draft mismatch branch', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/lib/SideBars/LoreBook/LoreBookData.svelte'), 'utf8')
    const valueChangedIndex = source.indexOf('if (valueSnapshot !== previousValueSnapshot)')
    const draftMismatchIndex = source.indexOf('if (valueSnapshot !== draftSnapshot)', valueChangedIndex)
    const clearIndex = source.indexOf('clearDirtyLorebookEntryFieldsMatchingProjection', valueChangedIndex)
    const preMismatchSource = source.slice(valueChangedIndex, draftMismatchIndex)

    expect(valueChangedIndex).toBeGreaterThanOrEqual(0)
    expect(draftMismatchIndex).toBeGreaterThan(valueChangedIndex)
    expect(clearIndex).toBeGreaterThan(valueChangedIndex)
    expect(clearIndex).toBeLessThan(draftMismatchIndex)
    expect(preMismatchSource).toContain('!targetChanged')
  })
})

describe('watchServerBackedLorebooks — no-data-loss invariant', () => {
  it('persists an edit to a HYDRATED character globalLore (the watcher is alive)', async () => {
    setupCharacter([{ key: 'a', content: 'A', id: 'entry-a' }] as Entry[])
    markCharacterLorebookHydrated('c1')
    const stop = watchServerBackedLorebooks({ delayMs: DELAY })
    flushSync() // initialize the snapshot baseline

    recorded.commands.length = 0
    ;(getDatabase().characters[0].globalLore as Entry[]).push({ key: 'b', content: 'B', id: 'entry-b' })
    flushSync() // diff → queue the replacement
    await vi.advanceTimersByTimeAsync(DELAY)

    const cmds = characterEntryCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].a).toMatchObject({ characterId: 'c1', entry: { content: 'B' } })
    stop()
  })

  it('NEVER persists a re-stubbed (no-longer-hydrated) character — the data-loss path', async () => {
    setupCharacter([{ key: 'a', content: 'A', id: 'entry-a' }] as Entry[])
    markCharacterLorebookHydrated('c1')
    const stop = watchServerBackedLorebooks({ delayMs: DELAY })
    flushSync() // baseline = hydrated [A]

    recorded.commands.length = 0
    // A projection re-apply re-stubs every character: reset the registry, then the
    // re-applied stub wipes globalLore to [] (the bootstrap default).
    resetLorebookHydration()
    ;(getDatabase().characters[0] as { globalLore: unknown }).globalLore = []
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
    ;(getDatabase().characters[0] as { globalLore: unknown }).globalLore = [{ key: 'x', content: 'X' }]
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.commands).toHaveLength(0)
    stop()
  })

  it('recordHydratedCharacterLorebooks marks characters whose projected globalLore is present', async () => {
    // Resident (array) → hydrated; stubbed (absent) → not.
    recordHydratedCharacterLorebooks([
      { chaId: 'resident', globalLore: [{ key: 'k', id: 'resident-entry' }] },
      { chaId: 'stub' /* globalLore absent */ },
    ])
    setupCharacter([{ key: 'a', content: 'A', id: 'entry-a' }] as Entry[])
    ;(getDatabase().characters[0] as { chaId: string }).chaId = 'resident'
    const stop = watchServerBackedLorebooks({ delayMs: DELAY })
    flushSync()

    recorded.commands.length = 0
    ;(getDatabase().characters[0].globalLore as Entry[]).push({ key: 'b', content: 'B', id: 'entry-b' })
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    // 'resident' is tracked → its edit persists.
    expect(characterEntryCommands().map((c) => (c.a as { characterId?: string }).characterId)).toEqual(['resident'])
    stop()
  })

  it('M11: foreign character-lorebook resource apply refreshes baseline without echoing, then local edits dispatch', async () => {
    setupCharacter([{ key: 'a', content: 'A', id: 'entry-a' }] as Entry[])
    markCharacterLorebookHydrated('c1')
    const stop = watchServerBackedLorebooks({ delayMs: DELAY })
    flushSync()

    recorded.commands.length = 0
    const applied = applyServerCharacterLorebookResource('c1', [
      { key: 'server', content: 'Server', id: 'server-entry' },
    ])
    expect(applied).toBe(true)
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.commands).toHaveLength(0)

    recorded.commands.length = 0
    ;(getDatabase().characters[0].globalLore as Entry[]).push({
      key: 'local',
      content: 'Local',
      id: 'local-entry',
    })
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    const cmds = characterEntryCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].a).toMatchObject({
      characterId: 'c1',
      entryId: 'local-entry',
      entry: { id: 'local-entry', content: 'Local' },
    })
    stop()
  })

  it('L24: global lorebook rename rollback suppresses watcher echo and keeps later edits live', async () => {
    setupGlobalLorebooks()
    const stop = watchServerBackedLorebooks({ scope: { kind: 'global' }, delayMs: DELAY })
    flushSync()

    getDatabase().loreBook[0].name = 'Conflict'
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

    expect(getDatabase().loreBook[0].name).toBe('Initial')
    expect(recorded.commands.filter((command) => command.kind === 'updateGlobal')).toHaveLength(1)

    getDatabase().loreBook[0].name = 'User Edit After Rollback'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(
      recorded.commands
        .filter((command) => command.kind === 'updateGlobal')
        .map((command) => (command.a as { patch: { name: string } }).patch),
    ).toEqual([{ name: 'Conflict' }, { name: 'User Edit After Rollback' }])
    stop()
  })

  it('L24: stale global rename rollback does not suppress watcher dispatch for a newer rename', async () => {
    setupGlobalLorebooks()
    const stop = watchServerBackedLorebooks({ scope: { kind: 'global' }, delayMs: DELAY })
    flushSync()
    recorded.commands.length = 0

    try {
      getDatabase().loreBook[0].name = 'Attempted Rename'
      flushSync()
      await flushServerCommandRecording()

      const firstUpdates = globalUpdateCommands()
      expect(firstUpdates).toHaveLength(1)
      expect(firstUpdates[0].a).toMatchObject({
        lorebookId: 'g1',
        patch: { name: 'Attempted Rename' },
      })

      getDatabase().loreBook[0].name = 'Newer Rename'
      firstUpdates[0].rollback?.()
      flushSync()
      await flushServerCommandRecording()

      expect(getDatabase().loreBook[0].name).toBe('Newer Rename')
      expect(
        globalUpdateCommands()
          .filter((command) => (command.a as { lorebookId?: string }).lorebookId === 'g1')
          .map((command) => (command.a as { patch: { name: string } }).patch),
      ).toEqual([{ name: 'Attempted Rename' }, { name: 'Newer Rename' }])
    } finally {
      stop()
    }
  })

  it('L24: stale global delete rollback does not suppress watcher dispatch after row and selection diverge', async () => {
    setupGlobalLorebooks(
      [
        { id: 'g1', name: 'Initial', data: [] },
        { id: 'g2', name: 'Second', data: [] },
        { id: 'g3', name: 'Third', data: [] },
      ],
      1,
    )
    const stop = watchServerBackedLorebooks({ scope: { kind: 'global' }, delayMs: DELAY })
    flushSync()
    recorded.commands.length = 0

    try {
      expect(deleteGlobalLorebook(1)).toBe(true)
      await flushServerCommandRecording()

      const deletes = globalDeleteCommands()
      expect(deletes).toHaveLength(1)
      ;(getDatabase().loreBook as unknown as GlobalLorebookFixture[]).splice(1, 0, {
        id: 'g2',
        name: 'Second',
        data: [],
      })
      getDatabase().loreBookPage = 2
      getDatabase().loreBook[0].name = 'Newer Rename'

      deletes[0].rollback?.()
      flushSync()
      await flushServerCommandRecording()

      expect(globalLorebookIds()).toEqual(['g1', 'g2', 'g3'])
      expect(getDatabase().loreBookPage).toBe(2)
      expect(
        globalUpdateCommands()
          .filter((command) => (command.a as { lorebookId?: string }).lorebookId === 'g1')
          .map((command) => (command.a as { patch: { name: string } }).patch),
      ).toEqual([{ name: 'Newer Rename' }])
    } finally {
      stop()
    }
  })

  it('L24: stale global delete rollback keeps watcher live when only selection restores', async () => {
    setupGlobalLorebooks(
      [
        { id: 'g1', name: 'Initial', data: [] },
        { id: 'g2', name: 'Second', data: [] },
        { id: 'g3', name: 'Third', data: [] },
      ],
      1,
    )
    const stop = watchServerBackedLorebooks({ scope: { kind: 'global' }, delayMs: DELAY })
    flushSync()
    recorded.commands.length = 0

    try {
      expect(deleteGlobalLorebook(1)).toBe(true)
      await flushServerCommandRecording()

      const deletes = globalDeleteCommands()
      expect(deletes).toHaveLength(1)
      ;(getDatabase().loreBook as unknown as GlobalLorebookFixture[]).splice(1, 0, {
        id: 'g2',
        name: 'Second',
        data: [],
      })
      expect(getDatabase().loreBookPage).toBe(0)
      getDatabase().loreBook[0].name = 'Newer Rename'

      deletes[0].rollback?.()
      flushSync()
      await flushServerCommandRecording()

      expect(globalLorebookIds()).toEqual(['g1', 'g2', 'g3'])
      expect(getDatabase().loreBookPage).toBe(1)
      expect(getDatabase().loreBook[1].name).toBe('Second')
      expect(
        globalUpdateCommands()
          .filter((command) => (command.a as { lorebookId?: string }).lorebookId === 'g1')
          .map((command) => (command.a as { patch: { name: string } }).patch),
      ).toEqual([{ name: 'Newer Rename' }])
    } finally {
      stop()
    }
  })

  it('L24: global lorebook direct rollback parity routes every dispatcher through suppressed helpers', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/ts/server/lorebookBridge.svelte.ts'), 'utf8')

    expect(exportedFunctionSource(source, 'dispatchCreateGlobalLorebook')).toContain(
      'rollback: () => rollbackGlobalLorebookListEntry(rollbackEntry)',
    )
    expect(exportedFunctionSource(source, 'dispatchDeleteGlobalLorebook')).toContain(
      'rollback: () => rollbackDeletedGlobalLorebook(rollbackEntry, selectionRollback)',
    )
    expect(exportedFunctionSource(source, 'dispatchSelectGlobalLorebook')).toContain(
      'rollback: () => rollbackGlobalLorebookSelection(rollback)',
    )
    expect(exportedFunctionSource(source, 'dispatchUpdateGlobalLorebook')).toContain(
      'rollback: () => rollbackGlobalLorebookName(rollback)',
    )
    expect(exportedFunctionSource(source, 'dispatchReorderGlobalLorebooks')).toContain(
      'rollback: () => rollbackGlobalLorebookOrder(rollback)',
    )

    const globalCreateRollback = localFunctionSource(source, 'rollbackGlobalLorebookListEntry')
    expect(globalCreateRollback).toContain('canApplyGlobalLorebookListRollback(rollbackEntry)')
    expect(globalCreateRollback).toContain('withSuppressedLorebookWatcher')
    expect(globalCreateRollback).toContain('applyAttemptedKeyedListRollback')

    const globalNameRollback = localFunctionSource(source, 'rollbackGlobalLorebookName')
    expect(globalNameRollback).toContain('canApplyGlobalLorebookNameRollback(rollback)')
    expect(globalNameRollback).toContain('withSuppressedLorebookWatcher')
    expect(globalNameRollback).toContain('applyAttemptedFieldRollback')

    const globalOrderRollback = localFunctionSource(source, 'rollbackGlobalLorebookOrder')
    expect(globalOrderRollback).toContain('sameStringArray(liveIds, rollback.attemptedIds)')
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
          getDatabase().loreBook.push(created as never)
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
          getDatabase().loreBook.splice(1, 1)
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
          getDatabase().loreBook.reverse()
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
          getDatabase().loreBookPage = 1
          dispatchSelectGlobalLorebook('g2', previous)
        },
        expectRestored: () => {
          expect(getDatabase().loreBookPage).toBe(0)
        },
      },
      {
        label: 'update',
        commandKind: 'updateGlobal',
        run: () => {
          setupGlobalLorebooks()
          const previous = currentLorebookStateSnapshot()
          getDatabase().loreBook[0].name = 'Conflict'
          dispatchUpdateGlobalLorebook('g1', { name: 'Conflict' }, previous)
        },
        expectRestored: () => {
          expect(getDatabase().loreBook[0].name).toBe('Initial')
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

describe('P1 lorebook snapshot purity', () => {
  it('state snapshots clone malformed lorebook data as-is without assigning ids or stub arrays', () => {
    testDatabaseState.db = {
      loreBook: [{ name: 'Missing ids' }],
      loreBookPage: 0,
      characters: [
        {
          chaId: 'snapshot-char',
          chats: [{ id: 'snapshot-chat' }],
        },
      ],
      modules: [{ id: 'snapshot-module' }],
    }
    selectedCharID.set(0)

    const broad = currentLorebookStateSnapshot()
    const global = currentGlobalLorebookStateSnapshot()

    expect((getDatabase().loreBook[0] as { id?: string }).id).toBeUndefined()
    expect(getDatabase().loreBook[0]).not.toHaveProperty('data')
    expect(getDatabase().characters[0]).not.toHaveProperty('globalLore')
    expect(getDatabase().characters[0].chats[0]).not.toHaveProperty('localLore')
    expect((getDatabase().modules[0] as { lorebook?: unknown }).lorebook).toBeUndefined()

    expect(broad.loreBook[0]).not.toHaveProperty('id')
    expect(broad.loreBook[0]).not.toHaveProperty('data')
    expect(global.loreBook[0]).not.toHaveProperty('id')
    expect(global.loreBook[0]).not.toHaveProperty('data')
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

    const lorebooks = getDatabase().loreBook as unknown as GlobalLorebookFixture[]
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

  it('failed create removes only the unchanged attempted row and preserves newer siblings', async () => {
    setupGlobalLorebooks([{ id: 'g1', name: 'Initial', data: [] }])

    expect(createGlobalLorebook()).toBe(true)
    await flushServerCommandRecording()

    const createdId = (getDatabase().loreBook as unknown as GlobalLorebookFixture[])[1].id
    getDatabase().loreBook[0].name = 'Sibling Edit'
    ;(getDatabase().loreBook as unknown as GlobalLorebookFixture[]).push({
      id: 'g-later',
      name: 'Later Append',
      data: [],
    })
    getDatabase().loreBookPage = 2

    const creates = globalCreateCommands()
    expect(creates).toHaveLength(1)
    creates[0].rollback?.()

    expect(globalLorebookIds()).toEqual(['g1', 'g-later'])
    expect(globalLorebookIds()).not.toContain(createdId)
    expect(getDatabase().loreBook[0].name).toBe('Sibling Edit')
    expect(getDatabase().loreBook[1].name).toBe('Later Append')
    expect(getDatabase().loreBookPage).toBe(1)
  })

  it('selects a global lorebook optimistically before the command response', async () => {
    setupGlobalLorebooks(
      [
        { id: 'g1', name: 'Initial', data: [] },
        { id: 'g2', name: 'Second', data: [] },
      ],
      0,
    )

    expect(selectGlobalLorebook(1)).toBe(true)

    expect(getDatabase().loreBookPage).toBe(1)
    expect(globalSelectCommands()).toHaveLength(0)

    await flushServerCommandRecording()

    const selects = globalSelectCommands()
    expect(selects).toHaveLength(1)
    expect(selects[0].a).toMatchObject({ lorebookId: 'g2' })
    expect(getDatabase().loreBookPage).toBe(1)
  })

  it('rolls back an optimistic global lorebook selection to the previous page', async () => {
    setupGlobalLorebooks(
      [
        { id: 'g1', name: 'Initial', data: [] },
        { id: 'g2', name: 'Second', data: [] },
      ],
      0,
    )

    expect(selectGlobalLorebook(1)).toBe(true)
    expect(getDatabase().loreBookPage).toBe(1)

    await flushServerCommandRecording()

    const selects = globalSelectCommands()
    expect(selects).toHaveLength(1)

    selects[0].rollback?.()
    expect(getDatabase().loreBookPage).toBe(0)
    expect(globalLorebookIds()).toEqual(['g1', 'g2'])
  })

  it('failed select does not revert a newer selected lorebook page', async () => {
    setupGlobalLorebooks(
      [
        { id: 'g1', name: 'Initial', data: [] },
        { id: 'g2', name: 'Second', data: [] },
        { id: 'g3', name: 'Third', data: [] },
      ],
      0,
    )

    expect(selectGlobalLorebook(1)).toBe(true)
    await flushServerCommandRecording()

    getDatabase().loreBookPage = 2
    const selects = globalSelectCommands()
    expect(selects).toHaveLength(1)

    selects[0].rollback?.()
    expect(getDatabase().loreBookPage).toBe(2)
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
    expect(getDatabase().loreBookPage).toBe(0)

    const deletes = globalDeleteCommands()
    expect(deletes).toHaveLength(1)
    expect(deletes[0].a).toMatchObject({ lorebookId: 'g2' })

    deletes[0].rollback?.()
    expect(globalLorebookIds()).toEqual(['g1', 'g2'])
    expect(getDatabase().loreBookPage).toBe(1)
  })

  it('failed delete reinserts only a still-missing row and preserves newer rows', async () => {
    setupGlobalLorebooks(
      [
        { id: 'g1', name: 'Initial', data: [] },
        { id: 'g2', name: 'Second', data: [] },
      ],
      1,
    )

    expect(deleteGlobalLorebook(1)).toBe(true)
    await flushServerCommandRecording()

    getDatabase().loreBook[0].name = 'Sibling Edit'
    ;(getDatabase().loreBook as unknown as GlobalLorebookFixture[]).push({
      id: 'g3',
      name: 'Later Append',
      data: [],
    })

    const deletes = globalDeleteCommands()
    expect(deletes).toHaveLength(1)
    deletes[0].rollback?.()

    expect(globalLorebookIds()).toEqual(['g1', 'g2', 'g3'])
    expect(getDatabase().loreBook[0].name).toBe('Sibling Edit')
    expect(getDatabase().loreBook[1].name).toBe('Second')
    expect(getDatabase().loreBook[2].name).toBe('Later Append')
    expect(getDatabase().loreBookPage).toBe(1)
  })

  it('failed delete does not overwrite a row that already reappeared', async () => {
    setupGlobalLorebooks(
      [
        { id: 'g1', name: 'Initial', data: [] },
        { id: 'g2', name: 'Second', data: [] },
      ],
      1,
    )

    expect(deleteGlobalLorebook(1)).toBe(true)
    await flushServerCommandRecording()
    ;(getDatabase().loreBook as unknown as GlobalLorebookFixture[]).push({
      id: 'g2',
      name: 'Projected Second',
      data: [{ id: 'server-entry', key: 'server' }],
    })

    const deletes = globalDeleteCommands()
    expect(deletes).toHaveLength(1)
    deletes[0].rollback?.()

    expect(globalLorebookIds()).toEqual(['g1', 'g2'])
    expect(getDatabase().loreBook[1].name).toBe('Projected Second')
    expect(getDatabase().loreBook[1].data).toEqual([{ id: 'server-entry', key: 'server' }])
  })

  it('failed delete preserves a newer selected lorebook id when reinserting shifts indexes', async () => {
    setupGlobalLorebooks(
      [
        { id: 'g1', name: 'Initial', data: [] },
        { id: 'g2', name: 'Second', data: [] },
        { id: 'g3', name: 'Third', data: [] },
      ],
      0,
    )

    expect(deleteGlobalLorebook(1)).toBe(true)
    await flushServerCommandRecording()

    getDatabase().loreBookPage = 1
    expect((getDatabase().loreBook as unknown as GlobalLorebookFixture[])[getDatabase().loreBookPage].id).toBe('g3')

    const deletes = globalDeleteCommands()
    expect(deletes).toHaveLength(1)
    deletes[0].rollback?.()

    expect(globalLorebookIds()).toEqual(['g1', 'g2', 'g3'])
    expect(getDatabase().loreBookPage).toBe(2)
    expect((getDatabase().loreBook as unknown as GlobalLorebookFixture[])[getDatabase().loreBookPage].id).toBe('g3')
  })

  it('does not delete the only global lorebook', async () => {
    setupGlobalLorebooks()

    expect(deleteGlobalLorebook(0)).toBe(false)
    await flushServerCommandRecording()

    expect(globalLorebookIds()).toEqual(['g1'])
    expect(getDatabase().loreBookPage).toBe(0)
    expect(globalDeleteCommands()).toHaveLength(0)
  })

  it('renames through the bridge and keeps watcher update rollback suppressed', async () => {
    setupGlobalLorebooks()
    const stop = watchServerBackedLorebooks({ scope: { kind: 'global' }, delayMs: DELAY })
    flushSync()
    recorded.commands.length = 0

    try {
      expect(renameGlobalLorebook(0, 'Renamed')).toBe(true)
      expect(getDatabase().loreBook[0].name).toBe('Renamed')
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

      expect(getDatabase().loreBook[0].name).toBe('Initial')
      expect(globalUpdateCommands()).toHaveLength(1)
    } finally {
      stop()
    }
  })

  it('failed rename skips rollback after a newer same-row edit and preserves siblings', async () => {
    setupGlobalLorebooks([
      { id: 'g1', name: 'Initial', data: [] },
      { id: 'g2', name: 'Second', data: [] },
    ])

    const previous = scopedLorebookStateSnapshot('globalMeta:g1', JSON.stringify({ name: 'Initial' }))
    getDatabase().loreBook[0].name = 'Attempted Rename'
    dispatchUpdateGlobalLorebook('g1', { name: 'Attempted Rename' }, previous)
    await flushServerCommandRecording()

    getDatabase().loreBook[0].name = 'Newer Same Row Edit'
    getDatabase().loreBook[1].name = 'Sibling Edit'

    const updates = globalUpdateCommands()
    expect(updates).toHaveLength(1)
    updates[0].rollback?.()

    expect(getDatabase().loreBook[0].name).toBe('Newer Same Row Edit')
    expect(getDatabase().loreBook[1].name).toBe('Sibling Edit')
  })

  it('failed reorder restores only the attempted order and preserves row content', async () => {
    setupGlobalLorebooks([
      { id: 'g1', name: 'Initial', data: [] },
      { id: 'g2', name: 'Second', data: [] },
      { id: 'g3', name: 'Third', data: [] },
    ])
    const previous = currentLorebookStateSnapshot()
    getDatabase().loreBook = [getDatabase().loreBook[2], getDatabase().loreBook[0], getDatabase().loreBook[1]] as never

    dispatchReorderGlobalLorebooks(previous)
    await flushServerCommandRecording()

    getDatabase().loreBook[2].name = 'Second Edited After Dispatch'
    const reorders = globalReorderCommands()
    expect(reorders).toHaveLength(1)
    reorders[0].rollback?.()

    expect(globalLorebookIds()).toEqual(['g1', 'g2', 'g3'])
    expect(getDatabase().loreBook[1].name).toBe('Second Edited After Dispatch')
  })

  it('failed reorder skips rollback after a newer reorder', async () => {
    setupGlobalLorebooks([
      { id: 'g1', name: 'Initial', data: [] },
      { id: 'g2', name: 'Second', data: [] },
      { id: 'g3', name: 'Third', data: [] },
    ])
    const previous = currentLorebookStateSnapshot()
    getDatabase().loreBook = [getDatabase().loreBook[1], getDatabase().loreBook[0], getDatabase().loreBook[2]] as never

    dispatchReorderGlobalLorebooks(previous)
    await flushServerCommandRecording()

    getDatabase().loreBook = [getDatabase().loreBook[2], getDatabase().loreBook[0], getDatabase().loreBook[1]] as never
    const reorders = globalReorderCommands()
    expect(reorders).toHaveLength(1)
    reorders[0].rollback?.()

    expect(globalLorebookIds()).toEqual(['g3', 'g2', 'g1'])
  })
})

// Scope the watcher's change-detection snapshot to the mounting panel's collection.

function setupMultiCollectionDb(): void {
  testDatabaseState.db = {
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
  testDatabaseState.db = {
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

  testDatabaseState.db = {
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
  const db = getDatabase() as any
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

function moduleReplaceCommands(): Array<Record<string, unknown> & { entries?: unknown[]; rollback?: () => void }> {
  return recorded.commands.filter((c) => c.kind === 'replaceModule')
}

function moduleEntryCommands(): Array<Record<string, unknown> & { a?: unknown; rollback?: () => void }> {
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

  testDatabaseState.db = {
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

  testDatabaseState.db = {
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

function cloneEntries(entries: Entry[]): Entry[] {
  return JSON.parse(JSON.stringify(entries)) as Entry[]
}

describe('K4 lorebook editor entry draft scope', () => {
  it('K4: a single typing draft clones only the edited entry before debounce settle', () => {
    setupK4EditorDb()
    const collectionSize = JSON.stringify(getDatabase().characters[0].globalLore).length

    const firstDraft = {
      ...(getDatabase().characters[0].globalLore as Entry[])[7],
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
      { ...(getDatabase().characters[0].globalLore as Entry[])[5], content: 'intermediate' } as any,
      DELAY,
    )
    applyLorebookEntryDraftEdit(
      { kind: 'character', characterId: 'c-k4' },
      5,
      { ...(getDatabase().characters[0].globalLore as Entry[])[5], content: 'final draft' } as any,
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
      { ...(getDatabase().characters[0].globalLore as Entry[])[3], content: 'blur final' } as any,
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
      { ...(getDatabase().characters[0].globalLore as Entry[])[4], content: 'unload final' } as any,
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
    ;(getDatabase().characters[0].globalLore as Entry[]).push({
      id: 'teardown-entry',
      key: 'teardown',
      content: 'Teardown lore',
    })
    flushSync()
    stop()
    await vi.advanceTimersByTimeAsync(0)

    const cmds = characterEntryCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].keepalive).toBeUndefined()
    expect(cmds[0].a).toMatchObject({
      characterId: 'c-k4',
      entryId: 'teardown-entry',
      entry: { id: 'teardown-entry', content: 'Teardown lore' },
    })

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
        { ...(getDatabase().characters[0].globalLore as Entry[])[3], content: 'blur final' } as any,
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
    const module = (getDatabase().modules as any[])[0] as { lorebook: Entry[] }
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
    expect(source).toContain('replaceModuleLorebookCollectionDraft(moduleId, currentModule, entries)')
    expect(source).not.toContain('withTrustedServerProjectionWrite')
    expect(source).not.toContain('currentLorebookCollectionScopedSnapshot')
    expect(source).not.toContain('dispatchReplaceModuleLorebooks')
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

    expect(setting).toContain("import { getDatabase } from 'src/ts/storage/database.svelte'")
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
    expect(getDatabase().characters[0].chats[0].localLore).toEqual([
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
    expect(getDatabase().characters[0].chats[0].localLore).toEqual([])
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

    getDatabase().characters[0].chats[0].localLore.push({
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
    getDatabase().characters[0].chats[0].localLore = [
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
    expect(getDatabase().characters[0].chats[0].localLore).toEqual([])

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
    expect(getDatabase().characters[0].chats[0].localLore).toEqual([])

    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.commands).toHaveLength(0)
  })

  it('K4: failed entry-draft rollback restores only the edited entry', () => {
    setupK4EditorDb()
    const previous = currentLorebookEntryScopedSnapshot({ kind: 'character', characterId: 'c-k4' }, 2)

    ;(getDatabase().characters[0].globalLore as Entry[])[2].content = 'failed optimistic edit'
    ;(getDatabase().characters[0].globalLore as Entry[])[4].content = 'same collection sibling edit'
    ;(getDatabase().characters[1].globalLore as Entry[])[0].content = 'other character edit'

    restoreLorebookEntryState(previous)

    expect((getDatabase().characters[0].globalLore as Entry[])[2].content).toContain('-2')
    expect((getDatabase().characters[0].globalLore as Entry[])[4].content).toBe('same collection sibling edit')
    expect((getDatabase().characters[1].globalLore as Entry[])[0].content).toBe('other character edit')
  })

  it('L27: coalesced entry-draft rollback restores the first pre-edit collection', async () => {
    setupK4EditorDb()
    const scope = { kind: 'character', characterId: 'c-k4' } as const
    const originalContents = (getDatabase().characters[0].globalLore as Entry[]).map((entry) => entry.content)

    applyLorebookEntryDraftEdit(
      scope,
      2,
      {
        ...(getDatabase().characters[0].globalLore as Entry[])[2],
        content: 'draft first entry',
      } as any,
      DELAY,
    )
    applyLorebookEntryDraftEdit(
      scope,
      4,
      {
        ...(getDatabase().characters[0].globalLore as Entry[])[4],
        content: 'draft second entry',
      } as any,
      DELAY,
    )

    expect((getDatabase().characters[0].globalLore as Entry[])[2].content).toBe('draft first entry')
    expect((getDatabase().characters[0].globalLore as Entry[])[4].content).toBe('draft second entry')

    await vi.advanceTimersByTimeAsync(DELAY)

    const cmds = characterReplaceCommands()
    expect(cmds).toHaveLength(1)
    expect((cmds[0].entries as Entry[])[2].content).toBe('draft first entry')
    expect((cmds[0].entries as Entry[])[4].content).toBe('draft second entry')

    cmds[0].rollback?.()

    expect((getDatabase().characters[0].globalLore as Entry[]).map((entry) => entry.content)).toEqual(originalContents)
  })

  it('K4: collection operations still use collection-level replacement rollback', async () => {
    setupK4EditorDb()
    const previous = currentLorebookCollectionScopedSnapshot({
      kind: 'character',
      characterId: 'c-k4',
    })
    const originalIds = (getDatabase().characters[0].globalLore as Entry[]).map((entry) => entry.id)
    const reordered = [...(getDatabase().characters[0].globalLore as Entry[])]
    const moved = reordered.shift()
    if (moved) {
      moved.folder = 'folder-k4'
      reordered.push(moved)
    }

    getDatabase().characters[0].globalLore = reordered as any
    dispatchReplaceCharacterLorebooks('c-k4', reordered as any, previous, DELAY)
    await vi.advanceTimersByTimeAsync(DELAY)

    const cmds = characterReplaceCommands()
    expect(cmds).toHaveLength(1)
    expect((cmds[0].entries as Entry[]).map((entry) => entry.id)).toEqual([...originalIds.slice(1), originalIds[0]])
    ;(getDatabase().characters[0].globalLore as Entry[])[1].content = 'collection failed edit'
    restoreLorebookState(previous)
    expect((getDatabase().characters[0].globalLore as Entry[]).map((entry) => entry.id)).toEqual(originalIds)
  })

  it('Batch 4: collection replacement helper owns the optimistic write, clone, dispatch, and rollback', async () => {
    setupK4EditorDb()
    const originalIds = (getDatabase().characters[0].globalLore as Entry[]).map((entry) => entry.id)
    const nextEntries = [
      ...(getDatabase().characters[0].globalLore as Entry[]),
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
    expect(getDatabase().characters[0].globalLore).not.toBe(nextEntries)
    expect((getDatabase().characters[0].globalLore as Entry[]).at(-1)?.content).toBe('Helper lore')

    nextEntries[nextEntries.length - 1].content = 'caller mutation after replace'
    expect((getDatabase().characters[0].globalLore as Entry[]).at(-1)?.content).toBe('Helper lore')

    await vi.advanceTimersByTimeAsync(DELAY)

    const cmds = characterEntryCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].a).toMatchObject({
      characterId: 'c-k4',
      entryId: 'helper-entry',
      entry: { id: 'helper-entry', content: 'Helper lore' },
    })

    cmds[0].rollback?.()
    expect((getDatabase().characters[0].globalLore as Entry[]).map((entry) => entry.id)).toEqual(originalIds)
  })

  it('Batch 6: module collection draft helper owns live/draft optimistic write, dispatch, and rollback', async () => {
    setupK4ModuleDb()
    const liveModule = getDatabase().modules[0] as unknown as { id: string; lorebook: Entry[] }
    const draftModule = {
      id: liveModule.id,
      name: 'Draft Module',
      description: '',
      lorebook: cloneEntries(liveModule.lorebook),
    }
    const originalLive = cloneEntries(liveModule.lorebook)
    const nextEntries = cloneEntries(liveModule.lorebook)
    nextEntries[0].content = 'module helper first'
    nextEntries[1].content = 'module helper second'

    const replaced = replaceModuleLorebookCollectionDraft(liveModule.id, draftModule as any, nextEntries as any, DELAY)

    expect(replaced).toBe(true)
    expect(liveModule.lorebook).not.toBe(nextEntries)
    expect(draftModule.lorebook).not.toBe(nextEntries)
    expect(draftModule.lorebook).toEqual(liveModule.lorebook)
    expect(liveModule.lorebook[0].content).toBe('module helper first')
    expect(draftModule.lorebook[1].content).toBe('module helper second')

    await vi.advanceTimersByTimeAsync(DELAY)

    const cmds = moduleReplaceCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].moduleId).toBe(liveModule.id)
    expect((cmds[0].entries as Entry[]).slice(0, 2)).toEqual([
      expect.objectContaining({ id: 'module-entry-0', content: 'module helper first' }),
      expect.objectContaining({ id: 'module-entry-1', content: 'module helper second' }),
    ])

    cmds[0].rollback?.()
    expect(liveModule.lorebook).toEqual(originalLive)
  })

  it('Batch 6: module collection draft helper returns false for missing module id without mutation or command', async () => {
    setupK4ModuleDb()
    const liveModule = getDatabase().modules[0] as unknown as { lorebook: Entry[] }
    const originalLive = cloneEntries(liveModule.lorebook)
    const draftModule = {
      id: '',
      name: 'Draft Module',
      description: '',
      lorebook: [{ id: 'draft-entry', content: 'draft original' }] as Entry[],
    }
    const originalDraft = cloneEntries(draftModule.lorebook)

    const replaced = replaceModuleLorebookCollectionDraft(
      '',
      draftModule as any,
      [{ content: 'replacement' }] as any,
      DELAY,
    )

    expect(replaced).toBe(false)
    expect(liveModule.lorebook).toEqual(originalLive)
    expect(draftModule.lorebook).toEqual(originalDraft)

    await vi.advanceTimersByTimeAsync(DELAY)
    expect(moduleReplaceCommands()).toHaveLength(0)
    expect(moduleEntryCommands()).toHaveLength(0)
  })

  it('Batch 6: module collection draft helper normalizes create-mode drafts without dispatching before create', async () => {
    setupK4ModuleDb()
    const draftModule = {
      id: 'module-new',
      name: 'Draft Module',
      description: '',
      lorebook: [{ content: 'draft original' }] as Entry[],
    }

    const replaced = replaceModuleLorebookCollectionDraft(
      draftModule.id,
      draftModule as any,
      [{ content: 'replacement' }] as any,
      DELAY,
    )

    expect(replaced).toBe(true)
    expect(draftModule.lorebook).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        content: 'replacement',
      }),
    ])

    await vi.advanceTimersByTimeAsync(DELAY)
    expect(moduleReplaceCommands()).toHaveLength(0)
    expect(moduleEntryCommands()).toHaveLength(0)
  })

  it('Batch 6: module collection draft helper freezes the delayed command payload', async () => {
    setupK4ModuleDb()
    const liveModule = getDatabase().modules[0] as unknown as { id: string; lorebook: Entry[] }
    const draftModule = {
      id: liveModule.id,
      name: 'Draft Module',
      description: '',
      lorebook: cloneEntries(liveModule.lorebook),
    }
    const nextEntries = cloneEntries(liveModule.lorebook)
    nextEntries[0].content = 'queued first'
    nextEntries[1].content = 'queued second'

    const replaced = replaceModuleLorebookCollectionDraft(liveModule.id, draftModule as any, nextEntries as any, DELAY)

    expect(replaced).toBe(true)
    liveModule.lorebook[0].content = 'late live mutation'
    draftModule.lorebook[1].content = 'late draft mutation'
    liveModule.lorebook.push({
      id: 'late-entry',
      key: 'late',
      content: 'late push',
    })

    await vi.advanceTimersByTimeAsync(DELAY)

    const cmds = moduleReplaceCommands()
    expect(cmds).toHaveLength(1)
    expect((cmds[0].entries as Entry[]).map((entry) => entry.content).slice(0, 2)).toEqual([
      'queued first',
      'queued second',
    ])
    expect((cmds[0].entries as Entry[]).some((entry) => entry.id === 'late-entry')).toBe(false)
  })

  it('K4: simple collection delete and pure reorder use compact entry commands', async () => {
    setupK4EditorDb()
    const entries = getDatabase().characters[0].globalLore as Entry[]

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

  it('Phase 5: stale failed creates remove only unchanged attempted entries across scoped collections', async () => {
    const cases: Array<{
      label: string
      setup: () => {
        entries: Entry[]
        attemptedId: string
        command: () => { rollback?: () => void } | undefined
      }
    }> = [
      {
        label: 'character',
        setup: () => {
          setupMultiCollectionDb()
          const entries = getDatabase().characters[0].globalLore as Entry[]
          const attemptedId = 'character-created-entry'
          const previous = currentLorebookCollectionScopedSnapshot({ kind: 'character', characterId: 'c0' })
          entries.push({ id: attemptedId, key: 'created', content: 'attempted character create' })
          dispatchReplaceCharacterLorebooks('c0', entries as any, previous, DELAY)
          return { entries, attemptedId, command: () => characterEntryCommands()[0] }
        },
      },
      {
        label: 'chat',
        setup: () => {
          setupMultiCollectionDb()
          const entries = getDatabase().characters[0].chats[0].localLore as Entry[]
          const attemptedId = 'chat-created-entry'
          const previous = currentLorebookCollectionScopedSnapshot({ kind: 'chat', chatId: 'c0chat' })
          entries.push({ id: attemptedId, key: 'created', content: 'attempted chat create' })
          dispatchReplaceChatLorebooks('c0chat', entries as any, previous, DELAY)
          return { entries, attemptedId, command: () => chatEntryCommands()[0] }
        },
      },
      {
        label: 'global',
        setup: () => {
          setupMultiCollectionDb()
          const entries = getDatabase().loreBook[0].data as Entry[]
          const attemptedId = 'global-created-entry'
          const previous = currentLorebookCollectionScopedSnapshot({ kind: 'global', lorebookId: 'g1' })
          entries.push({ id: attemptedId, key: 'created', content: 'attempted global create' })
          dispatchReplaceGlobalLorebookEntries('g1', entries as any, previous, DELAY)
          return { entries, attemptedId, command: () => globalEntryCommands()[0] }
        },
      },
      {
        label: 'module',
        setup: () => {
          setupMultiCollectionDb()
          const module = getDatabase().modules[0] as unknown as { lorebook: Entry[] }
          const entries = module.lorebook
          const attemptedId = 'module-created-entry'
          const previous = currentLorebookCollectionScopedSnapshot({ kind: 'module', moduleId: 'm0' })
          entries.push({ id: attemptedId, key: 'created', content: 'attempted module create' })
          dispatchReplaceModuleLorebooks('m0', entries as any, previous, DELAY)
          return { entries, attemptedId, command: () => moduleEntryCommands()[0] }
        },
      },
    ]

    for (const scenario of cases) {
      recorded.commands.length = 0
      const { entries, attemptedId, command } = scenario.setup()

      await vi.advanceTimersByTimeAsync(DELAY)
      const queued = command()
      expect(queued?.rollback).toEqual(expect.any(Function))

      entries[0].content = `${scenario.label} newer sibling edit`
      entries.push({
        id: `${scenario.label}-later-entry`,
        key: 'later',
        content: `${scenario.label} later append`,
      })

      queued?.rollback?.()

      expect(entries.map((entry) => entry.id)).not.toContain(attemptedId)
      expect(entries.map((entry) => entry.id)).toContain(`${scenario.label}-later-entry`)
      expect(entries[0].content).toBe(`${scenario.label} newer sibling edit`)
    }
  })

  it('Phase 5: stale failed updates restore only attempted rows and skip newer same-row edits', async () => {
    setupK4EditorDb()
    const scope = { kind: 'character', characterId: 'c-k4' } as const
    const originalEntry2Content = (getDatabase().characters[0].globalLore as Entry[])[2].content

    const previous = currentLorebookCollectionScopedSnapshot(scope)
    const attempted = cloneEntries(getDatabase().characters[0].globalLore as Entry[])
    attempted[2].content = 'attempted update'
    getDatabase().characters[0].globalLore = attempted as any
    dispatchReplaceCharacterLorebooks('c-k4', attempted as any, previous, DELAY)
    await vi.advanceTimersByTimeAsync(DELAY)

    let cmds = characterEntryCommands()
    expect(cmds).toHaveLength(1)
    ;(getDatabase().characters[0].globalLore as Entry[])[4].content = 'newer sibling edit'
    cmds[0].rollback?.()

    expect((getDatabase().characters[0].globalLore as Entry[])[2].content).toBe(originalEntry2Content)
    expect((getDatabase().characters[0].globalLore as Entry[])[4].content).toBe('newer sibling edit')

    recorded.commands.length = 0
    const secondPrevious = currentLorebookCollectionScopedSnapshot(scope)
    const secondAttempted = cloneEntries(getDatabase().characters[0].globalLore as Entry[])
    secondAttempted[3].content = 'attempted second update'
    getDatabase().characters[0].globalLore = secondAttempted as any
    dispatchReplaceCharacterLorebooks('c-k4', secondAttempted as any, secondPrevious, DELAY)
    await vi.advanceTimersByTimeAsync(DELAY)

    cmds = characterEntryCommands()
    expect(cmds).toHaveLength(1)
    ;(getDatabase().characters[0].globalLore as Entry[])[3].content = 'newer same-row edit'
    ;(getDatabase().characters[0].globalLore as Entry[])[5].content = 'newer sibling after second'
    cmds[0].rollback?.()

    expect((getDatabase().characters[0].globalLore as Entry[])[3].content).toBe('newer same-row edit')
    expect((getDatabase().characters[0].globalLore as Entry[])[5].content).toBe('newer sibling after second')
  })

  it('Phase 5: stale failed deletes reinsert only still-missing entries and preserve newer entries', async () => {
    setupK4EditorDb()
    const entries = getDatabase().characters[0].globalLore as Entry[]
    const previous = currentLorebookCollectionScopedSnapshot({ kind: 'character', characterId: 'c-k4' })
    const deleted = cloneEntries([entries[3]])[0]

    entries.splice(3, 1)
    dispatchReplaceCharacterLorebooks('c-k4', entries as any, previous, DELAY)
    await vi.advanceTimersByTimeAsync(DELAY)

    const deletes = characterEntryDeleteCommands()
    expect(deletes).toHaveLength(1)
    entries[0].content = 'newer edit before delete rollback'
    entries.push({ id: 'post-delete-entry', key: 'post-delete', content: 'post delete append' })

    deletes[0].rollback?.()

    expect(entries[3]).toMatchObject(deleted)
    expect(entries[0].content).toBe('newer edit before delete rollback')
    expect(entries.at(-1)?.id).toBe('post-delete-entry')
  })

  it('Phase 5: stale failed reorders restore prior order only while live order matches the attempt', async () => {
    setupK4EditorDb()
    const entries = getDatabase().characters[0].globalLore as Entry[]
    const originalIds = entries.map((entry) => entry.id)
    const previous = currentLorebookCollectionScopedSnapshot({ kind: 'character', characterId: 'c-k4' })
    const moved = entries.shift()
    if (moved) entries.push(moved)
    const attemptedIds = entries.map((entry) => entry.id)

    dispatchReplaceCharacterLorebooks('c-k4', entries as any, previous, DELAY)
    await vi.advanceTimersByTimeAsync(DELAY)

    let reorders = characterEntryReorderCommands()
    expect(reorders).toHaveLength(1)
    entries[2].content = 'content changed while order is attempted'
    const changedEntryId = entries[2].id
    reorders[0].rollback?.()

    expect(entries.map((entry) => entry.id)).toEqual(originalIds)
    expect(entries.find((entry) => entry.id === changedEntryId)?.content).toBe(
      'content changed while order is attempted',
    )

    recorded.commands.length = 0
    const secondPrevious = currentLorebookCollectionScopedSnapshot({ kind: 'character', characterId: 'c-k4' })
    const movedAgain = entries.pop()
    if (movedAgain) entries.unshift(movedAgain)
    dispatchReplaceCharacterLorebooks('c-k4', entries as any, secondPrevious, DELAY)
    await vi.advanceTimersByTimeAsync(DELAY)

    reorders = characterEntryReorderCommands()
    expect(reorders).toHaveLength(1)
    entries.reverse()
    const newerOrder = entries.map((entry) => entry.id)
    expect(newerOrder).not.toEqual(attemptedIds)

    reorders[0].rollback?.()

    expect(entries.map((entry) => entry.id)).toEqual(newerOrder)
  })

  it('Phase 5: module lorebook helper rollback preserves newer sibling edits and appended entries', async () => {
    setupK4ModuleDb()
    const liveModule = getDatabase().modules[0] as unknown as { id: string; lorebook: Entry[] }
    const draftModule = {
      id: liveModule.id,
      name: 'Draft Module',
      description: '',
      lorebook: cloneEntries(liveModule.lorebook),
    }
    const originalFirstContent = liveModule.lorebook[0].content
    const nextEntries = cloneEntries(liveModule.lorebook)
    nextEntries[0].content = 'attempted module helper update'

    const replaced = replaceModuleLorebookCollectionDraft(liveModule.id, draftModule as any, nextEntries as any, DELAY)
    expect(replaced).toBe(true)
    await vi.advanceTimersByTimeAsync(DELAY)

    const cmds = moduleEntryCommands()
    expect(cmds).toHaveLength(1)
    liveModule.lorebook[1].content = 'newer module sibling edit'
    liveModule.lorebook.push({ id: 'module-later-entry', key: 'later', content: 'module later append' })

    cmds[0].rollback?.()

    expect(liveModule.lorebook[0].content).toBe(originalFirstContent)
    expect(liveModule.lorebook[1].content).toBe('newer module sibling edit')
    expect(liveModule.lorebook.map((entry) => entry.id)).toContain('module-later-entry')
  })

  it('Phase 5: full-replace fallback skips rollback after live collection diverges from the attempt', async () => {
    setupK4EditorDb()
    const scope = { kind: 'character', characterId: 'c-k4' } as const
    const previous = currentLorebookCollectionScopedSnapshot(scope)
    const attempted = cloneEntries(getDatabase().characters[0].globalLore as Entry[])
    attempted[0].content = 'attempted complex update'
    attempted[1] = {
      id: 'complex-replacement-entry',
      key: 'complex',
      content: 'attempted complex replacement',
    }

    getDatabase().characters[0].globalLore = attempted as any
    dispatchReplaceCharacterLorebooks('c-k4', attempted as any, previous, DELAY)
    await vi.advanceTimersByTimeAsync(DELAY)

    const replaces = characterReplaceCommands()
    expect(replaces).toHaveLength(1)
    ;(getDatabase().characters[0].globalLore as Entry[])[0].content = 'newer divergence'
    ;(getDatabase().characters[0].globalLore as Entry[]).push({
      id: 'complex-later-entry',
      key: 'later',
      content: 'newer append',
    })

    replaces[0].rollback?.()

    expect((getDatabase().characters[0].globalLore as Entry[])[0].content).toBe('newer divergence')
    expect((getDatabase().characters[0].globalLore as Entry[])[1].id).toBe('complex-replacement-entry')
    expect((getDatabase().characters[0].globalLore as Entry[]).map((entry) => entry.id)).toContain(
      'complex-later-entry',
    )
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

    const closedChat = getDatabase().characters[0].chats[1]
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

    const chats = getDatabase().characters[0].chats
    const [removedChat] = chats.splice(1, 1)
    collectLorebookCollectionSnapshots({ kind: 'character' })
    chats.push(removedChat)

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

    expect((getDatabase().characters[0].globalLore as Entry[])[0].id).toBeUndefined()
    expect((getDatabase().characters[0].chats[0].localLore as Entry[])[0].id).toBeUndefined()
    expect((getDatabase().characters[1].globalLore as Entry[])[0].id).toBeUndefined()
    expect((getDatabase().characters[1].chats[0].localLore as Entry[])[0].id).toBeUndefined()
    expect(((getDatabase().modules as any[])[0].lorebook as Entry[])[0].id).toBeUndefined()
    expect(((getDatabase().modules as any[])[1].lorebook as Entry[])[0].id).toBeUndefined()
    expect(((getDatabase().loreBook as any[])[0] as { id?: string }).id).toBeUndefined()
    expect(((getDatabase().loreBook as any[])[0].data as Entry[])[0].id).toBeUndefined()

    selectedCharID.set(1)
    flushSync()

    expect((getDatabase().characters[1].globalLore as Entry[])[0].id).toBeUndefined()
    expect((getDatabase().characters[1].chats[0].localLore as Entry[])[0].id).toBeUndefined()
    expect(((getDatabase().modules as any[])[0].lorebook as Entry[])[0].id).toBeUndefined()
    expect(((getDatabase().loreBook as any[])[0] as { id?: string }).id).toBeUndefined()
    stop()
  })

  it('P1: a global-scoped watcher first run does not assign global lorebook or entry ids', () => {
    setupMultiCollectionDb()
    stripIdsForScopedEnsureRegression()
    markCharacterLorebookHydrated('c0')
    markCharacterLorebookHydrated('c1')

    const stop = watchServerBackedLorebooks({ scope: { kind: 'global' }, delayMs: DELAY })
    flushSync()

    expect(((getDatabase().loreBook as any[])[0] as { id?: string }).id).toBeUndefined()
    expect(((getDatabase().loreBook as any[])[0].data as Entry[])[0].id).toBeUndefined()
    expect((getDatabase().characters[0].globalLore as Entry[])[0].id).toBeUndefined()
    expect((getDatabase().characters[0].chats[0].localLore as Entry[])[0].id).toBeUndefined()
    expect(((getDatabase().modules as any[])[0].lorebook as Entry[])[0].id).toBeUndefined()
    stop()
  })

  it('P1: watcher skips malformed selected-character lore without dispatch or id mutation', async () => {
    setupMultiCollectionDb()
    stripIdsForScopedEnsureRegression()
    markCharacterLorebookHydrated('c0')
    selectedCharID.set(0)
    const stop = watchServerBackedLorebooks({ scope: { kind: 'character' }, delayMs: DELAY })
    flushSync()

    recorded.commands.length = 0
    ;(getDatabase().characters[0].globalLore as Entry[])[0].content = 'Changed without stable id'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.commands).toHaveLength(0)
    expect((getDatabase().characters[0].globalLore as Entry[])[0].id).toBeUndefined()
    expect((getDatabase().characters[0].chats[0].localLore as Entry[])[0].id).toBeUndefined()
    stop()
  })

  it('P1: watcher skips selected-character lore with duplicate entry ids', async () => {
    setupMultiCollectionDb()
    markCharacterLorebookHydrated('c0')
    selectedCharID.set(0)
    const stop = watchServerBackedLorebooks({ scope: { kind: 'character' }, delayMs: DELAY })
    flushSync()

    recorded.commands.length = 0
    ;(getDatabase().characters[0].globalLore as Entry[]).push({
      key: 'duplicate',
      content: 'Duplicate id',
      id: 'c0g1',
    })
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.commands).toHaveLength(0)
    expect((getDatabase().characters[0].globalLore as Entry[]).map((entry) => entry.id)).toEqual(['c0g1', 'c0g1'])
    stop()
  })

  it('P1: watcher revalidates ids at debounce flush before sending replacements', async () => {
    setupMultiCollectionDb()
    markCharacterLorebookHydrated('c0')
    selectedCharID.set(0)
    const stop = watchServerBackedLorebooks({ scope: { kind: 'character' }, delayMs: DELAY })
    flushSync()

    recorded.commands.length = 0
    const entry = (getDatabase().characters[0].globalLore as Entry[])[0]
    entry.content = 'Queued while id is stable'
    flushSync()

    delete entry.id
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.commands).toHaveLength(0)
    expect(entry.id).toBeUndefined()
    stop()
  })

  it('P1: the global lorebook modal mount does not normalize ids', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/lib/Setting/lorepreset.svelte'), 'utf8')
    const mountEffect = source.slice(source.indexOf('$effect'), source.indexOf('</script>'))

    expect(mountEffect).not.toContain('ensureGlobalLorebookListIds')
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
    getDatabase().characters[1].chats[0].localLore = [
      ...(getDatabase().characters[1].chats[0].localLore as Entry[]),
      { key: 'x', content: 'X' },
    ] as never
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(chatReplaceChatIds()).not.toContain('c1chat')

    // The selected character's own chat edit IS dispatched.
    recorded.commands.length = 0
    getDatabase().characters[0].chats[0].localLore = [
      ...(getDatabase().characters[0].chats[0].localLore as Entry[]),
      { key: 'y', content: 'Y', id: 'c0l2' },
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
    const closedChat = getDatabase().characters[0].chats[1]
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

    const closedChat = getDatabase().characters[0].chats[1]
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
    ;(getDatabase().characters[1].globalLore as Entry[]).push({ key: 'b', content: 'B', id: 'c1g2' })
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(characterEntryCommands().map((c) => (c.a as { characterId?: string }).characterId)).toEqual(['c1'])

    // ...while an edit to the no-longer-selected c0 is ignored.
    recorded.commands.length = 0
    ;(getDatabase().characters[0].globalLore as Entry[]).push({ key: 'z', content: 'Z', id: 'c0g2' })
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(characterReplaceCommands()).toHaveLength(0)
    stop()
  })
})
