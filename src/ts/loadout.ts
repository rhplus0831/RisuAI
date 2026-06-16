import { runOptimisticCommandSequence } from './chatCommands'
import {
  applyPersonaStateSnapshotLocally,
  currentPersonaStateSnapshot,
  selectUserPersonaLocally,
  type PersonaStateSnapshot,
} from './persona'
import { safeStructuredClone } from './polyfill'
import {
  canUseServerCommands,
  createLoadoutCommand,
  deleteLoadoutCommand,
  enableModuleCommand,
  favoriteLoadoutCommand,
  patchSettingsGroup,
  runServerCommand,
  selectModelPresetCommand,
  selectPromptPresetCommand,
  selectPersonaCommand,
  selectPresetCommand,
  settingsGroupForKey,
  touchLoadoutCommand,
  type LoadoutSnapshot,
  type ServerCommandResult,
} from './server/commands'
import { withTrustedServerProjectionWrite } from './server/projectionWriteGuard.svelte'
import {
  applyModelPresetFieldsToDatabase,
  applyPromptPresetFieldsToDatabase,
  ensureBotPresetHydrated,
  getCurrentCharacter,
  setPreset,
  type Database,
  type ModelPreset,
  type PromptPreset,
  type botPreset,
} from './storage/database.svelte'
import { DBState } from './stores.svelte'

export type Loadout = {
  name: string
  id: string
  lastUsed: number
  favorite: boolean
  characterIds: string[]
  modules: string[]
  globalVariables: { [key: string]: string }
  presetName: string
  modelPresetId?: string
  modelPresetName?: string
  promptPresetId?: string
  promptPresetName?: string
  personaId: string
}

export function makeLoadout(options: { name: string }): Loadout {
  const character = getCurrentCharacter()
  const id = crypto.randomUUID()
  const legacyPreset = DBState.db.botPresets?.[DBState.db.botPresetsId]
  const modelPreset = DBState.db.modelPresets?.[DBState.db.modelPresetsId]
  const promptPreset = DBState.db.promptPresets?.[DBState.db.promptPresetsId]
  const legacyPresetName = readablePresetName(legacyPreset)
  const modelPresetName = readablePresetName(modelPreset)
  const promptPresetName = readablePresetName(promptPreset)
  return safeStructuredClone({
    name: options.name,
    id: id,
    lastUsed: Date.now(),
    favorite: false,
    characterIds: character ? [character.chaId] : [],
    modules: DBState.db.enabledModules,
    globalVariables: DBState.db.globalChatVariables,
    presetName: legacyPresetName || [modelPresetName, promptPresetName].filter(Boolean).join(' / '),
    modelPresetId: nonBlankId(modelPreset?.id) ?? '',
    modelPresetName,
    promptPresetId: nonBlankId(promptPreset?.id) ?? '',
    promptPresetName,
    personaId: DBState.db.personas[DBState.db.selectedPersona]?.id,
  })
}

type LoadoutApplyOption = 'modules' | 'globalVariables' | 'preset' | 'persona'

export interface LoadoutStateSnapshot {
  loadouts: Loadout[]
  lastLoadedLoadoutName: string
}

type ServerCommandFactory = (baseRevision: number) => Promise<ServerCommandResult>

interface PresetApplySnapshot {
  botPresets: botPreset[]
  botPresetsId: number
  modelPresets: ModelPreset[]
  modelPresetsId: number
  promptPresets: PromptPreset[]
  promptPresetsId: number
  setPresetSettings: Partial<Record<SetPresetRollbackKey, unknown>>
}

interface LoadoutApplyStateSnapshot {
  loadout: LoadoutStateSnapshot
  persona?: PersonaStateSnapshot
  preset?: PresetApplySnapshot
  enabledModules?: string[]
  globalChatVariables?: { [key: string]: string }
}

const SET_PRESET_ROLLBACK_KEYS = [
  'apiType',
  'openAIKey',
  'localNetworkMode',
  'localNetworkTimeoutSec',
  'additionalParams',
  'mainPrompt',
  'jailbreak',
  'globalNote',
  'temperature',
  'maxContext',
  'maxResponse',
  'frequencyPenalty',
  'PresensePenalty',
  'formatingOrder',
  'aiModel',
  'subModel',
  'currentPluginProvider',
  'textgenWebUIStreamURL',
  'textgenWebUIBlockingURL',
  'forceReplaceUrl',
  'promptPreprocess',
  'bias',
  'koboldURL',
  'proxyKey',
  'ooba',
  'ainconfig',
  'openrouterRequestModel',
  'proxyRequestModel',
  'NAIsettings',
  'autoSuggestPrompt',
  'autoSuggestPrefix',
  'autoSuggestClean',
  'promptTemplate',
  'NAIadventure',
  'NAIappendName',
  'localStopStrings',
  'customProxyRequestModel',
  'reverseProxyOobaArgs',
  'top_p',
  'promptSettings',
  'repetition_penalty',
  'min_p',
  'top_a',
  'openrouterProvider',
  'useInstructPrompt',
  'customPromptTemplateToggle',
  'templateDefaultVariables',
  'moduleIntergration',
  'top_k',
  'instructChatTemplate',
  'JinjaTemplate',
  'jsonSchemaEnabled',
  'jsonSchema',
  'strictJsonSchema',
  'extractJson',
  'seperateParametersEnabled',
  'customAPIFormat',
  'systemContentReplacement',
  'systemRoleReplacement',
  'customFlags',
  'enableCustomFlags',
  'presetRegex',
  'reasoningEffort',
  'thinkingTokens',
  'thinkingType',
  'deepseekThinkingType',
  'adaptiveThinkingEffort',
  'deepseekReasoningEffort',
  'outputImageModal',
  'seperateModelsForAxModels',
  'seperateModels',
  'fallbackModels',
  'fallbackWhenBlankResponse',
  'seperateParameters',
  'modelTools',
  'verbosity',
  'dynamicOutput',
] as const satisfies readonly (keyof Database)[]

type SetPresetRollbackKey = (typeof SET_PRESET_ROLLBACK_KEYS)[number]

const PRESET_SNAPSHOT_KEY_PAIRS: Array<[string, string]> = [
  ['name', 'name'],
  ['apiType', 'apiType'],
  ['openAIKey', 'openAIKey'],
  ['localNetworkMode', 'localNetworkMode'],
  ['localNetworkTimeoutSec', 'localNetworkTimeoutSec'],
  ['mainPrompt', 'mainPrompt'],
  ['jailbreak', 'jailbreak'],
  ['globalNote', 'globalNote'],
  ['temperature', 'temperature'],
  ['maxContext', 'maxContext'],
  ['maxResponse', 'maxResponse'],
  ['frequencyPenalty', 'frequencyPenalty'],
  ['PresensePenalty', 'PresensePenalty'],
  ['formatingOrder', 'formatingOrder'],
  ['aiModel', 'aiModel'],
  ['subModel', 'subModel'],
  ['currentPluginProvider', 'currentPluginProvider'],
  ['textgenWebUIStreamURL', 'textgenWebUIStreamURL'],
  ['textgenWebUIBlockingURL', 'textgenWebUIBlockingURL'],
  ['forceReplaceUrl', 'forceReplaceUrl'],
  ['promptPreprocess', 'promptPreprocess'],
  ['bias', 'bias'],
  ['koboldURL', 'koboldURL'],
  ['proxyKey', 'proxyKey'],
  ['ooba', 'ooba'],
  ['ainconfig', 'ainconfig'],
  ['proxyRequestModel', 'proxyRequestModel'],
  ['openrouterRequestModel', 'openrouterRequestModel'],
  ['NAISettings', 'NAIsettings'],
  ['promptTemplate', 'promptTemplate'],
  ['NAIadventure', 'NAIadventure'],
  ['NAIappendName', 'NAIappendName'],
  ['localStopStrings', 'localStopStrings'],
  ['autoSuggestPrompt', 'autoSuggestPrompt'],
  ['customProxyRequestModel', 'customProxyRequestModel'],
  ['reverseProxyOobaArgs', 'reverseProxyOobaArgs'],
  ['top_p', 'top_p'],
  ['promptSettings', 'promptSettings'],
  ['repetition_penalty', 'repetition_penalty'],
  ['min_p', 'min_p'],
  ['top_a', 'top_a'],
  ['openrouterProvider', 'openrouterProvider'],
  ['useInstructPrompt', 'useInstructPrompt'],
  ['customPromptTemplateToggle', 'customPromptTemplateToggle'],
  ['templateDefaultVariables', 'templateDefaultVariables'],
  ['moduleIntergration', 'moduleIntergration'],
  ['top_k', 'top_k'],
  ['instructChatTemplate', 'instructChatTemplate'],
  ['JinjaTemplate', 'JinjaTemplate'],
  ['jsonSchemaEnabled', 'jsonSchemaEnabled'],
  ['jsonSchema', 'jsonSchema'],
  ['strictJsonSchema', 'strictJsonSchema'],
  ['extractJson', 'extractJson'],
  ['seperateParametersEnabled', 'seperateParametersEnabled'],
  ['seperateParameters', 'seperateParameters'],
  ['customAPIFormat', 'customAPIFormat'],
  ['systemContentReplacement', 'systemContentReplacement'],
  ['systemRoleReplacement', 'systemRoleReplacement'],
  ['customFlags', 'customFlags'],
  ['enableCustomFlags', 'enableCustomFlags'],
  ['regex', 'presetRegex'],
  ['reasonEffort', 'reasoningEffort'],
  ['thinkingTokens', 'thinkingTokens'],
  ['thinkingType', 'thinkingType'],
  ['deepseekThinkingType', 'deepseekThinkingType'],
  ['adaptiveThinkingEffort', 'adaptiveThinkingEffort'],
  ['deepseekReasoningEffort', 'deepseekReasoningEffort'],
  ['outputImageModal', 'outputImageModal'],
  ['seperateModelsForAxModels', 'seperateModelsForAxModels'],
  ['seperateModels', 'seperateModels'],
  ['modelTools', 'modelTools'],
  ['fallbackModels', 'fallbackModels'],
  ['fallbackWhenBlankResponse', 'fallbackWhenBlankResponse'],
  ['verbosity', 'verbosity'],
  ['dynamicOutput', 'dynamicOutput'],
]

function cloneJsonValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function snapshotJson(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

export function currentLoadoutStateSnapshot(): LoadoutStateSnapshot {
  return {
    loadouts: cloneJsonValue(DBState.db.loadouts ?? []),
    lastLoadedLoadoutName: DBState.db.lastLoadedLoadoutName,
  }
}

export function restoreLoadoutState(snapshot: LoadoutStateSnapshot): void {
  withTrustedServerProjectionWrite(() => {
    DBState.db.loadouts = cloneJsonValue(snapshot.loadouts)
    DBState.db.lastLoadedLoadoutName = snapshot.lastLoadedLoadoutName
  })
}

function currentPresetApplySnapshot(): PresetApplySnapshot {
  const dbRecord = DBState.db as unknown as Record<SetPresetRollbackKey, unknown>
  const setPresetSettings: Partial<Record<SetPresetRollbackKey, unknown>> = {}
  for (const key of SET_PRESET_ROLLBACK_KEYS) {
    setPresetSettings[key] = cloneJsonValue(dbRecord[key])
  }
  return {
    botPresets: cloneJsonValue(DBState.db.botPresets ?? []),
    botPresetsId: DBState.db.botPresetsId,
    modelPresets: cloneJsonValue(DBState.db.modelPresets ?? []),
    modelPresetsId: DBState.db.modelPresetsId,
    promptPresets: cloneJsonValue(DBState.db.promptPresets ?? []),
    promptPresetsId: DBState.db.promptPresetsId,
    setPresetSettings,
  }
}

function restoreLoadoutApplyState(snapshot: LoadoutApplyStateSnapshot): void {
  if (snapshot.persona) {
    applyPersonaStateSnapshotLocally(snapshot.persona)
  }

  withTrustedServerProjectionWrite(() => {
    DBState.db.loadouts = cloneJsonValue(snapshot.loadout.loadouts)
    DBState.db.lastLoadedLoadoutName = snapshot.loadout.lastLoadedLoadoutName

    if (snapshot.preset) {
      DBState.db.botPresets = cloneJsonValue(snapshot.preset.botPresets)
      DBState.db.botPresetsId = snapshot.preset.botPresetsId
      DBState.db.modelPresets = cloneJsonValue(snapshot.preset.modelPresets)
      DBState.db.modelPresetsId = snapshot.preset.modelPresetsId
      DBState.db.promptPresets = cloneJsonValue(snapshot.preset.promptPresets)
      DBState.db.promptPresetsId = snapshot.preset.promptPresetsId
      const dbRecord = DBState.db as unknown as Record<SetPresetRollbackKey, unknown>
      for (const key of SET_PRESET_ROLLBACK_KEYS) {
        if (Object.hasOwn(snapshot.preset.setPresetSettings, key)) {
          dbRecord[key] = cloneJsonValue(snapshot.preset.setPresetSettings[key])
        }
      }
    }

    if (snapshot.enabledModules) {
      DBState.db.enabledModules = cloneJsonValue(snapshot.enabledModules)
    }

    if (snapshot.globalChatVariables) {
      DBState.db.globalChatVariables = cloneJsonValue(snapshot.globalChatVariables)
    }
  })
}

function runLoadoutCommand<T extends Record<string, unknown>>(
  command: (baseRevision: number) => Promise<ServerCommandResult<T>>,
  rollback: () => void,
): void {
  if (!canUseServerCommands()) return
  void runServerCommand({ command, rollback })
}

function toLoadoutSnapshot(loadout: Loadout): LoadoutSnapshot {
  return cloneJsonValue(loadout) as LoadoutSnapshot
}

function readablePresetName(preset: { name?: unknown } | undefined): string {
  return typeof preset?.name === 'string' ? preset.name : ''
}

function dispatchCreateLoadout(loadout: Loadout, previous: LoadoutStateSnapshot): void {
  runLoadoutCommand(
    (baseRevision) =>
      createLoadoutCommand({
        baseRevision,
        loadout: toLoadoutSnapshot(loadout),
      }),
    () => restoreLoadoutState(previous),
  )
}

function dispatchDeleteLoadout(loadoutId: string, previous: LoadoutStateSnapshot): void {
  runLoadoutCommand(
    (baseRevision) =>
      deleteLoadoutCommand({
        baseRevision,
        loadoutId,
      }),
    () => restoreLoadoutState(previous),
  )
}

function dispatchFavoriteLoadout(loadoutId: string, favorite: boolean, previous: LoadoutStateSnapshot): void {
  runLoadoutCommand(
    (baseRevision) =>
      favoriteLoadoutCommand({
        baseRevision,
        loadoutId,
        favorite,
      }),
    () => restoreLoadoutState(previous),
  )
}

export function toggleLoadoutFavorite(loadoutId: string): boolean {
  const loadout = DBState.db.loadouts?.find((item) => item.id === loadoutId)
  if (!loadout) return false

  const previous = currentLoadoutStateSnapshot()
  const favorite = !loadout.favorite
  withTrustedServerProjectionWrite(() => {
    const targetLoadout = DBState.db.loadouts.find((item) => item.id === loadoutId)
    if (!targetLoadout) return
    targetLoadout.favorite = favorite
  })
  dispatchFavoriteLoadout(loadoutId, favorite, previous)
  return true
}

export function deleteLoadout(loadoutId: string): boolean {
  const index = DBState.db.loadouts?.findIndex((loadout) => loadout.id === loadoutId) ?? -1
  if (index === -1) return false

  const previous = currentLoadoutStateSnapshot()
  withTrustedServerProjectionWrite(() => {
    const targetIndex = DBState.db.loadouts.findIndex((loadout) => loadout.id === loadoutId)
    if (targetIndex !== -1) {
      DBState.db.loadouts.splice(targetIndex, 1)
    }
  })
  dispatchDeleteLoadout(loadoutId, previous)
  return true
}

function nonBlankId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function resolvePersonaSelection(personaId: string): { index: number; personaId: string } | null {
  const personas = DBState.db.personas ?? []
  const seen = new Set<string>()
  for (const persona of personas) {
    const id = nonBlankId(persona?.id)
    if (!id || seen.has(id)) return null
    seen.add(id)
  }

  const index = personas.findIndex((persona) => persona.id === personaId)
  return index >= 0 ? { index, personaId } : null
}

function resolveSplitPresetSelection<T extends { id?: string; name?: string }>(
  presets: T[] | undefined,
  presetId: string | undefined,
  presetName: string | undefined,
): { index: number; presetId: string } | null {
  if (!Array.isArray(presets)) return null

  const requestedId = nonBlankId(presetId)
  if (requestedId) {
    const index = presets.findIndex((preset) => preset?.id === requestedId)
    if (index >= 0) return { index, presetId: requestedId }
  }

  const requestedName = typeof presetName === 'string' && presetName.trim().length > 0 ? presetName : null
  if (!requestedName) return null

  const index = presets.findIndex((preset) => preset?.name === requestedName)
  const resolvedId = index >= 0 ? nonBlankId(presets[index]?.id) : null
  return index >= 0 && resolvedId ? { index, presetId: resolvedId } : null
}

function loadoutHasSplitPresetReference(loadout: Loadout): boolean {
  return (
    !!nonBlankId(loadout.modelPresetId) ||
    !!nonBlankId(loadout.promptPresetId) ||
    (typeof loadout.modelPresetName === 'string' && loadout.modelPresetName.trim().length > 0) ||
    (typeof loadout.promptPresetName === 'string' && loadout.promptPresetName.trim().length > 0)
  )
}

function ensureBotPresetCommandIds(): void {
  const presets = DBState.db.botPresets
  if (!Array.isArray(presets)) {
    DBState.db.botPresets = []
    DBState.db.botPresetsId = -1
    return
  }

  const seen = new Set<string>()
  for (const preset of presets) {
    if (!preset) continue
    const currentId = nonBlankId(preset.id) ?? crypto.randomUUID()
    const nextId = seen.has(currentId) ? crypto.randomUUID() : currentId
    preset.id = nextId
    seen.add(nextId)
  }

  DBState.db.botPresetsId = normalizedBotPresetsId(presets.length, DBState.db.botPresetsId)
}

function normalizedBotPresetsId(presetCount: number, selected: unknown): number {
  if (!Number.isInteger(selected)) return presetCount > 0 ? 0 : -1

  const index = selected as number
  if (index >= presetCount) return presetCount > 0 ? presetCount - 1 : -1
  if (index < -1) return presetCount > 0 ? 0 : -1
  return index
}

function saveCurrentPresetSnapshotLocal(): void {
  const db = DBState.db
  const index = db.botPresetsId
  const presets = db.botPresets
  if (!Array.isArray(presets) || index < 0 || index >= presets.length) return

  const current = presets[index]
  const snapshot: Record<string, unknown> = {
    id: current.id,
    name: typeof current.name === 'string' ? current.name : 'New Preset',
  }
  const dbRecord = db as unknown as Record<string, unknown>
  for (const [presetKey, databaseKey] of PRESET_SNAPSHOT_KEY_PAIRS) {
    if (presetKey === 'name') continue
    if (Object.prototype.hasOwnProperty.call(dbRecord, databaseKey)) {
      snapshot[presetKey] = cloneJsonValue(dbRecord[databaseKey])
    }
  }
  snapshot.image = current.image ?? ''
  snapshot.seperateModelsForAxModels = db.doNotChangeSeperateModels ? false : (db.seperateModelsForAxModels ?? false)
  snapshot.seperateModels = db.doNotChangeSeperateModels ? null : cloneJsonValue(db.seperateModels)
  snapshot.fallbackWhenBlankResponse = db.fallbackWhenBlankResponse ?? false
  presets[index] = snapshot as unknown as botPreset
}

function presetHasHydratedSettings(preset: botPreset | undefined): preset is botPreset {
  return !!preset?.id && Object.prototype.hasOwnProperty.call(preset, 'promptTemplate')
}

function changedModuleFactories(previousModules: string[], nextModules: string[]): ServerCommandFactory[] {
  const previousSet = new Set(previousModules)
  const nextSet = new Set(nextModules)
  const enabled = Array.from(nextSet)
    .filter((moduleId) => !previousSet.has(moduleId))
    .sort()
  const disabled = Array.from(previousSet)
    .filter((moduleId) => !nextSet.has(moduleId))
    .sort()

  return [
    ...enabled.map(
      (moduleId): ServerCommandFactory =>
        (baseRevision) =>
          enableModuleCommand({
            baseRevision,
            moduleId,
            enabled: true,
          }),
    ),
    ...disabled.map(
      (moduleId): ServerCommandFactory =>
        (baseRevision) =>
          enableModuleCommand({
            baseRevision,
            moduleId,
            enabled: false,
          }),
    ),
  ]
}

export function applyLoadout(
  loadout: Loadout,
  apply: LoadoutApplyOption[] = ['modules', 'globalVariables', 'preset', 'persona'],
) {
  const requested = new Set(apply)
  const personaSelection = requested.has('persona') ? resolvePersonaSelection(loadout.personaId) : null
  const useSplitPresetSelection = requested.has('preset') && loadoutHasSplitPresetReference(loadout)
  const modelPresetSelection = useSplitPresetSelection
    ? resolveSplitPresetSelection(DBState.db.modelPresets, loadout.modelPresetId, loadout.modelPresetName)
    : null
  const promptPresetSelection = useSplitPresetSelection
    ? resolveSplitPresetSelection(DBState.db.promptPresets, loadout.promptPresetId, loadout.promptPresetName)
    : null
  const presetIndex =
    requested.has('preset') && !useSplitPresetSelection
      ? (DBState.db.botPresets?.findIndex((preset) => preset.name === loadout.presetName) ?? -1)
      : -1
  const previousModules = cloneJsonValue(DBState.db.enabledModules ?? [])
  const nextModules = cloneJsonValue(loadout.modules ?? [])
  const previousGlobalChatVariables = cloneJsonValue(DBState.db.globalChatVariables ?? {})
  const nextGlobalChatVariables = cloneJsonValue(loadout.globalVariables ?? {})
  const globalVariablesChanged = snapshotJson(previousGlobalChatVariables) !== snapshotJson(nextGlobalChatVariables)
  const previous: LoadoutApplyStateSnapshot = {
    loadout: currentLoadoutStateSnapshot(),
    ...(personaSelection ? { persona: currentPersonaStateSnapshot() } : {}),
    ...(presetIndex >= 0 || modelPresetSelection || promptPresetSelection
      ? { preset: currentPresetApplySnapshot() }
      : {}),
    ...(requested.has('modules') ? { enabledModules: previousModules } : {}),
    ...(requested.has('globalVariables') ? { globalChatVariables: previousGlobalChatVariables } : {}),
  }
  const currentCharacterId = getCurrentCharacter()?.chaId
  const lastUsed = Date.now()
  let selectedLegacyPresetId: string | null = null
  let selectedModelPresetId: string | null = null
  let selectedPromptPresetId: string | null = null

  if (personaSelection) {
    selectUserPersonaLocally(personaSelection.index, 'save')
  }

  withTrustedServerProjectionWrite(() => {
    const targetLoadout = DBState.db.loadouts.find((item) => item.id === loadout.id) ?? loadout
    targetLoadout.lastUsed = lastUsed
    if (currentCharacterId && !targetLoadout.characterIds.includes(currentCharacterId)) {
      targetLoadout.characterIds.push(currentCharacterId)
    }

    if (presetIndex >= 0) {
      ensureBotPresetCommandIds()
      saveCurrentPresetSnapshotLocal()
      const targetPreset = DBState.db.botPresets[presetIndex]
      selectedLegacyPresetId = nonBlankId(targetPreset?.id)
      DBState.db.botPresetsId = presetIndex
      if (targetPreset) {
        if (presetHasHydratedSettings(targetPreset)) {
          setPreset(DBState.db, targetPreset)
        } else {
          const targetPresetId = selectedLegacyPresetId
          void ensureBotPresetHydrated(presetIndex).then((hydrated) => {
            if (!hydrated || !targetPresetId) return
            withTrustedServerProjectionWrite(() => {
              const nextIndex = DBState.db.botPresets.findIndex((preset) => preset?.id === targetPresetId)
              if (nextIndex < 0 || DBState.db.botPresetsId !== nextIndex) return
              setPreset(DBState.db, DBState.db.botPresets[nextIndex])
            })
          })
        }
      }
    }

    if (modelPresetSelection) {
      selectedModelPresetId = modelPresetSelection.presetId
      DBState.db.modelPresetsId = modelPresetSelection.index
      applyModelPresetFieldsToDatabase(DBState.db, DBState.db.modelPresets[modelPresetSelection.index])
    }

    if (promptPresetSelection) {
      selectedPromptPresetId = promptPresetSelection.presetId
      DBState.db.promptPresetsId = promptPresetSelection.index
      applyPromptPresetFieldsToDatabase(DBState.db, DBState.db.promptPresets[promptPresetSelection.index])
    }

    if (requested.has('modules')) {
      DBState.db.enabledModules = cloneJsonValue(nextModules)
    }

    if (requested.has('globalVariables')) {
      DBState.db.globalChatVariables = cloneJsonValue(nextGlobalChatVariables)
    }

    DBState.db.lastLoadedLoadoutName = loadout.name
  })

  const factories: ServerCommandFactory[] = []
  if (personaSelection) {
    factories.push((baseRevision) =>
      selectPersonaCommand({
        baseRevision,
        personaId: personaSelection.personaId,
        mirrorLegacyProfile: true,
        saveCurrent: true,
      }),
    )
  }
  if (selectedLegacyPresetId) {
    factories.push((baseRevision) =>
      selectPresetCommand({
        baseRevision,
        presetId: selectedLegacyPresetId,
        apply: true,
        saveCurrent: true,
      }),
    )
  }
  if (selectedModelPresetId) {
    factories.push((baseRevision) =>
      selectModelPresetCommand({
        baseRevision,
        modelPresetId: selectedModelPresetId,
      }),
    )
  }
  if (selectedPromptPresetId) {
    factories.push((baseRevision) =>
      selectPromptPresetCommand({
        baseRevision,
        promptPresetId: selectedPromptPresetId,
      }),
    )
  }
  if (requested.has('modules')) {
    factories.push(...changedModuleFactories(previousModules, nextModules))
  }
  if (requested.has('globalVariables') && globalVariablesChanged) {
    const group = settingsGroupForKey('globalChatVariables')
    if (group) {
      factories.push((baseRevision) =>
        patchSettingsGroup({
          group,
          baseRevision,
          patch: {
            globalChatVariables: nextGlobalChatVariables,
          },
        }),
      )
    }
  }
  factories.push((baseRevision) =>
    touchLoadoutCommand({
      baseRevision,
      loadoutId: loadout.id,
      lastUsed,
      characterId: currentCharacterId,
    }),
  )

  runOptimisticCommandSequence(factories, () => restoreLoadoutApplyState(previous))
}

export function saveCurrentLoadout(name: string) {
  const previous = currentLoadoutStateSnapshot()
  const loadout = makeLoadout({ name })
  withTrustedServerProjectionWrite(() => {
    DBState.db.loadouts.push(loadout)
  })
  dispatchCreateLoadout(loadout, previous)
  return loadout
}
