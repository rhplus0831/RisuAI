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

const recorded = vi.hoisted(() => ({ commands: [] as Array<Record<string, unknown>> }))
const projectionGuardState = vi.hoisted(() => ({ epoch: 0 }))
vi.mock('./commands', () => ({
  canUseServerCommands: () => true,
  runServerCommand: vi.fn(
    async (args: { command: (rev: number) => Promise<unknown>; keepalive?: boolean }) => {
      const { command } = args
      const built = await command(1)
      recorded.commands.push({
        ...(built as Record<string, unknown>),
        ...(args.keepalive ? { keepalive: args.keepalive } : {}),
      })
      return { status: 'ok', revision: 1 }
    },
  ),
  // Builders: identity stubs that tag the command kind so the test can assert which
  // entity (if any) the watcher tried to persist.
  createGlobalLorebookCommand: async (a: unknown) => ({ kind: 'createGlobal', a }),
  deleteGlobalLorebookCommand: async (a: unknown) => ({ kind: 'deleteGlobal', a }),
  reorderGlobalLorebooksCommand: async (a: unknown) => ({ kind: 'reorderGlobal', a }),
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
  currentLorebookCollectionScopedSnapshot,
  currentLorebookEntryScopedSnapshot,
  dispatchReplaceCharacterLorebooks,
  flushPendingLorebookEntryDraftEdit,
  flushPendingServerBackedLorebookPatches,
  markCharacterLorebookHydrated,
  recordHydratedCharacterLorebooks,
  resetLorebookHydration,
  restoreLorebookEntryState,
  restoreLorebookState,
  watchServerBackedLorebooks,
} from './lorebookBridge.svelte'
import { withCloneInstrumentation } from '../__tests__/cloneCostHarness'

type Entry = { key?: string; content?: string; id?: string; folder?: string }

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

function characterReplaceCommands(): Array<Record<string, unknown>> {
  return recorded.commands.filter((c) => c.kind === 'replaceCharacter')
}

beforeEach(() => {
  vi.useFakeTimers()
  projectionGuardState.epoch = 0
  resetLorebookHydration()
  recorded.commands.length = 0
})

afterEach(() => {
  vi.useRealTimers()
  selectedCharID.set(-1)
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

    const cmds = characterReplaceCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].characterId).toBe('c1')
    expect((cmds[0].entries as Entry[]).map((e) => e.content)).toEqual(['A', 'B'])
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

    expect(characterReplaceCommands()).toHaveLength(0)
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

    expect(characterReplaceCommands()).toHaveLength(0)
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
    expect(characterReplaceCommands().map((c) => c.characterId)).toEqual(['resident'])
    stop()
  })

  it('M11: foreign character-lorebook projection apply refreshes baseline without echoing, then local edits dispatch', async () => {
    setupCharacter([{ key: 'a', content: 'A' }] as Entry[])
    markCharacterLorebookHydrated('c1')
    const stop = watchServerBackedLorebooks({ delayMs: DELAY })
    flushSync()

    recorded.commands.length = 0
    const applied = applyServerCharacterLorebookProjection('c1', [
      { key: 'server', content: 'Server' },
    ])
    expect(applied).toBe(true)
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(characterReplaceCommands()).toHaveLength(0)

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
})

// Phase 6: scope the watcher's change-detection snapshot to the mounting panel's
// collection. A keystroke must no longer rebuild a DB-wide lore stringify map.

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
  return recorded.commands
    .filter((c) => c.kind === 'replaceChat')
    .map((c) => (c.a as { chatId?: string }).chatId ?? '')
}

function moduleReplaceCommands(): Array<Record<string, unknown>> {
  return recorded.commands.filter((c) => c.kind === 'replaceModule')
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
  it('K4: typing drafts clone only the edited entry before debounce settle', () => {
    setupK4EditorDb()
    const collectionSize = JSON.stringify(DBState.db.characters[0].globalLore).length

    const firstDraft = {
      ...(DBState.db.characters[0].globalLore as Entry[])[7],
      content: 'draft one',
    } as Entry
    const secondDraft = { ...firstDraft, content: 'draft two' } as Entry

    const first = withCloneInstrumentation(() =>
      applyLorebookEntryDraftEdit(
        { kind: 'character', characterId: 'c-k4' },
        7,
        firstDraft as any,
        DELAY,
      ),
    )
    const second = withCloneInstrumentation(() =>
      applyLorebookEntryDraftEdit(
        { kind: 'character', characterId: 'c-k4' },
        7,
        secondDraft as any,
        DELAY,
      ),
    )

    expect(first.result).toBe(true)
    expect(second.result).toBe(true)
    expect(first.maxClonedSize).toBeLessThan(collectionSize)
    expect(second.maxClonedSize).toBeLessThan(collectionSize)
    expect(recorded.commands).toHaveLength(0)
  })

  it('K4: the debounced final server write contains the final edited entry', async () => {
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

    expect(characterReplaceCommands()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(DELAY)

    const cmds = characterReplaceCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].characterId).toBe('c-k4')
    const entries = cmds[0].entries as Entry[]
    expect(entries).toHaveLength(24)
    expect(entries[5]).toMatchObject({ id: 'entry-5', content: 'final draft' })
    expect(entries[4]).toMatchObject({ id: 'entry-4', content: expect.stringContaining('-4') })
  })

  it('K4: flushing a draft sends the final replacement before the debounce delay', async () => {
    setupK4EditorDb()

    applyLorebookEntryDraftEdit(
      { kind: 'character', characterId: 'c-k4' },
      3,
      { ...(DBState.db.characters[0].globalLore as Entry[])[3], content: 'blur final' } as any,
      DELAY * 10,
    )
    flushPendingLorebookEntryDraftEdit({ kind: 'character', characterId: 'c-k4' })
    await vi.advanceTimersByTimeAsync(0)

    const cmds = characterReplaceCommands()
    expect(cmds).toHaveLength(1)
    expect((cmds[0].entries as Entry[])[3].content).toBe('blur final')

    await vi.advanceTimersByTimeAsync(DELAY * 10)
    expect(characterReplaceCommands()).toHaveLength(1)
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

    const cmds = characterReplaceCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].keepalive).toBe(true)
    expect((cmds[0].entries as Entry[])[4].content).toBe('unload final')

    await vi.advanceTimersByTimeAsync(DELAY * 10)
    expect(characterReplaceCommands()).toHaveLength(1)
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

    const cmds = characterReplaceCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].keepalive).toBeUndefined()
    expect((cmds[0].entries as Entry[]).map((entry) => entry.content).at(-1)).toBe(
      'Teardown lore',
    )

    await vi.advanceTimersByTimeAsync(DELAY * 10)
    expect(characterReplaceCommands()).toHaveLength(1)
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

      const cmds = characterReplaceCommands()
      expect(cmds).toHaveLength(1)
      expect((cmds[0].entries as Entry[])[3].content).toBe('blur final')

      await vi.advanceTimersByTimeAsync(DELAY)
      expect(characterReplaceCommands()).toHaveLength(1)
    } finally {
      stop()
    }
  })

  it('K4: module external entry drafts avoid collection clones and flush final module replacement', async () => {
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
    expect(moduleReplaceCommands()).toHaveLength(0)

    flushPendingLorebookEntryDraftEdit({ kind: 'module', moduleId: 'module-k4' })
    await vi.advanceTimersByTimeAsync(0)

    const cmds = moduleReplaceCommands()
    expect(cmds).toHaveLength(1)
    expect(cmds[0].moduleId).toBe('module-k4')
    expect((cmds[0].entries as Entry[])[9]).toMatchObject({
      id: 'module-entry-9',
      content: 'module draft final',
    })

    await vi.advanceTimersByTimeAsync(DELAY * 10)
    expect(moduleReplaceCommands()).toHaveLength(1)
  })

  it('K4: ModuleMenu wires external LoreBookList typing through module draft handlers', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/lib/Setting/Pages/Module/ModuleMenu.svelte'),
      'utf8',
    )
    const lorebookList = source.slice(
      source.indexOf('<LoreBookList'),
      source.indexOf('<div class="text-textcolor2 mt-2 flex">'),
    )

    expect(source).toContain(
      "applyLorebookEntryDraftEdit({ kind: 'module', moduleId }, index, value)",
    )
    expect(source).toContain("flushPendingLorebookEntryDraftEdit({ kind: 'module', moduleId })")
    expect(lorebookList).toContain('onEntryChange={updateModuleLorebookValue}')
    expect(lorebookList).toContain('onEntrySettled={flushModuleLorebookValue}')
    expect(lorebookList).toContain('onCollectionChange={updateModuleLorebookCollection}')
  })

  it('K4: failed entry-draft rollback restores only the edited entry', () => {
    setupK4EditorDb()
    const previous = currentLorebookEntryScopedSnapshot(
      { kind: 'character', characterId: 'c-k4' },
      2,
    )

    ;(DBState.db.characters[0].globalLore as Entry[])[2].content = 'failed optimistic edit'
    ;(DBState.db.characters[0].globalLore as Entry[])[4].content = 'same collection sibling edit'
    ;(DBState.db.characters[1].globalLore as Entry[])[0].content = 'other character edit'

    restoreLorebookEntryState(previous)

    expect((DBState.db.characters[0].globalLore as Entry[])[2].content).toContain('-2')
    expect((DBState.db.characters[0].globalLore as Entry[])[4].content).toBe(
      'same collection sibling edit',
    )
    expect((DBState.db.characters[1].globalLore as Entry[])[0].content).toBe('other character edit')
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
    expect((cmds[0].entries as Entry[]).map((entry) => entry.id)).toEqual([
      ...originalIds.slice(1),
      originalIds[0],
    ])
    ;(DBState.db.characters[0].globalLore as Entry[])[1].content = 'collection failed edit'
    restoreLorebookState(previous)
    expect((DBState.db.characters[0].globalLore as Entry[]).map((entry) => entry.id)).toEqual(
      originalIds,
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

    const scoped = withCloneInstrumentation(() =>
      collectLorebookCollectionSnapshots({ kind: 'character' }),
    )
    const whole = withCloneInstrumentation(() =>
      collectLorebookCollectionSnapshots({ kind: 'all' }),
    )

    // The whole-DB scan stringifies every character + chat + module + global; the
    // character scope stringifies only the selected character's two entries.
    expect(scoped.result.size).toBe(2)
    expect(scoped.jsonCloneCount).toBeLessThan(whole.jsonCloneCount)
    expect(scoped.jsonCloneCount).toBe(2)
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
    expect((DBState.db.characters[0].chats[0].localLore as Entry[])[0].id).toEqual(
      expect.any(String),
    )
    expect((DBState.db.characters[1].globalLore as Entry[])[0].id).toBeUndefined()
    expect((DBState.db.characters[1].chats[0].localLore as Entry[])[0].id).toBeUndefined()
    expect(((DBState.db.modules as any[])[0].lorebook as Entry[])[0].id).toBeUndefined()
    expect(((DBState.db.modules as any[])[1].lorebook as Entry[])[0].id).toBeUndefined()
    expect(((DBState.db.loreBook as any[])[0] as { id?: string }).id).toBeUndefined()
    expect(((DBState.db.loreBook as any[])[0].data as Entry[])[0].id).toBeUndefined()

    selectedCharID.set(1)
    flushSync()

    expect((DBState.db.characters[1].globalLore as Entry[])[0].id).toEqual(expect.any(String))
    expect((DBState.db.characters[1].chats[0].localLore as Entry[])[0].id).toEqual(
      expect.any(String),
    )
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
    const source = readFileSync(
      path.join(process.cwd(), 'src/lib/Setting/lorepreset.svelte'),
      'utf8',
    )
    const mountEffect = source.slice(
      source.indexOf('$effect'),
      source.indexOf('function selectLorebook'),
    )

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
    ;(DBState.db.characters[1].chats[0].localLore as Entry[]).push({ key: 'x', content: 'X' })
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(chatReplaceChatIds()).not.toContain('c1chat')

    // The selected character's own chat edit IS dispatched.
    recorded.commands.length = 0
    ;(DBState.db.characters[0].chats[0].localLore as Entry[]).push({ key: 'y', content: 'Y' })
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(chatReplaceChatIds()).toContain('c0chat')
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
    expect(characterReplaceCommands().map((c) => c.characterId)).toEqual(['c1'])

    // ...while an edit to the no-longer-selected c0 is ignored.
    recorded.commands.length = 0
    ;(DBState.db.characters[0].globalLore as Entry[]).push({ key: 'z', content: 'Z' })
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(characterReplaceCommands()).toHaveLength(0)
    stop()
  })
})
