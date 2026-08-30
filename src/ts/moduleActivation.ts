import { resolveEffectiveAgentPresetId } from './agentPresetResolver'
import { parseModuleIntegration, resolveAgentPresetModuleIntegration } from '@risuai/shared-core/module-integration'
import { resolvePersonaModuleIds } from './personaModuleLinks'
import { resolveUniquePromptPreset } from '@risuai/shared-core/effective-prompt-template'
import type { Chat, Database, character } from './storage/database.svelte'
import {
  MODULE_ACTIVATION_SOURCES,
  hasModuleActivationIdentifiers,
  moduleActivationIdentifiersKey,
  resolveModuleActivationStates,
} from '@risuai/shared-core/module-activation'
import type { ModuleActivationIdentifiers, ModuleActivationState } from '@risuai/shared-core/module-activation'
export {
  MODULE_ACTIVATION_SOURCES,
  hasModuleActivationIdentifiers,
  moduleActivationIdentifiersKey,
  resolveModuleActivationStates,
} from '@risuai/shared-core/module-activation'
export type {
  ModuleActivationIdentifiers,
  ModuleActivationReference,
  ModuleActivationSource,
  ModuleActivationState,
  ResolveModuleActivationStatesInput,
} from '@risuai/shared-core/module-activation'

function selectedPromptPresetModuleIntegration(
  database: Database,
  chat: Chat | undefined,
): { source: 'promptPresetIntegration' | 'legacyIntegration'; value: unknown } {
  const promptPresetId = chat?.generationSettings?.promptPresetId
  if (typeof promptPresetId === 'string' && promptPresetId.trim().length > 0) {
    const preset = resolveUniquePromptPreset(database.promptPresets, promptPresetId)
    return {
      source: 'promptPresetIntegration',
      value: preset?.moduleIntergration,
    }
  }
  return {
    source: 'legacyIntegration',
    value: database.moduleIntergration,
  }
}

export function resolveActiveModuleIdentifiers(
  database: Database,
  currentCharacter: character | undefined,
  currentChat: Chat | undefined,
): ModuleActivationIdentifiers {
  const promptPresetIntegration = selectedPromptPresetModuleIntegration(database, currentChat)
  const agentPresetIntegration = resolveAgentPresetModuleIntegration(
    database.agentPresets,
    resolveEffectiveAgentPresetId(database, currentChat?.generationSettings),
  )

  return {
    global: database.enabledModules,
    chat: currentChat?.modules,
    character: currentCharacter?.modules,
    persona: resolvePersonaModuleIds(database, currentChat),
    [promptPresetIntegration.source]: parseModuleIntegration(promptPresetIntegration.value),
    agentPresetIntegration: parseModuleIntegration(agentPresetIntegration),
  }
}

export function resolveActiveModuleStates(
  database: Database,
  currentCharacter: character | undefined,
  currentChat: Chat | undefined,
): ModuleActivationState<Database['modules'][number]>[] {
  return resolveModuleActivationStates({
    modules: database.modules ?? [],
    identifiers: resolveActiveModuleIdentifiers(database, currentCharacter, currentChat),
  })
}
