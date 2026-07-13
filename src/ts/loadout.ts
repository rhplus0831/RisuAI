import { runOptimisticCommandSequence } from './chatCommands'
import {
  currentPersonaStateSnapshot,
  personaMutationOptimisticAcknowledgement,
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
  saveChatGenerationSettingsCommand,
  selectModelPresetCommand,
  selectPromptPresetCommand,
  selectPersonaCommand,
  selectPresetCommand,
  settingsGroupForKey,
  touchLoadoutCommand,
  type LoadoutSnapshot,
  type PersonaMutationOptimisticAcknowledgement,
  type ServerCommandResult,
} from './server/commands'
import { isCanonicalLoadout, isCanonicalLoadoutCollection } from './server/loadoutCanonical'
import { withTrustedResourceWrite } from './server/resourceWriteGuard.svelte'
import {
  captureCollectionProjectionEpoch,
  captureSettingsGroupProjectionEpoch,
  hasCollectionProjectionEpochChanged,
  hasSettingsGroupProjectionEpochChanged,
} from './server/resourceState.svelte'
import { applyAttemptedFieldRollback, applyAttemptedKeyedListRollback } from './server/staleStateGuards'
import type { ChatGenerationSettings } from './chatGenerationSettings'
import {
  applyModelPresetFieldsToDatabase,
  applyPromptPresetFieldsToDatabase,
  beginLegacyPresetSelectionIntent,
  botPresetHasHydratedSettings,
  ensureBotPresetHydratedById,
  getCurrentCharacter,
  getDatabase,
  isLegacyPresetSelectionIntentCurrent,
  setPreset,
  type Database,
  type ModelPreset,
  type PromptPreset,
  type botPreset,
} from './storage/database.svelte'

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
  agentPresetId?: string
  agentPresetName?: string
  personaId: string
}

export function makeLoadout(options: { name: string }): Loadout {
  const character = getCurrentCharacter()
  const id = crypto.randomUUID()
  const legacyPreset = getDatabase().botPresets?.[getDatabase().botPresetsId]
  const modelPreset = getDatabase().modelPresets?.[getDatabase().modelPresetsId]
  const promptPreset = getDatabase().promptPresets?.[getDatabase().promptPresetsId]
  const agentPreset = currentChatAgentPreset()
  const legacyPresetName = readablePresetName(legacyPreset)
  const modelPresetName = readablePresetName(modelPreset)
  const promptPresetName = readablePresetName(promptPreset)
  const agentPresetName = readablePresetName(agentPreset)
  const selectedPersonaId = getDatabase().personas[getDatabase().selectedPersona]?.id
  return safeStructuredClone({
    name: options.name.trim() ? options.name : 'New Loadout',
    id: id,
    lastUsed: Date.now(),
    favorite: false,
    characterIds: character ? [character.chaId] : [],
    modules: getDatabase().enabledModules,
    globalVariables: getDatabase().globalChatVariables,
    presetName: legacyPresetName || [modelPresetName, promptPresetName].filter(Boolean).join(' / '),
    modelPresetId: nonBlankId(modelPreset?.id) ?? '',
    modelPresetName,
    promptPresetId: nonBlankId(promptPreset?.id) ?? '',
    promptPresetName,
    agentPresetId: nonBlankId(agentPreset?.id) ?? '',
    agentPresetName,
    personaId: typeof selectedPersonaId === 'string' ? selectedPersonaId : '',
  })
}

type LoadoutApplyOption = 'modules' | 'globalVariables' | 'preset' | 'persona'

type ServerCommandFactory = (baseRevision: number) => Promise<ServerCommandResult>

interface LoadoutListRollbackEntry {
  key: string
  previous: Loadout | null
  attempted: Loadout | null
  previousIndex?: number
}

interface LoadoutFavoriteRollback {
  loadoutId: string
  previousFavorite: boolean
  attemptedFavorite: boolean
  loadoutsProjectionEpoch: number
}

interface LoadoutTouchRollback {
  loadoutId: string
  previous: Partial<Pick<Loadout, 'lastUsed' | 'characterIds'>>
  attempted: Partial<Pick<Loadout, 'lastUsed' | 'characterIds'>>
  previousLastLoadedLoadoutName: string
  attemptedLastLoadedLoadoutName: string
  loadoutsProjectionEpoch: number
  settingsProjectionEpoch: number
}

interface LoadoutModuleMembershipRollback {
  moduleId: string
  previousEnabled: boolean
  attemptedEnabled: boolean
  previousModules: string[]
}

interface LoadoutGlobalVariablesRollback {
  previous: { [key: string]: string }
  attempted: { [key: string]: string }
}

interface LoadoutPersonaRowRollback {
  personaId: string
  previous: Record<string, unknown>
  attempted: Record<string, unknown>
}

interface LoadoutPersonaSelectionRollback {
  rows: LoadoutPersonaRowRollback[]
  previousMirror: Pick<PersonaStateSnapshot, 'selectedPersona' | 'username' | 'userIcon' | 'personaPrompt' | 'userNote'>
  attemptedMirror: Pick<
    PersonaStateSnapshot,
    'selectedPersona' | 'username' | 'userIcon' | 'personaPrompt' | 'userNote'
  >
}

interface PresetFieldRollback {
  presetId: string
  previous: Record<string, unknown>
  attempted: Record<string, unknown>
}

interface PresetSettingsRollback {
  previous: Partial<Record<SetPresetRollbackKey, unknown>>
  attempted: Partial<Record<SetPresetRollbackKey, unknown>>
}

interface LegacyPresetSelectionRollback extends PresetSettingsRollback {
  previousSelectedId: string | null
  attemptedSelectedId: string | null
  saveCurrentRollback: PresetFieldRollback | null
}

type SplitPresetKind = 'model' | 'prompt'

interface SplitPresetSelectionRollback extends PresetSettingsRollback {
  kind: SplitPresetKind
  previousSelectedId: string | null
  attemptedSelectedId: string | null
}

interface AgentPresetSelectionRollback {
  characterId: string | undefined
  chatId: string
  hadGenerationSettings: boolean
  previousGenerationSettings?: ChatGenerationSettings
  attemptedGenerationSettings: ChatGenerationSettings
}

interface LoadoutApplyStep {
  succeeded: boolean
  command: ServerCommandFactory
  rollback: () => void
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
  'modelRoles',
  'modelProfiles',
  'modelRoleProfiles',
  'modelRuntimeDefaults',
  'agentPresets',
  'agentPresetDefaultId',
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
  ['modelRoles', 'modelRoles'],
  ['modelProfiles', 'modelProfiles'],
  ['modelRoleProfiles', 'modelRoleProfiles'],
  ['modelRuntimeDefaults', 'modelRuntimeDefaults'],
  ['agentPresets', 'agentPresets'],
  ['agentPresetDefaultId', 'agentPresetDefaultId'],
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

function snapshotPresetSettings(): Partial<Record<SetPresetRollbackKey, unknown>> {
  const dbRecord = getDatabase() as unknown as Record<SetPresetRollbackKey, unknown>
  const setPresetSettings: Partial<Record<SetPresetRollbackKey, unknown>> = {}
  for (const key of SET_PRESET_ROLLBACK_KEYS) {
    setPresetSettings[key] = cloneJsonValue(dbRecord[key])
  }
  return setPresetSettings
}

function rollbackLoadoutListEntry(entry: LoadoutListRollbackEntry): void {
  withTrustedResourceWrite(() => {
    const list = getDatabase().loadouts ?? []
    const rolledBack = applyAttemptedKeyedListRollback<Loadout, string>({
      list,
      entries: [entry],
      getKey: (loadout) => loadout?.id,
    })
    if (rolledBack.length > 0) {
      getDatabase().loadouts = list
    }
  })
}

function rollbackCreatedLoadout(attemptedLoadout: Loadout, loadoutsProjectionEpoch: number): void {
  if (hasCollectionProjectionEpochChanged('loadouts', loadoutsProjectionEpoch)) return
  rollbackLoadoutListEntry({
    key: attemptedLoadout.id,
    previous: null,
    attempted: cloneJsonValue(attemptedLoadout),
  })
}

function rollbackDeletedLoadout(
  previousLoadout: Loadout,
  previousIndex: number,
  loadoutsProjectionEpoch: number,
): void {
  if (hasCollectionProjectionEpochChanged('loadouts', loadoutsProjectionEpoch)) return
  rollbackLoadoutListEntry({
    key: previousLoadout.id,
    previous: cloneJsonValue(previousLoadout),
    attempted: null,
    previousIndex,
  })
}

function rollbackLoadoutFavorite(rollback: LoadoutFavoriteRollback): void {
  if (hasCollectionProjectionEpochChanged('loadouts', rollback.loadoutsProjectionEpoch)) return
  withTrustedResourceWrite(() => {
    const loadout = getDatabase().loadouts?.find((item) => item.id === rollback.loadoutId)
    if (!loadout) return
    applyAttemptedFieldRollback({
      target: loadout as unknown as Record<string, unknown>,
      previous: { favorite: rollback.previousFavorite },
      attempted: { favorite: rollback.attemptedFavorite },
      keys: ['favorite'],
    })
  })
}

function rollbackLoadoutTouch(rollback: LoadoutTouchRollback): void {
  const rollbackCollection = !hasCollectionProjectionEpochChanged('loadouts', rollback.loadoutsProjectionEpoch)
  const rollbackSettings = !hasSettingsGroupProjectionEpochChanged('sidebar', rollback.settingsProjectionEpoch)
  if (!rollbackCollection && !rollbackSettings) return
  withTrustedResourceWrite(() => {
    const loadout = rollbackCollection
      ? getDatabase().loadouts?.find((item) => item.id === rollback.loadoutId)
      : undefined
    if (loadout && rollbackCollection) {
      applyAttemptedFieldRollback({
        target: loadout as unknown as Record<string, unknown>,
        previous: rollback.previous as Record<string, unknown>,
        attempted: rollback.attempted as Record<string, unknown>,
        keys: Object.keys(rollback.attempted),
      })
    }

    if (
      rollbackSettings &&
      snapshotJson(getDatabase().lastLoadedLoadoutName) === snapshotJson(rollback.attemptedLastLoadedLoadoutName)
    ) {
      getDatabase().lastLoadedLoadoutName = rollback.previousLastLoadedLoadoutName
    }
  })
}

function insertModuleAtPreviousPosition(liveModules: string[], moduleId: string, previousModules: string[]): void {
  const previousIndex = previousModules.indexOf(moduleId)
  if (previousIndex === -1) {
    liveModules.push(moduleId)
    return
  }

  for (let index = previousIndex - 1; index >= 0; index -= 1) {
    const liveIndex = liveModules.indexOf(previousModules[index])
    if (liveIndex !== -1) {
      liveModules.splice(liveIndex + 1, 0, moduleId)
      return
    }
  }

  for (let index = previousIndex + 1; index < previousModules.length; index += 1) {
    const liveIndex = liveModules.indexOf(previousModules[index])
    if (liveIndex !== -1) {
      liveModules.splice(liveIndex, 0, moduleId)
      return
    }
  }

  liveModules.splice(Math.max(0, Math.min(previousIndex, liveModules.length)), 0, moduleId)
}

function rollbackModuleMembership(rollback: LoadoutModuleMembershipRollback): void {
  withTrustedResourceWrite(() => {
    const liveModules = Array.isArray(getDatabase().enabledModules) ? getDatabase().enabledModules : []
    const liveEnabled = liveModules.includes(rollback.moduleId)
    if (liveEnabled !== rollback.attemptedEnabled) return

    if (!rollback.previousEnabled) {
      getDatabase().enabledModules = liveModules.filter((moduleId) => moduleId !== rollback.moduleId)
      return
    }

    if (!liveEnabled) {
      insertModuleAtPreviousPosition(liveModules, rollback.moduleId, rollback.previousModules)
      getDatabase().enabledModules = liveModules
    }
  })
}

function rollbackGlobalChatVariables(rollback: LoadoutGlobalVariablesRollback): void {
  withTrustedResourceWrite(() => {
    applyAttemptedFieldRollback({
      target: getDatabase() as unknown as Record<string, unknown>,
      previous: { globalChatVariables: rollback.previous },
      attempted: { globalChatVariables: rollback.attempted },
      keys: ['globalChatVariables'],
    })
  })
}

function personaMirrorSnapshot(
  snapshot: PersonaStateSnapshot,
): Pick<PersonaStateSnapshot, 'selectedPersona' | 'username' | 'userIcon' | 'personaPrompt' | 'userNote'> {
  return {
    selectedPersona: snapshot.selectedPersona,
    username: snapshot.username,
    userIcon: snapshot.userIcon,
    personaPrompt: snapshot.personaPrompt,
    userNote: snapshot.userNote,
  }
}

function keyedPersonaRows(snapshot: PersonaStateSnapshot): Map<string, Record<string, unknown>> {
  const rows = new Map<string, Record<string, unknown>>()
  for (const persona of snapshot.personas ?? []) {
    const id = nonBlankId(persona?.id)
    if (id) {
      rows.set(id, persona as unknown as Record<string, unknown>)
    }
  }
  return rows
}

function personaSelectionRollback(
  previous: PersonaStateSnapshot,
  attempted: PersonaStateSnapshot,
): LoadoutPersonaSelectionRollback {
  const previousRows = keyedPersonaRows(previous)
  const rows: LoadoutPersonaRowRollback[] = []
  for (const [personaId, attemptedRow] of keyedPersonaRows(attempted)) {
    const previousRow = previousRows.get(personaId)
    if (!previousRow || snapshotJson(previousRow) === snapshotJson(attemptedRow)) continue
    rows.push({
      personaId,
      previous: cloneJsonValue(previousRow),
      attempted: cloneJsonValue(attemptedRow),
    })
  }

  return {
    rows,
    previousMirror: personaMirrorSnapshot(previous),
    attemptedMirror: personaMirrorSnapshot(attempted),
  }
}

function rollbackPersonaSelection(rollback: LoadoutPersonaSelectionRollback): void {
  withTrustedResourceWrite(() => {
    for (const row of rollback.rows) {
      const persona = getDatabase().personas?.find((item) => item?.id === row.personaId)
      if (!persona) continue
      applyAttemptedFieldRollback({
        target: persona as unknown as Record<string, unknown>,
        previous: row.previous,
        attempted: row.attempted,
        deleteMissingPrevious: true,
      })
    }

    applyAttemptedFieldRollback({
      target: getDatabase() as unknown as Record<string, unknown>,
      previous: rollback.previousMirror as Record<string, unknown>,
      attempted: rollback.attemptedMirror as Record<string, unknown>,
      keys: Object.keys(rollback.attemptedMirror),
    })
  })
}

function currentBotPresetSelectedId(): string | null {
  const index = getDatabase().botPresetsId
  if (!Number.isInteger(index) || index < 0 || !Array.isArray(getDatabase().botPresets)) return null
  return getDatabase().botPresets[index]?.id ?? null
}

function restoreBotPresetSelectionToId(presetId: string | null): void {
  const list = getDatabase().botPresets ?? []
  const index = presetId ? list.findIndex((preset) => preset?.id === presetId) : -1
  getDatabase().botPresetsId = index >= 0 ? index : normalizedBotPresetsId(list.length, -1)
}

function splitPresetList(kind: SplitPresetKind): Array<ModelPreset | PromptPreset> {
  return (kind === 'model' ? getDatabase().modelPresets : getDatabase().promptPresets) ?? []
}

function currentSplitPresetSelectedId(kind: SplitPresetKind): string | null {
  const list = splitPresetList(kind)
  const index = kind === 'model' ? getDatabase().modelPresetsId : getDatabase().promptPresetsId
  if (!Number.isInteger(index) || index < 0) return null
  return list[index]?.id ?? null
}

function setSplitPresetSelectedIndex(kind: SplitPresetKind, index: number): void {
  if (kind === 'model') {
    getDatabase().modelPresetsId = index
  } else {
    getDatabase().promptPresetsId = index
  }
}

function restoreSplitPresetSelectionToId(kind: SplitPresetKind, presetId: string | null): void {
  const list = splitPresetList(kind)
  const index = presetId ? list.findIndex((preset) => preset?.id === presetId) : -1
  setSplitPresetSelectedIndex(kind, index >= 0 ? index : normalizedBotPresetsId(list.length, -1))
}

function presetFieldRollbackFromPatch(
  presetId: string,
  previousPreset: Record<string, unknown>,
  attemptedPreset: Record<string, unknown>,
): PresetFieldRollback {
  const previous: Record<string, unknown> = {}
  const attempted = cloneJsonValue(attemptedPreset)
  const keys = new Set([...Object.keys(previousPreset), ...Object.keys(attempted)])

  for (const key of keys) {
    if (Object.hasOwn(previousPreset, key)) {
      previous[key] = cloneJsonValue(previousPreset[key])
    }
    if (!Object.hasOwn(attempted, key)) {
      attempted[key] = undefined
    }
  }

  return {
    presetId,
    previous,
    attempted,
  }
}

function rollbackPresetFields(rollback: PresetFieldRollback | null): void {
  if (!rollback) return
  withTrustedResourceWrite(() => {
    const preset = getDatabase().botPresets?.find((item) => item?.id === rollback.presetId)
    if (!preset) return
    applyAttemptedFieldRollback({
      target: preset as unknown as Record<string, unknown>,
      previous: rollback.previous,
      attempted: rollback.attempted,
      deleteMissingPrevious: true,
    })
  })
}

function rollbackPresetSettings(rollback: PresetSettingsRollback): void {
  applyAttemptedFieldRollback({
    target: getDatabase() as unknown as Record<string, unknown>,
    previous: rollback.previous as Record<string, unknown>,
    attempted: rollback.attempted as Record<string, unknown>,
    keys: SET_PRESET_ROLLBACK_KEYS,
  })
}

function rollbackLegacyPresetSelection(rollback: LegacyPresetSelectionRollback): void {
  withTrustedResourceWrite(() => {
    rollbackPresetFields(rollback.saveCurrentRollback)
    if (!rollback.attemptedSelectedId || currentBotPresetSelectedId() !== rollback.attemptedSelectedId) return
    rollbackPresetSettings(rollback)
    restoreBotPresetSelectionToId(rollback.previousSelectedId)
  })
}

function rollbackSplitPresetSelection(rollback: SplitPresetSelectionRollback): void {
  withTrustedResourceWrite(() => {
    if (!rollback.attemptedSelectedId || currentSplitPresetSelectedId(rollback.kind) !== rollback.attemptedSelectedId) {
      return
    }
    rollbackPresetSettings(rollback)
    restoreSplitPresetSelectionToId(rollback.kind, rollback.previousSelectedId)
  })
}

function rollbackAgentPresetSelection(rollback: AgentPresetSelectionRollback): void {
  withTrustedResourceWrite(() => {
    const chat = findChatById(rollback.chatId, rollback.characterId)
    if (!chat) return
    const target = chat as { generationSettings?: ChatGenerationSettings }
    const current = target.generationSettings
    if (snapshotJson(current) !== snapshotJson(rollback.attemptedGenerationSettings)) return
    if (rollback.hadGenerationSettings) {
      target.generationSettings = cloneJsonValue(rollback.previousGenerationSettings)
    } else {
      delete target.generationSettings
    }
  })
}

function createLoadoutApplyStep(command: ServerCommandFactory, rollback: () => void): LoadoutApplyStep {
  const step: LoadoutApplyStep = {
    succeeded: false,
    command: async (baseRevision) => {
      const result = await command(baseRevision)
      if (result.status === 'ok') {
        step.succeeded = true
      }
      return result
    },
    rollback,
  }
  return step
}

function rollbackUnacceptedLoadoutApplySteps(steps: LoadoutApplyStep[]): void {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (!step.succeeded) {
      step.rollback()
    }
  }
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

function dispatchCreateLoadout(
  loadout: Loadout,
  acknowledgeOptimistic: boolean,
  loadoutsProjectionEpoch: number,
): void {
  const attemptedLoadout = cloneJsonValue(loadout)
  runLoadoutCommand(
    (baseRevision) =>
      createLoadoutCommand({
        baseRevision,
        loadout: toLoadoutSnapshot(attemptedLoadout),
        acknowledgeOptimistic,
        loadoutsProjectionEpoch,
      }),
    () => rollbackCreatedLoadout(attemptedLoadout, loadoutsProjectionEpoch),
  )
}

function dispatchDeleteLoadout(
  loadoutId: string,
  previousLoadout: Loadout,
  previousIndex: number,
  acknowledgeOptimistic: boolean,
  loadoutsProjectionEpoch: number,
): void {
  runLoadoutCommand(
    (baseRevision) =>
      deleteLoadoutCommand({
        baseRevision,
        loadoutId,
        acknowledgeOptimistic,
        loadoutsProjectionEpoch,
      }),
    () => rollbackDeletedLoadout(previousLoadout, previousIndex, loadoutsProjectionEpoch),
  )
}

function dispatchFavoriteLoadout(rollback: LoadoutFavoriteRollback): void {
  runLoadoutCommand(
    (baseRevision) =>
      favoriteLoadoutCommand({
        baseRevision,
        loadoutId: rollback.loadoutId,
        favorite: rollback.attemptedFavorite,
        acknowledgeOptimistic: true,
        loadoutsProjectionEpoch: rollback.loadoutsProjectionEpoch,
      }),
    () => rollbackLoadoutFavorite(rollback),
  )
}

export function toggleLoadoutFavorite(loadoutId: string): boolean {
  const loadout = getDatabase().loadouts?.find((item) => item.id === loadoutId)
  if (!loadout) return false

  const previousFavorite = loadout.favorite
  const favorite = !loadout.favorite
  const loadoutsProjectionEpoch = captureCollectionProjectionEpoch('loadouts')
  withTrustedResourceWrite(() => {
    const targetLoadout = getDatabase().loadouts.find((item) => item.id === loadoutId)
    if (!targetLoadout) return
    targetLoadout.favorite = favorite
  })
  dispatchFavoriteLoadout({
    loadoutId,
    previousFavorite,
    attemptedFavorite: favorite,
    loadoutsProjectionEpoch,
  })
  return true
}

export function deleteLoadout(loadoutId: string): boolean {
  const index = getDatabase().loadouts?.findIndex((loadout) => loadout.id === loadoutId) ?? -1
  if (index === -1) return false

  const acknowledgeOptimistic = isCanonicalLoadoutCollection(getDatabase().loadouts)
  const loadoutsProjectionEpoch = captureCollectionProjectionEpoch('loadouts')
  const previousLoadout = cloneJsonValue(getDatabase().loadouts[index])
  withTrustedResourceWrite(() => {
    const targetIndex = getDatabase().loadouts.findIndex((loadout) => loadout.id === loadoutId)
    if (targetIndex !== -1) {
      getDatabase().loadouts.splice(targetIndex, 1)
    }
  })
  dispatchDeleteLoadout(loadoutId, previousLoadout, index, acknowledgeOptimistic, loadoutsProjectionEpoch)
  return true
}

function nonBlankId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function findChatById(
  chatId: string,
  preferredCharacterId?: string,
): { id?: string; generationSettings?: ChatGenerationSettings } | null {
  const characters = Array.isArray(getDatabase().characters) ? getDatabase().characters : []
  const orderedCharacters = preferredCharacterId
    ? [
        ...characters.filter((character) => character?.chaId === preferredCharacterId),
        ...characters.filter((character) => character?.chaId !== preferredCharacterId),
      ]
    : characters
  for (const character of orderedCharacters) {
    const chats = Array.isArray(character?.chats) ? character.chats : []
    const chat = chats.find((candidate) => candidate?.id === chatId)
    if (chat) return chat as unknown as { id?: string; generationSettings?: ChatGenerationSettings }
  }
  return null
}

function currentActiveChatRecord(): {
  characterId: string | undefined
  chatId: string
  chat: { id?: string; generationSettings?: ChatGenerationSettings }
} | null {
  const character = getCurrentCharacter()
  const chatIndex = Number.isInteger(character?.chatPage) ? (character.chatPage as number) : -1
  const chat = chatIndex >= 0 && Array.isArray(character?.chats) ? character.chats[chatIndex] : undefined
  const chatId = nonBlankId(chat?.id)
  if (!chat || !chatId) return null
  return {
    characterId: typeof character?.chaId === 'string' ? character.chaId : undefined,
    chatId,
    chat: chat as unknown as { id?: string; generationSettings?: ChatGenerationSettings },
  }
}

function currentChatAgentPreset(): { id?: string; name?: string } | undefined {
  const agentPresetId = nonBlankId(currentActiveChatRecord()?.chat.generationSettings?.agentPresetId)
  if (!agentPresetId) return undefined
  return getDatabase().agentPresets?.find((preset) => preset.id === agentPresetId)
}

function loadoutHasAgentPresetReference(loadout: Loadout): boolean {
  return Object.hasOwn(loadout, 'agentPresetId') || Object.hasOwn(loadout, 'agentPresetName')
}

function resolveLoadoutAgentPresetId(loadout: Loadout): string | undefined {
  if (!loadoutHasAgentPresetReference(loadout)) return undefined

  const requestedId = nonBlankId(loadout.agentPresetId)
  if (requestedId && getDatabase().agentPresets?.some((preset) => preset.id === requestedId)) {
    return requestedId
  }

  const requestedName =
    typeof loadout.agentPresetName === 'string' && loadout.agentPresetName.trim().length > 0
      ? loadout.agentPresetName
      : null
  if (requestedName) {
    const preset = getDatabase().agentPresets?.find((candidate) => candidate.name === requestedName)
    const presetId = nonBlankId(preset?.id)
    if (presetId) return presetId
    return undefined
  }

  return requestedId ? undefined : ''
}

function createGenerationSettingsWithAgentPreset(
  current: ChatGenerationSettings | undefined,
  agentPresetId: string,
): ChatGenerationSettings | null {
  if (!current && agentPresetId === '') return null
  const next = cloneJsonValue(current ?? {})
  next.agentPresetId = agentPresetId
  if (!Object.hasOwn(next, 'jailbreakToggle')) {
    next.jailbreakToggle = false
  }
  return next
}

function resolvePersonaSelection(personaId: string): { index: number; personaId: string } | null {
  const personas = getDatabase().personas ?? []
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
  const presets = getDatabase().botPresets
  if (!Array.isArray(presets)) {
    getDatabase().botPresets = []
    getDatabase().botPresetsId = -1
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

  getDatabase().botPresetsId = normalizedBotPresetsId(presets.length, getDatabase().botPresetsId)
}

function normalizedBotPresetsId(presetCount: number, selected: unknown): number {
  if (!Number.isInteger(selected)) return presetCount > 0 ? 0 : -1

  const index = selected as number
  if (index >= presetCount) return presetCount > 0 ? presetCount - 1 : -1
  if (index < -1) return presetCount > 0 ? 0 : -1
  return index
}

function saveCurrentPresetSnapshotLocal(): PresetFieldRollback | null {
  const db = getDatabase()
  const index = db.botPresetsId
  const presets = db.botPresets
  if (!Array.isArray(presets) || index < 0 || index >= presets.length) return null

  const current = presets[index]
  const previousPreset = cloneJsonValue(current) as unknown as Record<string, unknown>
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
  const presetId = nonBlankId(snapshot.id)
  return presetId ? presetFieldRollbackFromPatch(presetId, previousPreset, snapshot) : null
}

function presetHasHydratedSettings(preset: botPreset | undefined): preset is botPreset {
  return botPresetHasHydratedSettings(preset)
}

function changedModuleSteps(previousModules: string[], nextModules: string[]): LoadoutApplyStep[] {
  const previousSet = new Set(previousModules)
  const nextSet = new Set(nextModules)
  const enabled = Array.from(nextSet)
    .filter((moduleId) => !previousSet.has(moduleId))
    .sort()
  const disabled = Array.from(previousSet)
    .filter((moduleId) => !nextSet.has(moduleId))
    .sort()

  return [
    ...enabled.map((moduleId) => ({ moduleId, enabled: true })),
    ...disabled.map((moduleId) => ({ moduleId, enabled: false })),
  ].map(({ moduleId, enabled }) =>
    createLoadoutApplyStep(
      (baseRevision) =>
        enableModuleCommand({
          baseRevision,
          moduleId,
          enabled,
        }),
      () =>
        rollbackModuleMembership({
          moduleId,
          previousEnabled: previousSet.has(moduleId),
          attemptedEnabled: enabled,
          previousModules,
        }),
    ),
  )
}

let loadoutApplyIntent = 0

export function applyLoadout(
  loadout: Loadout,
  apply: LoadoutApplyOption[] = ['modules', 'globalVariables', 'preset', 'persona'],
): void {
  const intent = ++loadoutApplyIntent
  const requested = new Set(apply)
  const legacySelectionIntent = requested.has('preset') ? beginLegacyPresetSelectionIntent() : null
  const useSplitPresetSelection = requested.has('preset') && loadoutHasSplitPresetReference(loadout)
  const legacyPreset =
    requested.has('preset') && !useSplitPresetSelection
      ? withTrustedResourceWrite(() => {
          ensureBotPresetCommandIds()
          return getDatabase().botPresets?.find((preset) => preset.name === loadout.presetName)
        })
      : undefined
  const legacyPresetId = nonBlankId(legacyPreset?.id)
  if (legacyPreset && !legacyPresetId) return
  if (legacyPresetId && !presetHasHydratedSettings(legacyPreset)) {
    void ensureBotPresetHydratedById(legacyPresetId).then((hydrated) => {
      if (
        hydrated &&
        intent === loadoutApplyIntent &&
        legacySelectionIntent !== null &&
        isLegacyPresetSelectionIntentCurrent(legacySelectionIntent)
      ) {
        applyLoadoutNow(loadout, apply, legacyPresetId, intent, legacySelectionIntent)
      }
    })
    return
  }
  applyLoadoutNow(loadout, apply, legacyPresetId, intent, legacySelectionIntent)
}

function applyLoadoutNow(
  loadout: Loadout,
  apply: LoadoutApplyOption[],
  legacyPresetId: string | null,
  intent: number,
  legacySelectionIntent: number | null,
): void {
  if (intent !== loadoutApplyIntent) return
  if (legacySelectionIntent !== null && !isLegacyPresetSelectionIntentCurrent(legacySelectionIntent)) return
  const requested = new Set(apply)
  const personaSelection = requested.has('persona') ? resolvePersonaSelection(loadout.personaId) : null
  const useSplitPresetSelection = requested.has('preset') && loadoutHasSplitPresetReference(loadout)
  const modelPresetSelection = useSplitPresetSelection
    ? resolveSplitPresetSelection(getDatabase().modelPresets, loadout.modelPresetId, loadout.modelPresetName)
    : null
  const promptPresetSelection = useSplitPresetSelection
    ? resolveSplitPresetSelection(getDatabase().promptPresets, loadout.promptPresetId, loadout.promptPresetName)
    : null
  const activeChatAgentPresetTarget = requested.has('preset') ? currentActiveChatRecord() : null
  const resolvedAgentPresetId = requested.has('preset') ? resolveLoadoutAgentPresetId(loadout) : undefined
  const presetIndex =
    requested.has('preset') && !useSplitPresetSelection
      ? (getDatabase().botPresets?.findIndex((preset) =>
          legacyPresetId ? preset.id === legacyPresetId : preset.name === loadout.presetName,
        ) ?? -1)
      : -1
  if (legacyPresetId && (presetIndex < 0 || !presetHasHydratedSettings(getDatabase().botPresets[presetIndex]))) {
    return
  }
  const previousModules = cloneJsonValue(getDatabase().enabledModules ?? [])
  const nextModules = cloneJsonValue(loadout.modules ?? [])
  const previousGlobalChatVariables = cloneJsonValue(getDatabase().globalChatVariables ?? {})
  const nextGlobalChatVariables = cloneJsonValue(loadout.globalVariables ?? {})
  const globalVariablesChanged = snapshotJson(previousGlobalChatVariables) !== snapshotJson(nextGlobalChatVariables)
  const currentCharacterId = getCurrentCharacter()?.chaId
  const lastUsed = Date.now()
  const previousLoadout = getDatabase().loadouts?.find((item) => item.id === loadout.id)
  const loadoutsProjectionEpoch = captureCollectionProjectionEpoch('loadouts')
  const settingsProjectionEpoch = captureSettingsGroupProjectionEpoch('sidebar')
  const touchRollback: LoadoutTouchRollback = {
    loadoutId: loadout.id,
    previous: previousLoadout
      ? {
          lastUsed: previousLoadout.lastUsed,
          characterIds: cloneJsonValue(previousLoadout.characterIds ?? []),
        }
      : {},
    attempted: {},
    previousLastLoadedLoadoutName: getDatabase().lastLoadedLoadoutName,
    attemptedLastLoadedLoadoutName: previousLoadout?.name ?? loadout.name,
    loadoutsProjectionEpoch,
    settingsProjectionEpoch,
  }
  let addedCurrentCharacter = false
  let touchedLiveLoadoutName: string | null = null
  let selectedLegacyPresetId: string | null = null
  let selectedModelPresetId: string | null = null
  let selectedPromptPresetId: string | null = null
  let personaRollback: LoadoutPersonaSelectionRollback | null = null
  let personaOptimisticAcknowledgement: PersonaMutationOptimisticAcknowledgement | undefined
  let legacyPresetRollback: LegacyPresetSelectionRollback | null = null
  let modelPresetRollback: SplitPresetSelectionRollback | null = null
  let promptPresetRollback: SplitPresetSelectionRollback | null = null
  let agentPresetRollback: AgentPresetSelectionRollback | null = null

  if (personaSelection) {
    const previousPersona = currentPersonaStateSnapshot()
    selectUserPersonaLocally(personaSelection.index, 'save')
    const attemptedPersona = currentPersonaStateSnapshot()
    personaRollback = personaSelectionRollback(previousPersona, attemptedPersona)
    personaOptimisticAcknowledgement = personaMutationOptimisticAcknowledgement({
      operation: 'select',
      previous: previousPersona,
      attempted: attemptedPersona,
      mirrorLegacyProfile: true,
      saveCurrent: true,
    })
  }

  withTrustedResourceWrite(() => {
    const liveTargetLoadout = getDatabase().loadouts.find((item) => item.id === loadout.id)
    const targetLoadout = liveTargetLoadout ?? loadout
    targetLoadout.lastUsed = lastUsed
    if (currentCharacterId && !targetLoadout.characterIds.includes(currentCharacterId)) {
      targetLoadout.characterIds.push(currentCharacterId)
      addedCurrentCharacter = true
    }
    if (previousLoadout) {
      touchRollback.attempted = {
        lastUsed: targetLoadout.lastUsed,
        characterIds: cloneJsonValue(targetLoadout.characterIds ?? []),
      }
    }
    if (liveTargetLoadout && nonBlankId(liveTargetLoadout.name)) {
      touchedLiveLoadoutName = liveTargetLoadout.name
      touchRollback.attemptedLastLoadedLoadoutName = liveTargetLoadout.name
    }

    if (presetIndex >= 0) {
      ensureBotPresetCommandIds()
      const resolvedPresetIndex = legacyPresetId
        ? getDatabase().botPresets.findIndex((preset) => preset?.id === legacyPresetId)
        : presetIndex
      const targetPreset = resolvedPresetIndex >= 0 ? getDatabase().botPresets[resolvedPresetIndex] : undefined
      if (presetHasHydratedSettings(targetPreset)) {
        const previousSettings = snapshotPresetSettings()
        const previousSelectedId = currentBotPresetSelectedId()
        const saveCurrentRollback = saveCurrentPresetSnapshotLocal()
        selectedLegacyPresetId = nonBlankId(targetPreset.id)
        getDatabase().botPresetsId = resolvedPresetIndex
        setPreset(getDatabase(), targetPreset)
        legacyPresetRollback = {
          previousSelectedId,
          attemptedSelectedId: currentBotPresetSelectedId(),
          previous: previousSettings,
          attempted: snapshotPresetSettings(),
          saveCurrentRollback,
        }
      }
    }

    if (modelPresetSelection) {
      const previousSelectedId = currentSplitPresetSelectedId('model')
      const previousSettings = snapshotPresetSettings()
      selectedModelPresetId = modelPresetSelection.presetId
      getDatabase().modelPresetsId = modelPresetSelection.index
      applyModelPresetFieldsToDatabase(getDatabase(), getDatabase().modelPresets[modelPresetSelection.index])
      modelPresetRollback = {
        kind: 'model',
        previousSelectedId,
        attemptedSelectedId: currentSplitPresetSelectedId('model'),
        previous: previousSettings,
        attempted: snapshotPresetSettings(),
      }
    }

    if (promptPresetSelection) {
      const previousSelectedId = currentSplitPresetSelectedId('prompt')
      const previousSettings = snapshotPresetSettings()
      selectedPromptPresetId = promptPresetSelection.presetId
      getDatabase().promptPresetsId = promptPresetSelection.index
      applyPromptPresetFieldsToDatabase(getDatabase(), getDatabase().promptPresets[promptPresetSelection.index])
      promptPresetRollback = {
        kind: 'prompt',
        previousSelectedId,
        attemptedSelectedId: currentSplitPresetSelectedId('prompt'),
        previous: previousSettings,
        attempted: snapshotPresetSettings(),
      }
    }

    if (activeChatAgentPresetTarget && resolvedAgentPresetId !== undefined) {
      const targetChat = findChatById(activeChatAgentPresetTarget.chatId, activeChatAgentPresetTarget.characterId)
      if (targetChat) {
        const hadGenerationSettings = Object.hasOwn(targetChat, 'generationSettings')
        const previousGenerationSettings = cloneJsonValue(targetChat.generationSettings)
        const nextGenerationSettings = createGenerationSettingsWithAgentPreset(
          targetChat.generationSettings,
          resolvedAgentPresetId,
        )
        if (
          nextGenerationSettings &&
          snapshotJson(previousGenerationSettings) !== snapshotJson(nextGenerationSettings)
        ) {
          targetChat.generationSettings = cloneJsonValue(nextGenerationSettings)
          agentPresetRollback = {
            characterId: activeChatAgentPresetTarget.characterId,
            chatId: activeChatAgentPresetTarget.chatId,
            hadGenerationSettings,
            previousGenerationSettings,
            attemptedGenerationSettings: cloneJsonValue(nextGenerationSettings),
          }
        }
      }
    }

    if (requested.has('modules')) {
      getDatabase().enabledModules = cloneJsonValue(nextModules)
    }

    if (requested.has('globalVariables')) {
      getDatabase().globalChatVariables = cloneJsonValue(nextGlobalChatVariables)
    }

    getDatabase().lastLoadedLoadoutName = touchedLiveLoadoutName ?? loadout.name
  })

  const steps: LoadoutApplyStep[] = []
  if (personaSelection && personaRollback) {
    steps.push(
      createLoadoutApplyStep(
        (baseRevision) =>
          selectPersonaCommand({
            baseRevision,
            personaId: personaSelection.personaId,
            mirrorLegacyProfile: true,
            saveCurrent: true,
            optimisticAcknowledgement: personaOptimisticAcknowledgement,
          }),
        () => rollbackPersonaSelection(personaRollback),
      ),
    )
  }
  if (selectedLegacyPresetId && legacyPresetRollback) {
    steps.push(
      createLoadoutApplyStep(
        (baseRevision) =>
          selectPresetCommand({
            baseRevision,
            presetId: selectedLegacyPresetId,
            apply: true,
            saveCurrent: true,
          }),
        () => rollbackLegacyPresetSelection(legacyPresetRollback),
      ),
    )
  }
  if (selectedModelPresetId && modelPresetRollback) {
    steps.push(
      createLoadoutApplyStep(
        (baseRevision) =>
          selectModelPresetCommand({
            baseRevision,
            modelPresetId: selectedModelPresetId,
          }),
        () => rollbackSplitPresetSelection(modelPresetRollback),
      ),
    )
  }
  if (selectedPromptPresetId && promptPresetRollback) {
    steps.push(
      createLoadoutApplyStep(
        (baseRevision) =>
          selectPromptPresetCommand({
            baseRevision,
            promptPresetId: selectedPromptPresetId,
          }),
        () => rollbackSplitPresetSelection(promptPresetRollback),
      ),
    )
  }
  if (agentPresetRollback) {
    const rollback = agentPresetRollback
    steps.push(
      createLoadoutApplyStep(
        (baseRevision) =>
          saveChatGenerationSettingsCommand({
            baseRevision,
            chatId: rollback.chatId,
            generationSettings: rollback.attemptedGenerationSettings,
          }),
        () => rollbackAgentPresetSelection(rollback),
      ),
    )
  }
  if (requested.has('modules')) {
    steps.push(...changedModuleSteps(previousModules, nextModules))
  }
  if (requested.has('globalVariables') && globalVariablesChanged) {
    const group = settingsGroupForKey('globalChatVariables')
    if (group) {
      steps.push(
        createLoadoutApplyStep(
          (baseRevision) =>
            patchSettingsGroup({
              group,
              baseRevision,
              patch: {
                globalChatVariables: nextGlobalChatVariables,
              },
            }),
          () =>
            rollbackGlobalChatVariables({
              previous: previousGlobalChatVariables,
              attempted: nextGlobalChatVariables,
            }),
        ),
      )
    }
  }
  steps.push(
    createLoadoutApplyStep(
      (baseRevision) =>
        touchLoadoutCommand({
          baseRevision,
          loadoutId: loadout.id,
          lastUsed,
          characterId: addedCurrentCharacter ? currentCharacterId : undefined,
          acknowledgeOptimistic: touchedLiveLoadoutName !== null,
          loadoutsProjectionEpoch,
          settingsProjectionEpoch,
          loadedName: touchedLiveLoadoutName ?? undefined,
        }),
      () => rollbackLoadoutTouch(touchRollback),
    ),
  )

  runOptimisticCommandSequence(
    steps.map((step) => step.command),
    () => rollbackUnacceptedLoadoutApplySteps(steps),
  )
}

export function saveCurrentLoadout(name: string) {
  const loadout = makeLoadout({ name })
  const acknowledgeOptimistic = isCanonicalLoadoutCollection(getDatabase().loadouts) && isCanonicalLoadout(loadout)
  const loadoutsProjectionEpoch = captureCollectionProjectionEpoch('loadouts')
  withTrustedResourceWrite(() => {
    getDatabase().loadouts.push(loadout)
  })
  dispatchCreateLoadout(loadout, acknowledgeOptimistic, loadoutsProjectionEpoch)
  return loadout
}
