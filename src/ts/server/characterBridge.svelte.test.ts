import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, untrack } from 'svelte'

const recorded = vi.hoisted(() => ({
  characterUpdates: [] as Array<{
    characterId: string
    patch: Record<string, unknown>
    keepalive?: boolean
  }>,
  characterResults: [] as Array<Promise<{ status: string; error?: string }>>,
  characterTransports: [] as Array<{ mutationId?: string; databaseLineage?: string }>,
}))
const resourceGuardState = vi.hoisted(() => ({ epoch: 0, localCharacterEpoch: 0 }))
const durableState = vi.hoisted(() => ({
  nextId: 0,
  stages: [] as Array<{ key: string; intent: Record<string, unknown>; handle: Record<string, any> }>,
  dispatches: [] as Array<{ handle: Record<string, any>; intent: Record<string, unknown> }>,
  acknowledgements: [] as Array<Record<string, any>>,
}))

vi.mock('./commands', () => ({
  canUseServerCommands: () => true,
}))

vi.mock('./resourceWriteGuard.svelte', () => ({
  getLocalCharacterProjectionMutationEpoch: () => resourceGuardState.localCharacterEpoch,
  getServerResourceApplyEpoch: () => resourceGuardState.epoch,
  markLocalCharacterProjectionMutation: () => {
    resourceGuardState.localCharacterEpoch += 1
  },
  withServerResourceApply: (fn: () => unknown) => {
    const result = fn()
    resourceGuardState.epoch += 1
    return result
  },
  withTrustedResourceWrite: (fn: () => unknown) => fn(),
}))

vi.mock('./pendingMutationOutbox', () => ({
  stagePendingMutation: (key: string, intent: Record<string, unknown>, previous?: Record<string, any> | null) => {
    const reuse = previous?.phase === 'staged' && previous.key === key
    if (reuse) previous.phase = 'superseded'
    const handle = {
      key,
      mutationId: reuse ? previous!.mutationId : `character-mutation-${++durableState.nextId}`,
      phase: 'staged',
    }
    durableState.stages.push({ key, intent: JSON.parse(JSON.stringify(intent)), handle })
    return handle
  },
  acknowledgePendingMutation: async (handle: Record<string, any>) => {
    durableState.acknowledgements.push(handle)
    return 'deleted'
  },
}))

vi.mock('./durableMutationDispatch', () => ({
  dispatchDurableMutation: async (
    handle: Record<string, any>,
    intent: Record<string, unknown>,
    dispatch: (transport: { mutationId: string; databaseLineage: string }) => Promise<unknown>,
  ) => {
    handle.phase = 'dispatching'
    durableState.dispatches.push({ handle, intent: JSON.parse(JSON.stringify(intent)) })
    return dispatch({ mutationId: handle.mutationId, databaseLineage: 'test-lineage' })
  },
}))

vi.mock('../characterCommands', () => {
  const excluded = new Set([
    'chaId',
    'chats',
    'chatFolders',
    'lastInteraction',
    'globalLore',
    'customscript',
    'triggerscript',
    'scriptstate',
    'modules',
    'coldstorage',
    'coldStoragedChats',
  ])
  const deletable = new Set(['loreSettings'])
  const cloneJsonValue = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T))
  const sanitizeCharacterPatch = (patch: Record<string, unknown>) => {
    const sanitized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (excluded.has(key)) continue
      if (value === undefined) {
        if (deletable.has(key)) sanitized[key] = null
        continue
      }
      sanitized[key] = cloneJsonValue(value)
    }
    return sanitized
  }
  const isCharacterPatchValueCurrent = (target: Record<string, unknown>, field: string, attemptedValue: unknown) => {
    if (deletable.has(field) && attemptedValue === null) {
      return (
        !Object.prototype.hasOwnProperty.call(target, field) || target[field] === undefined || target[field] === null
      )
    }
    return (
      Object.prototype.hasOwnProperty.call(target, field) &&
      JSON.stringify(target[field]) === JSON.stringify(attemptedValue)
    )
  }
  const applyCharacterPatchToRecord = (target: Record<string, unknown>, patch: Record<string, unknown>) => {
    for (const [field, value] of Object.entries(sanitizeCharacterPatch(patch))) {
      if (deletable.has(field) && value === null) delete target[field]
      else target[field] = cloneJsonValue(value)
    }
    return target
  }
  const applyAttemptedCharacterFieldRollback = (input: {
    target: Record<string, unknown>
    previous: Record<string, unknown>
    attempted: Record<string, unknown>
  }) => {
    for (const [field, attemptedValue] of Object.entries(input.attempted)) {
      if (!isCharacterPatchValueCurrent(input.target, field, attemptedValue)) continue
      if (Object.prototype.hasOwnProperty.call(input.previous, field)) {
        input.target[field] = cloneJsonValue(input.previous[field])
      } else {
        delete input.target[field]
      }
    }
  }

  return {
    CHARACTER_PATCH_DELETABLE_KEYS: deletable,
    CHARACTER_PATCH_EXCLUDED_KEYS: excluded,
    applyAttemptedCharacterFieldRollback,
    applyCharacterPatchToRecord,
    cloneJsonValue,
    dispatchUpdateCharacter: (
      characterId: string,
      patch: Record<string, unknown>,
      previous: unknown,
      rollback: (snapshot: unknown) => void,
      options?: { keepalive?: boolean; mutationId?: string; databaseLineage?: string },
    ) => {
      recorded.characterUpdates.push({
        characterId,
        patch: cloneJsonValue(sanitizeCharacterPatch(patch)),
        ...(options?.keepalive ? { keepalive: options.keepalive } : {}),
      })
      recorded.characterTransports.push({
        mutationId: options?.mutationId,
        databaseLineage: options?.databaseLineage,
      })
      const result = recorded.characterResults.shift() ?? Promise.resolve({ status: 'ok' })
      return result.then((settled) => {
        if (settled.status !== 'ok') rollback(previous)
        return settled
      })
    },
    isCharacterPatchValueCurrent,
    restoreCharacterState: vi.fn(),
    sanitizeCharacterPatch,
  }
})

import { selectedCharID } from '../stores.svelte'
import { mergeServerResourceCharacterRow, setDatabaseLite, type Database } from '../storage/database.svelte'
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
import { markLocalCharacterProjectionMutation, withTrustedResourceWrite } from './resourceWriteGuard.svelte'
import { notifyServerCommandLocalEffectApplied } from './commandLocalEffectEvents'

const DELAY = 50

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

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
  resourceGuardState.localCharacterEpoch = 0
  recorded.characterUpdates.length = 0
  recorded.characterResults.length = 0
  recorded.characterTransports.length = 0
  durableState.nextId = 0
  durableState.stages.length = 0
  durableState.dispatches.length = 0
  durableState.acknowledgements.length = 0
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

    const applied = mergeServerResourceCharacterRow({
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

    const applied = mergeServerResourceCharacterRow({
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

    const applied = mergeServerResourceCharacterRow({
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

    const applied = mergeServerResourceCharacterRow({
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

  it('merges a same-owner quick-added asset into a clean draft field', async () => {
    setupCharacters([
      characterRow('char-1', 'Initial', {
        additionalAssets: [['portrait', 'asset-a', 'png']],
      }),
    ])
    const { draft, stop } = await createDraft(['name', 'additionalAssets'])

    withTrustedResourceWrite(() => {
      getDatabase().characters[0] = {
        ...getDatabase().characters[0],
        additionalAssets: [
          ['portrait', 'asset-a', 'png'],
          ['sticker', 'asset-b', 'png'],
        ],
      }
      markLocalCharacterProjectionMutation()
    })
    await flushAndSettle()

    expect(draft.value.additionalAssets).toEqual([
      ['portrait', 'asset-a', 'png'],
      ['sticker', 'asset-b', 'png'],
    ])

    draft.value.name = 'Edited after quick add'
    await flushAndSettle()

    expect(getDatabase().characters[0].name).toBe('Edited after quick add')
    expect(getDatabase().characters[0].additionalAssets).toEqual([
      ['portrait', 'asset-a', 'png'],
      ['sticker', 'asset-b', 'png'],
    ])
    stop()
  })

  it('keeps a newer dirty scalar through older and unrelated effects, then settles its exact attempt', async () => {
    setupCharacter()
    const { draft, stop } = await createDraft(['name', 'desc'])

    draft.value.name = 'First attempted name'
    await flushAndSettle()
    draft.value.name = 'Newer attempted name'
    await flushAndSettle()

    resourceGuardState.epoch += 1
    notifyServerCommandLocalEffectApplied(
      { type: 'character.updated', revision: 2, resource: 'characterRow', id: 'char-1' },
      { kind: 'characterPatch', characterId: 'char-1', patch: { name: 'First attempted name' } },
    )
    await flushAndSettle()

    const olderApplied = mergeServerResourceCharacterRow({
      ...characterRow('char-1', 'First attempted name'),
      desc: 'Fresh description after older acknowledgement',
    })
    expect(olderApplied).toBe(true)
    await flushAndSettle()

    expect(draft.value.name).toBe('Newer attempted name')
    expect(draft.value.desc).toBe('Fresh description after older acknowledgement')

    resourceGuardState.epoch += 1
    notifyServerCommandLocalEffectApplied(
      { type: 'chat.updated', revision: 3, resource: 'chat', id: 'chat-1', parentId: 'char-1' },
      {
        kind: 'chatPatch',
        characterId: 'char-1',
        chatId: 'chat-1',
        patch: { name: 'Unrelated chat name' },
        select: false,
      },
    )
    await flushAndSettle()

    const staleAfterUnrelatedApply = mergeServerResourceCharacterRow({
      ...characterRow('char-1', 'First attempted name'),
      desc: 'Fresh description after unrelated acknowledgement',
    })
    expect(staleAfterUnrelatedApply).toBe(true)
    await flushAndSettle()

    expect(draft.value.name).toBe('Newer attempted name')
    expect(draft.value.desc).toBe('Fresh description after unrelated acknowledgement')

    notifyServerCommandLocalEffectApplied(
      { type: 'character.updated', revision: 4, resource: 'characterRow', id: 'char-1' },
      { kind: 'characterPatch', characterId: 'char-1', patch: { name: 'Newer attempted name' } },
    )

    const laterApplied = mergeServerResourceCharacterRow({
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

  it('persists lore settings deletion and releases the draft conflict boundary after acknowledgement', async () => {
    setupCharacters([
      characterRow('char-1', 'Initial', {
        loreSettings: { scanDepth: 4, tokenBudget: 800 },
      }),
    ])
    const stopWatcher = watchServerBackedCharacterProfile({ delayMs: DELAY })
    flushSync()
    const { draft, stop } = await createDraft(['name', 'loreSettings'])

    draft.value.loreSettings = null
    draft.value = { ...draft.value }
    await flushAndSettle()

    expect(getDatabase().characters[0]).not.toHaveProperty('loreSettings')
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.characterUpdates).toEqual([
      {
        characterId: 'char-1',
        patch: { loreSettings: null },
      },
    ])
    expect(durableState.stages[0].intent).toMatchObject({
      requests: [
        {
          body: { patch: { loreSettings: null } },
        },
      ],
    })

    notifyServerCommandLocalEffectApplied(
      { type: 'character.updated', revision: 2, resource: 'characterRow', id: 'char-1' },
      { kind: 'characterPatch', characterId: 'char-1', patch: { loreSettings: null } },
    )
    const applied = mergeServerResourceCharacterRow({
      ...characterRow('char-1', 'Server'),
      loreSettings: { scanDepth: 9, tokenBudget: 1200 },
    })
    expect(applied).toBe(true)
    await flushAndSettle()

    expect(draft.value.loreSettings).toEqual({ scanDepth: 9, tokenBudget: 1200 })
    expect(getDatabase().characters[0].loreSettings).toEqual({ scanDepth: 9, tokenBudget: 1200 })
    stop()
    stopWatcher()
  })

  it('settles a terminally rejected profile edit in both the projection and mounted draft', async () => {
    const failed = createDeferred<{ status: string; error?: string }>()
    recorded.characterResults.push(failed.promise)
    setupCharacter('Server baseline')
    const stopWatcher = watchServerBackedCharacterProfile({ delayMs: DELAY })
    flushSync()
    const { draft, stop } = await createDraft(['name', 'desc'])

    draft.value.name = 'Rejected draft name'
    await flushAndSettle()
    await vi.advanceTimersByTimeAsync(DELAY)
    expect(getDatabase().characters[0].name).toBe('Rejected draft name')
    expect(draft.value.name).toBe('Rejected draft name')

    failed.resolve({ status: 'error', error: 'invalid profile' })
    await flushAndSettle()
    await flushAndSettle()

    expect(getDatabase().characters[0].name).toBe('Server baseline')
    expect(draft.value.name).toBe('Server baseline')
    stop()
    stopWatcher()
  })

  it('preserves and dispatches a newer draft value when an older profile attempt is rejected', async () => {
    const first = createDeferred<{ status: string; error?: string }>()
    recorded.characterResults.push(first.promise, Promise.resolve({ status: 'ok' }))
    setupCharacter('Server baseline')
    const stopWatcher = watchServerBackedCharacterProfile({ delayMs: DELAY })
    flushSync()
    const { draft, stop } = await createDraft(['name'])

    draft.value.name = 'First attempt'
    await flushAndSettle()
    await vi.advanceTimersByTimeAsync(DELAY)
    draft.value.name = 'Newer attempt'
    await flushAndSettle()

    first.resolve({ status: 'error', error: 'older attempt rejected' })
    await flushAndSettle()
    await flushAndSettle()

    expect(getDatabase().characters[0].name).toBe('Newer attempt')
    expect(draft.value.name).toBe('Newer attempt')

    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.characterUpdates.map((entry) => entry.patch)).toEqual([
      { name: 'First attempt' },
      { name: 'Newer attempt' },
    ])
    stop()
    stopWatcher()
  })

  it('leaves lastInteraction to the purpose-built character commands', async () => {
    setupCharacters([characterRow('char-1', 'Initial', { lastInteraction: 100 })])
    const stop = watchServerBackedCharacterProfile({ delayMs: DELAY })
    flushSync()

    getDatabase().characters[0].lastInteraction = 200
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(recorded.characterUpdates).toEqual([])
    expect(durableState.stages).toEqual([])
    stop()
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

    const applied = mergeServerResourceCharacterRow(characterRow('char-1', 'Hydrated'))
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
  it('stages the exact coalesced character payload and forwards its replay-safe transport id', async () => {
    setupCharacter('Server baseline')
    const stop = watchServerBackedCharacterProfile({ delayMs: DELAY })
    flushSync()

    getDatabase().characters[0].name = 'First queued name'
    flushSync()
    getDatabase().characters[0].name = 'Final queued name'
    flushSync()

    expect(durableState.stages).toHaveLength(2)
    expect(durableState.stages.map(({ key }) => key)).toEqual(['character-owner:char-1', 'character-owner:char-1'])
    expect(durableState.stages[0].intent).toEqual({
      version: 1,
      requests: [
        {
          method: 'PATCH',
          path: '/characters/char-1',
          body: { patch: { name: 'First queued name' } },
        },
      ],
    })
    expect(durableState.stages[1].intent).toEqual({
      version: 1,
      requests: [
        {
          method: 'PATCH',
          path: '/characters/char-1',
          body: { patch: { name: 'Final queued name' } },
        },
      ],
    })
    expect(durableState.stages[1].handle).not.toBe(durableState.stages[0].handle)
    expect(durableState.stages[1].handle.mutationId).toBe(durableState.stages[0].handle.mutationId)

    await vi.advanceTimersByTimeAsync(DELAY)

    expect(durableState.dispatches).toEqual([
      {
        handle: durableState.stages[1].handle,
        intent: durableState.stages[1].intent,
      },
    ])
    expect(recorded.characterTransports).toEqual([
      {
        mutationId: durableState.stages[1].handle.mutationId,
        databaseLineage: 'test-lineage',
      },
    ])
    stop()
  })

  it('keeps an in-flight character generation separate from the next queued edit', async () => {
    const firstResult = createDeferred<{ status: string; error?: string }>()
    recorded.characterResults.push(firstResult.promise)
    setupCharacter('Server baseline')
    const stop = watchServerBackedCharacterProfile({ delayMs: DELAY })
    flushSync()

    getDatabase().characters[0].name = 'Generation A'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    getDatabase().characters[0].name = 'Generation B'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    expect(durableState.stages).toHaveLength(2)
    expect(durableState.stages[0].handle.mutationId).not.toBe(durableState.stages[1].handle.mutationId)
    expect(durableState.dispatches.map((entry) => entry.handle)).toEqual([
      durableState.stages[0].handle,
      durableState.stages[1].handle,
    ])
    expect(recorded.characterUpdates.map((entry) => entry.patch)).toEqual([
      { name: 'Generation A' },
      { name: 'Generation B' },
    ])

    firstResult.resolve({ status: 'ok' })
    await flushAndSettle()
    stop()
  })

  it('rebases a debounced same-field edit after two character saves fail', async () => {
    const firstResult = createDeferred<{ status: string; error?: string }>()
    const secondResult = createDeferred<{ status: string; error?: string }>()
    recorded.characterResults.push(firstResult.promise, secondResult.promise)
    setupCharacter('Server baseline')
    const stop = watchServerBackedCharacterProfile({ delayMs: DELAY })
    flushSync()

    getDatabase().characters[0].name = 'First attempt'
    flushSync()
    await vi.advanceTimersByTimeAsync(DELAY)

    getDatabase().characters[0].name = 'Second attempt'
    flushSync()
    expect(getDatabase().characters[0].name).toBe('Second attempt')

    firstResult.resolve({ status: 'network-error', error: 'first failed' })
    await flushAndSettle()
    await flushAndSettle()
    expect(getDatabase().characters[0].name).toBe('Second attempt')

    await vi.advanceTimersByTimeAsync(DELAY)
    expect(recorded.characterUpdates.map((entry) => entry.patch)).toEqual([
      { name: 'First attempt' },
      { name: 'Second attempt' },
    ])

    secondResult.resolve({ status: 'network-error', error: 'second failed' })
    await flushAndSettle()
    await flushAndSettle()
    expect(getDatabase().characters[0].name).toBe('Server baseline')
    stop()
  })

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

    const applied = mergeServerResourceCharacterRow({
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

    const applied = mergeServerResourceCharacterRow(characterRow('char-1', 'Hydrated'))
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
