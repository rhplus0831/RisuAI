import { get } from 'svelte/store'
import { moduleUpdate } from '../process/modules'
import { getSelectedCharacterOwner, selectCharacterOwner } from '../characterState'
import type { Chat, character, Database } from '../storage/database.svelte'
import {
  charactersResourceState,
  collectionsResourceState,
  getCharacterResourceOwner,
  getChatMetadataOwnerState,
  settingsResourceState,
  type ServerCollectionName,
} from '../server/resourceState.svelte'
import type { SettingsGroup } from '@risuai/shared-core/settings-groups'
import { hypaV3PresetIndexFromStableId } from '@risuai/shared-core/hypa-v3-preset-selection-identity'
import { selectedCharID, selIdState } from './coreStores.svelte'

// This effect used to register its dependency on the modules array via a
// whole-value snapshot. Read only the fields consumed by moduleUpdate(), plus
// array length for additions and removals.
export interface ModuleUpdateSignalSource {
  id?: string
  hideIcon?: boolean
  backgroundEmbedding?: string
}

export function resolveUniquePromptPreset(
  promptPresets: readonly { id?: unknown }[] | undefined,
  promptPresetId: unknown,
): { id?: unknown; moduleIntergration?: unknown } | undefined {
  if (!Array.isArray(promptPresets) || typeof promptPresetId !== 'string' || promptPresetId.trim() === '') {
    return undefined
  }
  const matches = promptPresets.filter((preset) => preset?.id === promptPresetId)
  return matches.length === 1 ? matches[0] : undefined
}

export function resolveUniqueAgentPreset(
  agentPresets: readonly { id?: unknown }[] | undefined,
  agentPresetId: unknown,
): { id?: unknown; enabled?: unknown; moduleIntergration?: unknown } | undefined {
  if (!Array.isArray(agentPresets) || typeof agentPresetId !== 'string' || agentPresetId.trim() === '') {
    return undefined
  }
  const matches = agentPresets.filter((preset) => preset?.id === agentPresetId)
  return matches.length === 1 ? matches[0] : undefined
}

export function readModuleUpdateSignals(modules: readonly ModuleUpdateSignalSource[] | undefined): void {
  if (!modules) return
  void modules.length
  for (const module of modules) {
    void module?.id
    void module?.hideIcon
    void module?.backgroundEmbedding
  }
}

function isServerCharacterShellRow(character: unknown): boolean {
  return (
    !!character &&
    typeof character === 'object' &&
    !Array.isArray(character) &&
    (character as { __serverCharacterShell?: unknown }).__serverCharacterShell === true
  )
}

function settingsGroupOwner(group: SettingsGroup): Partial<Database> | undefined {
  const status = settingsResourceState.groupStatuses[group] ?? 'idle'
  if (status === 'ready') return settingsResourceState.value as Partial<Database>
  return undefined
}

function collectionOwner<Name extends ServerCollectionName>(name: Name): Database[Name] | undefined {
  const status = collectionsResourceState.statuses[name] ?? 'idle'
  if (status === 'ready') return collectionsResourceState.values[name] as Database[Name] | undefined
  return undefined
}

function selectedRuntimeCharacterOwner(): character | undefined {
  const status = charactersResourceState.status
  if (status === 'ready') {
    const owner =
      charactersResourceState.selectionRevision !== null
        ? getSelectedCharacterOwner()
        : selectCharacterOwner(charactersResourceState.characters, get(selectedCharID))
    return owner?.chaId && getCharacterResourceOwner(owner.chaId) === owner ? owner : undefined
  }
  return undefined
}

function selectedRuntimeChatOwner(character: character | undefined): Chat | undefined {
  const candidate = character?.chats?.[character.chatPage]
  if (!candidate?.id) return undefined
  if (charactersResourceState.status === 'ready') {
    return getChatMetadataOwnerState(candidate.id)?.chatId === candidate.id ? candidate : undefined
  }
  return undefined
}

function runtimeOwnerFailed(): boolean {
  if (charactersResourceState.status === 'error') return true
  if (['modules', 'advanced', 'agents'].some((group) => settingsResourceState.groupStatuses[group] === 'error')) {
    return true
  }
  return ['modules', 'promptPresets'].some((name) => collectionsResourceState.statuses[name] === 'error')
}

function selectedRuntimeHypaV3Preset(
  memorySettings: Partial<Database> | undefined,
  hypaV3Presets: Database['hypaV3Presets'] | undefined,
): Database['hypaV3Presets'][number] | undefined {
  if (!memorySettings || !Array.isArray(hypaV3Presets)) return undefined
  const memoryStatus = settingsResourceState.groupStatuses.memory ?? 'idle'
  const presetStatus = collectionsResourceState.statuses.hypaV3Presets ?? 'idle'
  if (memoryStatus === 'ready' && presetStatus === 'ready') {
    const index = hypaV3PresetIndexFromStableId({
      selectedHypaV3PresetId: memorySettings.selectedHypaV3PresetId,
      hypaV3Presets,
    })
    return index >= 0 ? hypaV3Presets[index] : undefined
  }
  return undefined
}

let disposeRuntimeEffects: (() => void) | null = null

export function installStoreRuntimeEffects(): () => void {
  if (disposeRuntimeEffects) return disposeRuntimeEffects

  const stopRoot = $effect.root(() => {
    const unsubscribeSelectedCharacter = selectedCharID.subscribe(() => {
      const character = selectedRuntimeCharacterOwner()
      if (character) {
        const memorySettings = settingsGroupOwner('memory')
        const hypaV3Presets = collectionOwner('hypaV3Presets')
        const selectedHypaV3Preset = selectedRuntimeHypaV3Preset(memorySettings, hypaV3Presets)
        if (memorySettings?.hypaV3 && selectedHypaV3Preset?.settings?.alwaysToggleOn) {
          if (!isServerCharacterShellRow(character) && !character.supaMemory && character.chaId) {
            const characterId = character.chaId
            void import('../characterCommands').then(({ setCharacterSupaMemory }) => {
              setCharacterSupaMemory(characterId, true)
            })
          }
        }
      }
    })

    $effect(() => {
      void selIdState.selId
      if (runtimeOwnerFailed()) return
      const character = selectedRuntimeCharacterOwner()
      const chat = selectedRuntimeChatOwner(character)
      const promptPresets = collectionOwner('promptPresets')
      const modules = collectionOwner('modules')
      const moduleSettings = settingsGroupOwner('modules')
      const advancedSettings = settingsGroupOwner('advanced')
      const agentSettings = settingsGroupOwner('agents')
      if (!promptPresets || !modules || !moduleSettings || !advancedSettings || !agentSettings) return
      const selectedPromptPreset = resolveUniquePromptPreset(promptPresets, chat?.generationSettings?.promptPresetId)
      const effectiveAgentPresetId = Object.prototype.hasOwnProperty.call(
        chat?.generationSettings ?? {},
        'agentPresetId',
      )
        ? chat?.generationSettings?.agentPresetId
        : agentSettings.agentPresetDefaultId
      const selectedAgentPreset = resolveUniqueAgentPreset(agentSettings.agentPresets, effectiveAgentPresetId)
      readModuleUpdateSignals(modules)
      moduleSettings.enabledModules
      moduleSettings.enabledModules?.length
      chat?.modules?.length
      chat?.generationSettings?.promptPresetId
      chat?.generationSettings?.agentPresetId
      selectedPromptPreset?.moduleIntergration
      agentSettings.agentPresetDefaultId
      selectedAgentPreset?.enabled
      selectedAgentPreset?.moduleIntergration
      character?.hideChatIcon
      character?.backgroundHTML
      advancedSettings.moduleIntergration
      moduleUpdate()
    })

    return unsubscribeSelectedCharacter
  })

  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    stopRoot()
    if (disposeRuntimeEffects === dispose) disposeRuntimeEffects = null
  }
  disposeRuntimeEffects = dispose
  return dispose
}
