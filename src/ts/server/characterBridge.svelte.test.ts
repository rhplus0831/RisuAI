import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'

const recorded = vi.hoisted(() => ({
  characterUpdates: [] as Array<{
    characterId: string
    patch: Record<string, unknown>
    keepalive?: boolean
  }>,
}))
const projectionGuardState = vi.hoisted(() => ({ epoch: 0 }))

vi.mock('./commands', () => ({
  canUseServerCommands: () => true,
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

vi.mock('../characterCommands', () => {
  const excluded = new Set([
    'chaId',
    'chats',
    'chatFolders',
    'globalLore',
    'customscript',
    'triggerscript',
    'scriptstate',
    'modules',
    'coldstorage',
    'coldStoragedChats',
  ])
  const cloneJsonValue = <T>(value: T): T =>
    value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
  const sanitizeCharacterPatch = (patch: Record<string, unknown>) => {
    const sanitized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (!excluded.has(key) && value !== undefined) sanitized[key] = cloneJsonValue(value)
    }
    return sanitized
  }

  return {
    CHARACTER_PATCH_EXCLUDED_KEYS: excluded,
    cloneJsonValue,
    dispatchUpdateCharacter: (
      characterId: string,
      patch: Record<string, unknown>,
      _previous: unknown,
      _rollback: unknown,
      options?: { keepalive?: boolean },
    ) => {
      recorded.characterUpdates.push({
        characterId,
        patch: cloneJsonValue(sanitizeCharacterPatch(patch)),
        ...(options?.keepalive ? { keepalive: options.keepalive } : {}),
      })
    },
    restoreCharacterState: vi.fn(),
    sanitizeCharacterPatch,
  }
})

import { DBState, selectedCharID } from '../stores.svelte'
import { mergeServerProjectionCharacterRow } from '../storage/database.svelte'
import {
  flushPendingServerBackedCharacterPatches,
  watchServerBackedCharacterProfile,
} from './characterBridge.svelte'

const DELAY = 50

function setupCharacter(name = 'Initial'): void {
  ;(DBState as { db: unknown }).db = {
    currentChar: 0,
    characters: [
      {
        chaId: 'char-1',
        name,
        desc: 'Initial description',
        chats: [{ id: 'chat-1', name: 'Chat', message: [] }],
        globalLore: [],
      },
    ],
  }
  selectedCharID.set(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  projectionGuardState.epoch = 0
  recorded.characterUpdates.length = 0
})

afterEach(() => {
  vi.useRealTimers()
  selectedCharID.set(-1)
  ;(DBState as { db: unknown }).db = {}
})

describe('watchServerBackedCharacterProfile baselines', () => {
  it('M12: foreign character-row projection apply refreshes baseline without echoing, then local profile edits dispatch', async () => {
    setupCharacter()
    const stop = watchServerBackedCharacterProfile({ delayMs: DELAY })
    flushSync()

    const applied = mergeServerProjectionCharacterRow({
      chaId: 'char-1',
      name: 'Server',
      desc: 'Server description',
      chats: [{ id: 'chat-1', name: 'Chat', message: [] }],
      globalLore: [],
    })
    expect(applied).toBe(true)
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.characterUpdates).toEqual([])

    DBState.db.characters[0].name = 'Local'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.characterUpdates).toEqual([{ characterId: 'char-1', patch: { name: 'Local' } }])
    stop()
  })

  it('M8: flushes pending character profile edits with keepalive and clears the debounce', async () => {
    setupCharacter()
    const stop = watchServerBackedCharacterProfile({ delayMs: DELAY * 10 })
    flushSync()

    DBState.db.characters[0].name = 'Unload Local'
    flushSync()
    flushPendingServerBackedCharacterPatches({ keepalive: true })

    expect(recorded.characterUpdates).toEqual([
      { characterId: 'char-1', patch: { name: 'Unload Local' }, keepalive: true },
    ])

    await vi.advanceTimersByTimeAsync(DELAY * 10)
    expect(recorded.characterUpdates).toHaveLength(1)
    stop()
  })

  it('M8: watcher teardown flushes pending character profile edits and clears the debounce', async () => {
    setupCharacter()
    const stop = watchServerBackedCharacterProfile({ delayMs: DELAY * 10 })
    flushSync()

    DBState.db.characters[0].name = 'Teardown Local'
    flushSync()
    stop()

    expect(recorded.characterUpdates).toEqual([
      { characterId: 'char-1', patch: { name: 'Teardown Local' } },
    ])

    await vi.advanceTimersByTimeAsync(DELAY * 10)
    expect(recorded.characterUpdates).toHaveLength(1)
  })
})
