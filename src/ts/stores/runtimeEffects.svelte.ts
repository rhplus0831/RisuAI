import { moduleUpdate } from '../process/modules'
import { getResourceDatabase } from '../server/resourceState.svelte'
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

let disposeRuntimeEffects: (() => void) | null = null

export function installStoreRuntimeEffects(): () => void {
  if (disposeRuntimeEffects) return disposeRuntimeEffects

  const stopRoot = $effect.root(() => {
    const unsubscribeSelectedCharacter = selectedCharID.subscribe(() => {
      const database = getResourceDatabase()
      if (database.characters?.[selIdState.selId]) {
        if (database.hypaV3 && database.hypaV3Presets?.[database.hypaV3PresetId]?.settings?.alwaysToggleOn) {
          const character = database.characters[selIdState.selId]
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
      const database = getResourceDatabase()
      const character = database.characters?.[selIdState.selId]
      const chat = character?.chats?.[character.chatPage]
      const selectedPromptPreset = resolveUniquePromptPreset(
        database.promptPresets,
        chat?.generationSettings?.promptPresetId,
      )
      const effectiveAgentPresetId = Object.prototype.hasOwnProperty.call(
        chat?.generationSettings ?? {},
        'agentPresetId',
      )
        ? chat?.generationSettings?.agentPresetId
        : database.agentPresetDefaultId
      const selectedAgentPreset = database.agentPresets?.find((preset) => preset.id === effectiveAgentPresetId)
      readModuleUpdateSignals(database.modules)
      database.enabledModules
      database.enabledModules?.length
      chat?.modules?.length
      chat?.generationSettings?.promptPresetId
      chat?.generationSettings?.agentPresetId
      selectedPromptPreset?.moduleIntergration
      database.agentPresetDefaultId
      selectedAgentPreset?.enabled
      selectedAgentPreset?.moduleIntergration
      character?.hideChatIcon
      character?.backgroundHTML
      database.moduleIntergration
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
