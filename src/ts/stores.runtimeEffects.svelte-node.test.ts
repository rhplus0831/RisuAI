import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'

const runtimeEffectState = vi.hoisted(() => ({
  database: {
    characters: [] as unknown[],
    modules: [] as unknown[],
    enabledModules: [] as string[],
    promptPresets: [] as unknown[],
    agentPresets: [] as unknown[],
    agentPresetDefaultId: '',
    moduleIntergration: '',
    hypaV3: false,
    hypaV3PresetId: 0,
    hypaV3Presets: [] as any[],
  },
  settingsResourceState: {
    value: {} as Record<string, any>,
    groupStatuses: {
      memory: 'ready',
      modules: 'ready',
      advanced: 'ready',
      agents: 'ready',
    } as Record<string, string>,
  },
  collectionsResourceState: {
    values: {} as Record<string, any>,
    statuses: {
      modules: 'ready',
      promptPresets: 'ready',
      hypaV3Presets: 'ready',
    } as Record<string, string>,
  },
  charactersResourceState: {
    characters: [] as any[],
    currentChar: -1,
    selectionRevision: null as number | null,
    status: 'ready',
  },
  moduleUpdate: vi.fn(),
  setCharacterSupaMemory: vi.fn(),
}))

vi.mock('./process/modules', () => ({
  moduleUpdate: runtimeEffectState.moduleUpdate,
}))

vi.mock('./server/resourceState.svelte', () => ({
  settingsResourceState: runtimeEffectState.settingsResourceState,
  collectionsResourceState: runtimeEffectState.collectionsResourceState,
  charactersResourceState: runtimeEffectState.charactersResourceState,
  getCharacterResourceOwner: (characterId: string) => {
    const matches = runtimeEffectState.charactersResourceState.characters.filter(
      (character) => character?.chaId === characterId,
    )
    return matches.length === 1 ? matches[0] : undefined
  },
  getChatMetadataOwnerState: (chatId: string) => {
    const matches = runtimeEffectState.charactersResourceState.characters.flatMap((character) =>
      (character?.chats ?? []).filter((chat: any) => chat?.id === chatId),
    )
    return matches.length === 1 ? { chatId } : undefined
  },
}))

vi.mock('./storage/database.svelte', () => ({
  getDatabase: () => runtimeEffectState.database,
}))

vi.mock('./characterState', () => ({
  getSelectedCharacterOwner: () => {
    const characters = runtimeEffectState.charactersResourceState.characters
    const candidate = characters[runtimeEffectState.charactersResourceState.currentChar]
    if (!candidate?.chaId) return undefined
    return characters.filter((character) => character?.chaId === candidate.chaId).length === 1 ? candidate : undefined
  },
  selectCharacterOwner: (characters: any[], selectedIndex: number) => {
    const candidate = characters[selectedIndex]
    if (!candidate?.chaId) return undefined
    return characters.filter((character) => character?.chaId === candidate.chaId).length === 1 ? candidate : undefined
  },
}))

vi.mock('./characterCommands', () => ({
  setCharacterSupaMemory: runtimeEffectState.setCharacterSupaMemory,
}))

import { selectedCharID, selIdState } from './stores/coreStores.svelte'
import {
  installStoreRuntimeEffects,
  resolveUniqueAgentPreset,
  resolveUniquePromptPreset,
} from './stores/runtimeEffects.svelte'

let dispose: (() => void) | undefined

beforeEach(() => {
  runtimeEffectState.moduleUpdate.mockClear()
  runtimeEffectState.setCharacterSupaMemory.mockReset()
  runtimeEffectState.database.characters = []
  runtimeEffectState.database.modules = []
  runtimeEffectState.database.enabledModules = []
  runtimeEffectState.database.promptPresets = []
  runtimeEffectState.database.agentPresets = []
  runtimeEffectState.database.agentPresetDefaultId = ''
  runtimeEffectState.database.moduleIntergration = ''
  runtimeEffectState.database.hypaV3 = false
  runtimeEffectState.database.hypaV3PresetId = 0
  runtimeEffectState.database.hypaV3Presets = []
  runtimeEffectState.settingsResourceState.value = {
    hypaV3: false,
    hypaV3PresetId: 0,
    selectedHypaV3PresetId: null,
    enabledModules: [],
    agentPresets: [],
    agentPresetDefaultId: '',
    moduleIntergration: '',
  }
  Object.assign(runtimeEffectState.settingsResourceState.groupStatuses, {
    memory: 'ready',
    modules: 'ready',
    advanced: 'ready',
    agents: 'ready',
  })
  runtimeEffectState.collectionsResourceState.values = {
    modules: [],
    promptPresets: [],
    hypaV3Presets: [],
  }
  Object.assign(runtimeEffectState.collectionsResourceState.statuses, {
    modules: 'ready',
    promptPresets: 'ready',
    hypaV3Presets: 'ready',
  })
  runtimeEffectState.charactersResourceState.characters = []
  runtimeEffectState.charactersResourceState.currentChar = -1
  runtimeEffectState.charactersResourceState.selectionRevision = null
  runtimeEffectState.charactersResourceState.status = 'ready'
  selectedCharID.set(-1)
  selIdState.selId = -1
})

afterEach(() => {
  dispose?.()
  dispose = undefined
})

describe('store runtime effects', () => {
  it.each([
    ['missing', []],
    ['duplicate', [{ id: 'prompt-a' }, { id: 'prompt-a' }]],
  ])('fails closed for a %s prompt preset owner', (_kind, promptPresets) => {
    expect(resolveUniquePromptPreset(promptPresets, 'prompt-a')).toBeUndefined()
  })

  it('resolves the unique prompt preset owner for runtime effects', () => {
    const preset = { id: 'prompt-a', moduleIntergration: 'runtime-module' }
    expect(resolveUniquePromptPreset([preset], 'prompt-a')).toBe(preset)
  })

  it('fails closed for duplicate agent preset owners', () => {
    expect(resolveUniqueAgentPreset([{ id: 'agent-a' }, { id: 'agent-a' }], 'agent-a')).toBeUndefined()
  })

  it('install once, synchronize selection, and dispose cleanly', () => {
    dispose = installStoreRuntimeEffects()
    expect(installStoreRuntimeEffects()).toBe(dispose)

    flushSync()
    expect(runtimeEffectState.moduleUpdate).toHaveBeenCalledTimes(1)

    selectedCharID.set(2)
    flushSync()
    expect(selIdState.selId).toBe(2)
    expect(runtimeEffectState.moduleUpdate).toHaveBeenCalledTimes(2)

    dispose()
    runtimeEffectState.moduleUpdate.mockClear()
    selectedCharID.set(3)
    flushSync()
    expect(selIdState.selId).toBe(3)
    expect(runtimeEffectState.moduleUpdate).not.toHaveBeenCalled()

    dispose = installStoreRuntimeEffects()
    flushSync()
    expect(selIdState.selId).toBe(3)
    expect(runtimeEffectState.moduleUpdate).toHaveBeenCalledTimes(1)
  })

  it('uses the ready selected-character and Hypa preset owners for the auto-toggle side effect', async () => {
    const owner = { chaId: 'character-owner', chats: [], chatPage: 0, supaMemory: false }
    runtimeEffectState.charactersResourceState.characters = [owner]
    runtimeEffectState.charactersResourceState.currentChar = 0
    runtimeEffectState.charactersResourceState.selectionRevision = 1
    runtimeEffectState.database.characters = [{ chaId: 'stale-character', supaMemory: false }]
    runtimeEffectState.settingsResourceState.value.hypaV3 = true
    runtimeEffectState.settingsResourceState.value.hypaV3PresetId = 0
    runtimeEffectState.settingsResourceState.value.selectedHypaV3PresetId = 'preset-on'
    runtimeEffectState.collectionsResourceState.values.hypaV3Presets = [
      { id: 'preset-on', settings: { alwaysToggleOn: true } },
    ]

    dispose = installStoreRuntimeEffects()

    await vi.waitFor(() => {
      expect(runtimeEffectState.setCharacterSupaMemory).toHaveBeenCalledWith('character-owner', true)
    })
  })

  it('fails closed for a duplicate ready Hypa preset selection', async () => {
    const owner = { chaId: 'character-owner', chats: [], chatPage: 0, supaMemory: false }
    runtimeEffectState.charactersResourceState.characters = [owner]
    runtimeEffectState.charactersResourceState.currentChar = 0
    runtimeEffectState.charactersResourceState.selectionRevision = 1
    runtimeEffectState.settingsResourceState.value.hypaV3 = true
    runtimeEffectState.settingsResourceState.value.selectedHypaV3PresetId = 'preset-duplicate'
    runtimeEffectState.collectionsResourceState.values.hypaV3Presets = [
      { id: 'preset-duplicate', settings: { alwaysToggleOn: true } },
      { id: 'preset-duplicate', settings: { alwaysToggleOn: true } },
    ]

    dispose = installStoreRuntimeEffects()
    await Promise.resolve()

    expect(runtimeEffectState.setCharacterSupaMemory).not.toHaveBeenCalled()
  })

  it('ignores numeric Hypa compatibility selection while owners are loading', async () => {
    runtimeEffectState.database.characters = [
      { chaId: 'compatibility-character', chats: [], chatPage: 0, supaMemory: false },
    ]
    runtimeEffectState.database.hypaV3 = true
    runtimeEffectState.database.hypaV3PresetId = 0
    runtimeEffectState.database.hypaV3Presets = [{ settings: { alwaysToggleOn: true } }]
    runtimeEffectState.settingsResourceState.groupStatuses.memory = 'loading'
    runtimeEffectState.collectionsResourceState.statuses.hypaV3Presets = 'loading'
    runtimeEffectState.charactersResourceState.status = 'loading'
    selectedCharID.set(0)

    dispose = installStoreRuntimeEffects()

    await Promise.resolve()

    expect(runtimeEffectState.setCharacterSupaMemory).not.toHaveBeenCalled()
  })

  it('fails closed without running module updates when a required owner is in error', () => {
    runtimeEffectState.settingsResourceState.groupStatuses.modules = 'error'

    dispose = installStoreRuntimeEffects()
    flushSync()

    expect(runtimeEffectState.moduleUpdate).not.toHaveBeenCalled()
  })
})
