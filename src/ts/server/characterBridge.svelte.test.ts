import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, untrack } from 'svelte'

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
  const cloneJsonValue = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T))
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
  createServerBackedCharacterDraft,
  flushPendingServerBackedCharacterPatches,
  rollbackServerBackedCharacterProfile,
  type ServerBackedCharacterDraft,
  watchServerBackedCharacterProfile,
} from './characterBridge.svelte'
import { watchServerBackedChatMetadata } from './chatBridge.svelte'
import { watchServerBackedScriptDefinitions } from './scriptDefinitionBridge.svelte'

const DELAY = 50

function characterRow(chaId: string, name: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chaId,
    name,
    desc: `${name} description`,
    newGenData: {
      prompt: `${name} prompt`,
      negative: '',
      instructions: '',
      emotionInstructions: '',
    },
    chats: [{ id: `${chaId}-chat`, name: 'Chat', message: [] }],
    globalLore: [],
    ...fields,
  }
}

function setupCharacter(name = 'Initial'): void {
  ;(DBState as { db: unknown }).db = {
    currentChar: 0,
    characters: [characterRow('char-1', name)],
  }
  selectedCharID.set(0)
}

function setupCharacters(characters: Array<Record<string, unknown>>, selected = 0): void {
  ;(DBState as { db: unknown }).db = {
    currentChar: selected,
    characters,
  }
  selectedCharID.set(selected)
}

async function createDraft(keys: readonly string[]): Promise<{ draft: ServerBackedCharacterDraft; stop: () => void }> {
  let draft: ServerBackedCharacterDraft | undefined
  const stop = $effect.root(() => {
    draft = createServerBackedCharacterDraft(keys)
  })
  flushSync()
  await Promise.resolve()
  if (!draft) {
    stop()
    throw new Error('character draft was not initialized')
  }
  return { draft, stop }
}

async function flushAndSettle(): Promise<void> {
  flushSync()
  await Promise.resolve()
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

describe('createServerBackedCharacterDraft seed gating', () => {
  it('L22: editing nested draft fields does not rerun the server seed path', async () => {
    let newGenDataReads = 0
    let projectedNewGenData = {
      prompt: 'Initial prompt',
      negative: '',
      instructions: '',
      emotionInstructions: '',
    }
    const character = characterRow('char-1', 'Initial')
    Object.defineProperty(character, 'newGenData', {
      configurable: true,
      enumerable: true,
      get() {
        newGenDataReads += 1
        return projectedNewGenData
      },
      set(value) {
        projectedNewGenData = value as typeof projectedNewGenData
      },
    })
    setupCharacters([character])

    const { draft, stop } = await createDraft(['name', 'newGenData'])

    expect(draft.characterId).toBe('char-1')
    expect(draft.value.newGenData.prompt).toBe('Initial prompt')
    expect(newGenDataReads).toBeGreaterThan(0)
    const seedReads = newGenDataReads

    draft.value.newGenData.prompt = 'typed nested draft'
    await flushAndSettle()
    ;(DBState as { db: unknown }).db = { ...DBState.db }
    await flushAndSettle()

    expect(newGenDataReads).toBe(seedReads)
    expect(projectedNewGenData.prompt).toBe('typed nested draft')
    stop()
  })

  it('L22: character switch reseeds the draft', async () => {
    setupCharacters([characterRow('char-1', 'Initial'), characterRow('char-2', 'Second')])
    const { draft, stop } = await createDraft(['name', 'newGenData'])

    expect(draft.characterId).toBe('char-1')
    expect(draft.value.name).toBe('Initial')

    selectedCharID.set(1)
    ;(DBState.db as unknown as { currentChar?: number }).currentChar = 1
    await flushAndSettle()

    expect(draft.characterId).toBe('char-2')
    expect(draft.value.name).toBe('Second')
    expect(draft.value.newGenData.prompt).toBe('Second prompt')
    stop()
  })

  it('L22: server projection apply with changed fields reseeds the draft', async () => {
    setupCharacter()
    const { draft, stop } = await createDraft(['name', 'desc', 'newGenData'])

    expect(draft.value.name).toBe('Initial')

    const applied = mergeServerProjectionCharacterRow({
      ...characterRow('char-1', 'Server'),
      desc: 'Server description',
      newGenData: {
        prompt: 'Server prompt',
        negative: '',
        instructions: 'Server instructions',
        emotionInstructions: '',
      },
    })
    expect(applied).toBe(true)
    await flushAndSettle()

    expect(draft.characterId).toBe('char-1')
    expect(draft.value.name).toBe('Server')
    expect(draft.value.desc).toBe('Server description')
    expect(draft.value.newGenData).toMatchObject({
      prompt: 'Server prompt',
      instructions: 'Server instructions',
    })
    stop()
  })

  it('L22: local edits update projection and dispatch sanitized character patches', async () => {
    setupCharacter()
    const stopWatcher = watchServerBackedCharacterProfile({ delayMs: DELAY })
    flushSync()
    const { draft, stop } = await createDraft(['chaId', 'name', 'newGenData'])

    draft.value.chaId = 'malicious-local-id'
    draft.value.name = 'Local draft'
    draft.value.newGenData.prompt = 'Local prompt'
    await flushAndSettle()

    expect(projectionGuardState.epoch).toBe(0)
    expect(DBState.db.characters[0].chaId).toBe('char-1')
    expect(DBState.db.characters[0].name).toBe('Local draft')
    expect(DBState.db.characters[0].newGenData.prompt).toBe('Local prompt')

    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.characterUpdates).toHaveLength(1)
    expect(recorded.characterUpdates[0].characterId).toBe('char-1')
    expect(recorded.characterUpdates[0].patch).toMatchObject({
      name: 'Local draft',
      newGenData: {
        prompt: 'Local prompt',
      },
    })
    expect(recorded.characterUpdates[0].patch).not.toHaveProperty('chaId')
    stop()
    stopWatcher()
  })

  it('does not roll back a profile field after a newer same-row edit', () => {
    setupCharacter('Initial')
    DBState.db.characters[0].name = 'Newer local name'

    rollbackServerBackedCharacterProfile({
      characters: [],
      characterOrder: [],
      currentChar: 0,
      selectedCharID: 0,
      profileCharacterId: 'char-1',
      profile: { name: 'Initial' },
      attemptedProfile: { name: 'Attempted name' },
    } as any)

    expect(DBState.db.characters[0].name).toBe('Newer local name')
  })

  it('does not dispatch draft defaults from a selected character shell', async () => {
    setupCharacters([
      {
        __serverCharacterShell: true,
        chaId: 'char-1',
        name: 'Shell',
        chats: [{ id: 'char-1-chat', name: 'Chat', message: [] }],
        chatPage: 0,
        chatFolders: [],
      },
    ])
    const stopWatcher = watchServerBackedCharacterProfile({ delayMs: DELAY })
    flushSync()
    const { draft, stop } = await createDraft(['name', 'desc', 'newGenData'])

    expect(draft.characterId).toBeNull()
    expect(draft.value.name).toBe('')

    draft.value.name = 'Typed before hydration'
    draft.value.newGenData.prompt = 'Should not patch'
    await flushAndSettle()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.characterUpdates).toEqual([])
    expect(DBState.db.characters[0].name).toBe('Shell')

    const applied = mergeServerProjectionCharacterRow(characterRow('char-1', 'Hydrated'))
    expect(applied).toBe(true)
    await flushAndSettle()

    expect(draft.characterId).toBe('char-1')
    expect(draft.value.name).toBe('Hydrated')

    draft.value.name = 'Local after hydration'
    await flushAndSettle()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.characterUpdates).toHaveLength(1)
    expect(recorded.characterUpdates[0].characterId).toBe('char-1')
    expect(recorded.characterUpdates[0].patch).toMatchObject({ name: 'Local after hydration' })
    stop()
    stopWatcher()
  })
})

describe('watchServerBackedCharacterProfile baselines', () => {
  it('keeps the character watcher baseline when started beside chat metadata in an untracked owner effect', async () => {
    setupCharacter()
    const stop = $effect.root(() => {
      $effect(() => {
        const stops = untrack(() => [
          watchServerBackedCharacterProfile({ delayMs: DELAY }),
          watchServerBackedChatMetadata({ delayMs: DELAY }),
          watchServerBackedScriptDefinitions({ delayMs: DELAY, scope: { kind: 'character' } }),
        ])
        return () => {
          for (const stopWatching of stops) stopWatching()
        }
      })
    })
    flushSync()

    DBState.db.characters[0].backgroundHTML = '<section>local background</section>'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.characterUpdates).toEqual([
      { characterId: 'char-1', patch: { backgroundHTML: '<section>local background</section>' } },
    ])
    stop()
  })

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

  it('does not dispatch profile patches while the selected row is a shell', async () => {
    setupCharacters([
      {
        __serverCharacterShell: true,
        chaId: 'char-1',
        name: 'Shell',
        chats: [{ id: 'char-1-chat', name: 'Chat', message: [] }],
        chatPage: 0,
        chatFolders: [],
      },
    ])
    const stop = watchServerBackedCharacterProfile({ delayMs: DELAY })
    flushSync()

    DBState.db.characters[0].name = 'Shell local'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.characterUpdates).toEqual([])

    const applied = mergeServerProjectionCharacterRow(characterRow('char-1', 'Hydrated'))
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

    expect(recorded.characterUpdates).toEqual([{ characterId: 'char-1', patch: { name: 'Teardown Local' } }])

    await vi.advanceTimersByTimeAsync(DELAY * 10)
    expect(recorded.characterUpdates).toHaveLength(1)
  })
})
