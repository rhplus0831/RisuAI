import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  charactersResourceState,
  collectionsResourceState,
  settingsResourceState,
} from '../server/resourceState.svelte'
import { getActiveModuleReadModules, getModuleReadDatabase } from './moduleReadDatabase.svelte'
import { invalidateModuleRenderRevision } from '../moduleRenderRevision'
import type { character } from '../storage/database.svelte'

vi.mock('../chatCommands', () => ({
  dispatchSaveChatGenerationSettings: vi.fn(),
  dispatchSaveChatGenerationSettingsWithOutcome: vi.fn(),
  isActiveChatTargetFresh: vi.fn(),
}))

beforeEach(() => {
  settingsResourceState.status = 'ready'
  settingsResourceState.groupStatuses = { modules: 'ready', agents: 'ready', prompt: 'ready' }
  settingsResourceState.value = { enabledModules: ['global'], agents: [], agentPresets: [], moduleIntergration: '' }
  collectionsResourceState.status = 'ready'
  collectionsResourceState.statuses = { modules: 'ready', personas: 'ready', promptPresets: 'ready' }
  collectionsResourceState.values = {
    modules: ['global', 'chat', 'persona', 'prompt', 'agent'].map((id) => ({ id, name: id, description: '' })),
    personas: [{ id: 'persona-owner', modules: ['persona'] } as never],
    promptPresets: [{ id: 'prompt-owner', moduleIntergration: 'prompt' } as never],
  }
  charactersResourceState.status = 'ready'
  charactersResourceState.rowStatuses = { a: 'ready', b: 'ready' }
  charactersResourceState.characters = [
    {
      chaId: 'a',
      chatPage: 0,
      chats: [
        {
          id: 'chat-a',
          modules: ['chat'],
          generationSettings: { personaId: 'persona-owner', promptPresetId: 'prompt-owner' },
        },
      ],
    },
    { chaId: 'b', chatPage: 0, chats: [{ id: 'chat-b', modules: [], generationSettings: {} }] },
  ] as character[]
  charactersResourceState.currentChar = 0
})

describe('module display reads', () => {
  it('preserves activation sources and refreshes on selection, in-place edits and rollback', () => {
    settingsResourceState.value.agentPresetDefaultId = 'agent-owner'
    settingsResourceState.value.agentPresets = [
      { id: 'agent-owner', enabled: true, moduleIntergration: 'agent' },
    ] as never
    const ids = () => getActiveModuleReadModules().map((module) => module.id)
    expect(ids()).toEqual(['global', 'chat', 'persona', 'prompt', 'agent'])
    charactersResourceState.currentChar = 1
    expect(ids()).toEqual(['global', 'agent'])
    charactersResourceState.currentChar = 0
    expect(ids()).toEqual(['global', 'chat', 'persona', 'prompt', 'agent'])
    collectionsResourceState.values.personas![0].modules = []
    expect(ids()).toEqual(['global', 'chat', 'prompt', 'agent'])
    collectionsResourceState.values.personas![0].modules = ['persona']
    invalidateModuleRenderRevision()
    expect(ids()).toEqual(['global', 'chat', 'persona', 'prompt', 'agent'])
  })

  it('fails closed on stale collections and ambiguous chat ownership', () => {
    collectionsResourceState.statuses.modules = 'loading'
    expect(getActiveModuleReadModules()).toEqual([])
    collectionsResourceState.statuses.modules = 'ready'
    charactersResourceState.characters[1].chats[0].id = 'chat-a'
    expect(getActiveModuleReadModules().map((module) => module.id)).toEqual(['global'])
    charactersResourceState.characters[1].chats[0].id = 'chat-b'
    expect(getActiveModuleReadModules().map((module) => module.id)).toEqual(['global', 'chat', 'persona', 'prompt'])
    collectionsResourceState.values.modules!.push({ id: 'global', name: '', description: '' })
    expect(getActiveModuleReadModules()).toEqual([])
  })

  it('shares reads without enumerating unrelated settings or repeating collection validation', () => {
    let reads = 0
    const settings = { ...settingsResourceState.value }
    Object.defineProperty(settings, 'temperature', {
      get: () => {
        throw new Error('unrelated setting')
      },
    })
    settingsResourceState.value = settings
    const module = { id: 'global', name: 'global', description: '' }
    Object.defineProperty(module, 'id', {
      get: () => {
        reads++
        return 'global'
      },
    })
    collectionsResourceState.values.modules = [module]
    const first = getActiveModuleReadModules()
    const initialReads = reads
    for (let row = 0; row < 60; row++) {
      expect(getActiveModuleReadModules()).toBe(first)
      expect(getModuleReadDatabase().modules).toBe(collectionsResourceState.values.modules)
    }
    expect(reads).toBe(initialReads)
  })
})
