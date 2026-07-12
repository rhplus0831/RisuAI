import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, untrack } from 'svelte'

const recorded = vi.hoisted(() => ({
  characterUpdates: [] as Array<{
    characterId: string
    patch: Record<string, unknown>
    keepalive?: boolean
  }>,
}))
const resourceGuardState = vi.hoisted(() => ({ epoch: 0 }))

vi.mock('./commands', () => ({
  canUseServerCommands: () => true,
}))

vi.mock('./resourceWriteGuard.svelte', () => ({
  getServerResourceApplyEpoch: () => resourceGuardState.epoch,
  withServerResourceApply: (fn: () => unknown) => {
    const result = fn()
    resourceGuardState.epoch += 1
    return result
  },
  withTrustedResourceWrite: (fn: () => unknown) => fn(),
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

import { selectedCharID } from '../stores.svelte'
import { mergeServerProjectionCharacterRow, setDatabaseLite, type Database } from '../storage/database.svelte'
import { getResourceDatabase as getDatabase } from './resourceState.svelte'
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

const resourceDatabase = {
  set current(value: unknown) {
    setDatabaseLite(value as Database)
  },
}

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
  resourceDatabase.current = {
    currentChar: 0,
    characters: [characterRow('char-1', name)],
  }
  selectedCharID.set(0)
}

function setupCharacters(characters: Array<Record<string, unknown>>, selected = 0): void {
  resourceDatabase.current = {
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
  resourceGuardState.epoch = 0
  recorded.characterUpdates.length = 0
})

afterEach(() => {
  vi.useRealTimers()
  selectedCharID.set(-1)
  resourceDatabase.current = {}
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
    resourceDatabase.current = { ...getDatabase() }
    await flushAndSettle()

    expect(newGenDataReads).toBe(seedReads)
    expect(getDatabase().characters[0].newGenData.prompt).toBe('typed nested draft')
    stop()
  })

  it('L22: character switch reseeds the draft', async () => {
    setupCharacters([characterRow('char-1', 'Initial'), characterRow('char-2', 'Second')])
    const { draft, stop } = await createDraft(['name', 'newGenData'])

    expect(draft.characterId).toBe('char-1')
    expect(draft.value.name).toBe('Initial')

    selectedCharID.set(1)
    ;(getDatabase() as unknown as { currentChar?: number }).currentChar = 1
    await flushAndSettle()

    expect(draft.characterId).toBe('char-2')
    expect(draft.value.name).toBe('Second')
    expect(draft.value.newGenData.prompt).toBe('Second prompt')
    stop()
  })

  it('L22: server resource apply with changed fields reseeds the draft', async () => {
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

  it('preserves a dirty scalar field through a stale projection while clean fields refresh', async () => {
    setupCharacter()
    const { draft, stop } = await createDraft(['name', 'desc'])

    draft.value.name = 'Local draft name'
    await flushAndSettle()

    expect(getDatabase().characters[0].name).toBe('Local draft name')

    const applied = mergeServerProjectionCharacterRow({
      ...characterRow('char-1', 'Stale server name'),
      desc: 'Fresh server description',
    })
    expect(applied).toBe(true)
    await flushAndSettle()

    expect(draft.value.name).toBe('Local draft name')
    expect(draft.value.desc).toBe('Fresh server description')
    expect(getDatabase().characters[0].name).toBe('Local draft name')
    expect(getDatabase().characters[0].desc).toBe('Fresh server description')
    stop()
  })

  it('treats a dirty nested object as a top-level conflict boundary through a stale projection', async () => {
    setupCharacter()
    const { draft, stop } = await createDraft(['desc', 'newGenData'])

    draft.value.newGenData.prompt = 'Local prompt'
    await flushAndSettle()

    const applied = mergeServerProjectionCharacterRow({
      ...characterRow('char-1', 'Server'),
      desc: 'Fresh server description',
      newGenData: {
        prompt: 'Stale server prompt',
        negative: '',
        instructions: 'Fresh server instructions',
        emotionInstructions: '',
      },
    })
    expect(applied).toBe(true)
    await flushAndSettle()

    expect(draft.value.newGenData.prompt).toBe('Local prompt')
    // Dirty tracking is intentionally top-level: editing newGenData.prompt keeps
    // the whole newGenData object local, including otherwise clean siblings.
    expect(draft.value.newGenData.instructions).toBe('')
    expect(draft.value.desc).toBe('Fresh server description')
    expect(getDatabase().characters[0].newGenData.prompt).toBe('Local prompt')
    expect(getDatabase().characters[0].newGenData.instructions).toBe('')
    expect(getDatabase().characters[0].desc).toBe('Fresh server description')
    stop()
  })

  it('preserves a dirty list as a top-level field through a stale projection', async () => {
    setupCharacters([
      characterRow('char-1', 'Initial', {
        alternateGreetings: ['Initial alternate greeting'],
      }),
    ])
    const { draft, stop } = await createDraft(['desc', 'alternateGreetings'])

    draft.value.alternateGreetings = ['Local alternate greeting']
    await flushAndSettle()

    const applied = mergeServerProjectionCharacterRow({
      ...characterRow('char-1', 'Server', {
        alternateGreetings: ['Stale server alternate greeting'],
      }),
      desc: 'Fresh server description',
    })
    expect(applied).toBe(true)
    await flushAndSettle()

    expect(draft.value.alternateGreetings).toEqual(['Local alternate greeting'])
    expect(draft.value.desc).toBe('Fresh server description')
    expect(getDatabase().characters[0].alternateGreetings).toEqual(['Local alternate greeting'])
    expect(getDatabase().characters[0].desc).toBe('Fresh server description')
    stop()
  })

  it('clears a dirty scalar once a matching projection arrives', async () => {
    setupCharacter()
    const { draft, stop } = await createDraft(['name', 'desc'])

    draft.value.name = 'Accepted local name'
    await flushAndSettle()

    const matchingApplied = mergeServerProjectionCharacterRow({
      ...characterRow('char-1', 'Accepted local name'),
      desc: 'Accepted server description',
    })
    expect(matchingApplied).toBe(true)
    await flushAndSettle()

    expect(draft.value.name).toBe('Accepted local name')
    expect(draft.value.desc).toBe('Accepted server description')

    const laterApplied = mergeServerProjectionCharacterRow({
      ...characterRow('char-1', 'Later server name'),
      desc: 'Later server description',
    })
    expect(laterApplied).toBe(true)
    await flushAndSettle()

    expect(draft.value.name).toBe('Later server name')
    expect(draft.value.desc).toBe('Later server description')
    expect(getDatabase().characters[0].name).toBe('Later server name')
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

    expect(resourceGuardState.epoch).toBe(0)
    expect(getDatabase().characters[0].chaId).toBe('char-1')
    expect(getDatabase().characters[0].name).toBe('Local draft')
    expect(getDatabase().characters[0].newGenData.prompt).toBe('Local prompt')

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
    getDatabase().characters[0].name = 'Newer local name'

    rollbackServerBackedCharacterProfile({
      characters: [],
      characterOrder: [],
      currentChar: 0,
      selectedCharID: 0,
      profileCharacterId: 'char-1',
      profile: { name: 'Initial' },
      attemptedProfile: { name: 'Attempted name' },
    } as any)

    expect(getDatabase().characters[0].name).toBe('Newer local name')
  })

  it('deletes a profile field added by a failed attempted rollback when the baseline lacked it', () => {
    setupCharacter('Initial')
    getDatabase().characters[0].creatorNotes = 'Attempted notes'

    rollbackServerBackedCharacterProfile({
      characters: [],
      characterOrder: [],
      currentChar: 0,
      selectedCharID: 0,
      profileCharacterId: 'char-1',
      profile: { name: 'Initial' },
      attemptedProfile: { creatorNotes: 'Attempted notes' },
    } as any)

    expect(Object.hasOwn(getDatabase().characters[0], 'creatorNotes')).toBe(false)
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
    expect(getDatabase().characters[0].name).toBe('Shell')

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

    getDatabase().characters[0].backgroundHTML = '<section>local background</section>'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.characterUpdates).toEqual([
      { characterId: 'char-1', patch: { backgroundHTML: '<section>local background</section>' } },
    ])
    stop()
  })

  it('M12: foreign character-row resource apply refreshes baseline without echoing, then local profile edits dispatch', async () => {
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

    getDatabase().characters[0].name = 'Local'
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

    getDatabase().characters[0].name = 'Shell local'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.characterUpdates).toEqual([])

    const applied = mergeServerProjectionCharacterRow(characterRow('char-1', 'Hydrated'))
    expect(applied).toBe(true)
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.characterUpdates).toEqual([])

    getDatabase().characters[0].name = 'Local'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.characterUpdates).toEqual([{ characterId: 'char-1', patch: { name: 'Local' } }])
    stop()
  })

  it('M8: flushes pending character profile edits with keepalive and clears the debounce', async () => {
    setupCharacter()
    const stop = watchServerBackedCharacterProfile({ delayMs: DELAY * 10 })
    flushSync()

    getDatabase().characters[0].name = 'Unload Local'
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

    getDatabase().characters[0].name = 'Teardown Local'
    flushSync()
    stop()

    expect(recorded.characterUpdates).toEqual([{ characterId: 'char-1', patch: { name: 'Teardown Local' } }])

    await vi.advanceTimersByTimeAsync(DELAY * 10)
    expect(recorded.characterUpdates).toHaveLength(1)
  })
})
