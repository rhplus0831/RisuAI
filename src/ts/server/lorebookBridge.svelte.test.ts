import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'

// Lazy-projection Phase 5 — the no-data-loss invariant for `watchServerBackedLorebooks`.
// The watcher auto-persists any lorebook change it diffs; stubbing character
// `globalLore` makes a `[real]`→`[]` (hydrated→stub) transition possible, which —
// without the hydrated registry — the watcher would persist as a DELETION. Per the
// handover, keep `stores.svelte` real (DBState is the live $state the watcher reads)
// and mock only the command layer + the projection guard. Drive the reactive effect
// with flushSync() and the debounce with fake timers.

const recorded = vi.hoisted(() => ({ commands: [] as Array<Record<string, unknown>> }))
vi.mock('./commands', () => ({
  canUseServerCommands: () => true,
  runServerCommand: vi.fn(async ({ command }: { command: (rev: number) => Promise<unknown> }) => {
    const built = await command(1)
    recorded.commands.push(built as Record<string, unknown>)
    return { status: 'ok', revision: 1 }
  }),
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
  withTrustedServerProjectionWrite: (fn: () => unknown) => fn(),
}))

import { DBState, selectedCharID } from '../stores.svelte'
import {
  markCharacterLorebookHydrated,
  recordHydratedCharacterLorebooks,
  resetLorebookHydration,
  watchServerBackedLorebooks,
} from './lorebookBridge.svelte'

type Entry = { key?: string; content?: string; id?: string }

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
    ;(DBState.db.characters[0] as { globalLore: unknown }).globalLore = [
      { key: 'x', content: 'X' },
    ]
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
})
