import {
  currentPersonaStateSnapshot,
  flushPendingSelectedPersonaUpdate,
  personaMutationOptimisticAcknowledgement,
  selectUserPersonaLocally,
  type PersonaStateSnapshot,
} from './persona'
import { safeStructuredClone } from './polyfill'
import { createNonSecurityUuid } from './nonSecurityUuid'
import {
  canUseServerCommands,
  createLoadoutCommand,
  deleteLoadoutCommand,
  enableModuleCommand,
  favoriteLoadoutCommand,
  patchSettingsGroup,
  runServerCommand,
  runServerCommandSequence,
  saveChatGenerationSettingsCommand,
  selectModelPresetCommand,
  selectPromptPresetCommand,
  selectPersonaCommand,
  selectPresetCommand,
  settingsGroupForKey,
  touchLoadoutCommand,
  type LoadoutSnapshot,
  type PersonaMutationOptimisticAcknowledgement,
  type ServerCommandExecutionWrapper,
  type ServerCommandResult,
  type ServerCommandSequenceEntry,
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
import { captureDestructiveRefreshEpoch, hasDestructiveRefreshEpochChanged } from './server/staleStateGuards'
import type { ChatGenerationSettings } from './chatGenerationSettings'
import {
  applyModelPresetFieldsToDatabase,
  applyPromptPresetFieldsToDatabase,
  beginLegacyPresetSelectionIntent,
  botPresetHasHydratedSettings,
  ensureBotPresetHydratedById,
  flushPendingSplitPresetPatches,
  getCurrentCharacter,
  getDatabase,
  isLegacyPresetSelectionIntentCurrent,
  setPreset,
  splitPresetMutationKey,
  type Database,
  type ModelPreset,
  type PromptPreset,
  type botPreset,
} from './storage/database.svelte'
import {
  dispatchDurableMutation,
  executePreparedDurableMutationWithinQueue,
  type DurableMutationSettlement,
} from './server/durableMutationDispatch'
import {
  discardPendingMutation,
  isPendingMutationProjectionFenceCurrent,
  pendingMutationChatGenerationSettingsProjectionTarget,
  pendingMutationLoadoutRowProjectionTarget,
  pendingMutationModuleEnabledProjectionTarget,
  pendingMutationPersonaRowProjectionTarget,
  pendingMutationPresetRowProjectionTarget,
  pendingMutationProjectionFence,
  pendingMutationProjectionTargets,
  pendingMutationSelectionProjectionTarget,
  pendingMutationSettingsFieldProjectionTarget,
  recordPendingMutationProjectionTargets,
  stagePendingMutation,
  type DurableMutationIntent,
  type PendingMutationHandle,
  type PendingMutationPersistenceStatus,
  type PendingMutationProjectionFence,
} from './server/pendingMutationOutbox'
import { SETTINGS_BRIDGE_MUTATION_KEY } from './server/settingsMutationKey'
import { flushRegisteredPendingBridgePatch } from './server/pendingBridgeFlushRegistry'
import { flushPendingPromptTemplatePatches, promptTemplateOwnerMutationKey } from './server/promptTemplateBridge.svelte'
import {
  chatResourceOwnerMutationKey,
  loadoutOwnerMutationKey,
  moduleOwnerMutationKey,
} from './server/resourceOwnerMutationKeys'
import { PERSONA_SELECTION_MUTATION_KEY, personaOwnerMutationKey } from './server/personaMutationKeys'
import { chatGenerationSettingsMutationDependencyKeys } from './server/chatGenerationSettingsMutationKeys'

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
  const id = createNonSecurityUuid()
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

export type LoadoutApplyStatus = 'applied' | 'queued' | 'superseded' | 'preset-hydration-failed' | 'persistence-failed'

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
  attemptedRow: Loadout
  previousIndex: number
  loadoutsProjectionEpoch: number
}

interface LoadoutTouchRollback {
  loadoutId: string
  previous: Partial<Pick<Loadout, 'lastUsed' | 'characterIds'>>
  attempted: Partial<Pick<Loadout, 'lastUsed' | 'characterIds'>>
  attemptedRow?: Loadout
  previousIndex?: number
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
  attemptedModules: string[]
  settingsProjectionEpoch: number
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
  previousSelectedPersonaId: string | null
  attemptedSelectedPersonaId: string | null
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
  changedKeys: SetPresetRollbackKey[]
  retainedPrevious?: Partial<Record<SetPresetRollbackKey, unknown>>
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
  reapply?: (isTargetCurrent: (target: string) => boolean) => void
  executionWrapper?: ServerCommandExecutionWrapper
  durability?: PreparedLoadoutDurableStep
  presetProjection?: PresetSettingsRollback
}

interface PreparedLoadoutDurableStep {
  handle: PendingMutationHandle
  intent: DurableMutationIntent
  wrapperStarted: boolean
  wrapperFailed: boolean
  initialPersistence: PendingMutationPersistenceStatus | null
  settlement: DurableMutationSettlement | null
  projectionTargets: Set<string>
}

interface LoadoutModulePlan {
  moduleId: string
  enabled: boolean
  durability: PreparedLoadoutDurableStep | null
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

function recordFieldMatchesSnapshot(
  target: Record<string, unknown>,
  snapshot: Record<string, unknown>,
  key: string,
): boolean {
  const targetHasKey = Object.hasOwn(target, key)
  const snapshotHasKey = Object.hasOwn(snapshot, key)
  return targetHasKey === snapshotHasKey && (!targetHasKey || snapshotJson(target[key]) === snapshotJson(snapshot[key]))
}

function applyRetainedAttemptedFields(input: {
  target: Record<string, unknown>
  previous: Record<string, unknown>
  attempted: Record<string, unknown>
  keys?: Iterable<string>
}): void {
  const keys = input.keys ?? new Set([...Object.keys(input.previous), ...Object.keys(input.attempted)])
  for (const key of keys) {
    if (recordFieldMatchesSnapshot(input.target, input.attempted, key)) continue
    if (!recordFieldMatchesSnapshot(input.target, input.previous, key)) continue
    if (Object.hasOwn(input.attempted, key)) {
      input.target[key] = cloneJsonValue(input.attempted[key])
    } else {
      delete input.target[key]
    }
  }
}

function snapshotPresetSettings(): Partial<Record<SetPresetRollbackKey, unknown>> {
  const dbRecord = getDatabase() as unknown as Record<SetPresetRollbackKey, unknown>
  const setPresetSettings: Partial<Record<SetPresetRollbackKey, unknown>> = {}
  for (const key of SET_PRESET_ROLLBACK_KEYS) {
    setPresetSettings[key] = cloneJsonValue(dbRecord[key])
  }
  return setPresetSettings
}

function changedPresetSettingsKeys(
  previous: Partial<Record<SetPresetRollbackKey, unknown>>,
  attempted: Partial<Record<SetPresetRollbackKey, unknown>>,
): SetPresetRollbackKey[] {
  return SET_PRESET_ROLLBACK_KEYS.filter((key) => snapshotJson(previous[key]) !== snapshotJson(attempted[key]))
}

function registerPreparedLoadoutProjectionTargets(
  prepared: PreparedLoadoutDurableStep | null,
  targets: readonly string[],
): void {
  if (!prepared) return
  for (const target of targets) prepared.projectionTargets.add(target)
  recordPendingMutationProjectionTargets(prepared.handle, targets)
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

function isPendingLoadoutProjectionCurrent(handle: PendingMutationHandle, loadoutId: string): boolean {
  const fence = pendingMutationProjectionFence(handle, pendingMutationLoadoutRowProjectionTarget(loadoutId))
  return fence !== null && isPendingMutationProjectionFenceCurrent(fence)
}

function reapplyRetainedCreatedLoadout(attemptedLoadout: Loadout, attemptedIndex: number): void {
  withTrustedResourceWrite(() => {
    const list = getDatabase().loadouts ?? []
    if (list.some((candidate) => candidate.id === attemptedLoadout.id)) return
    list.splice(Math.min(Math.max(attemptedIndex, 0), list.length), 0, cloneJsonValue(attemptedLoadout))
    getDatabase().loadouts = list
  })
}

function reapplyRetainedFavoriteLoadout(rollback: LoadoutFavoriteRollback): void {
  withTrustedResourceWrite(() => {
    const list = getDatabase().loadouts ?? []
    let loadout = list.find((candidate) => candidate.id === rollback.loadoutId)
    if (!loadout) {
      const index = Math.min(Math.max(rollback.previousIndex, 0), list.length)
      list.splice(index, 0, cloneJsonValue(rollback.attemptedRow))
      getDatabase().loadouts = list
      loadout = list[index]
    }
    if (loadout) loadout.favorite = rollback.attemptedFavorite
  })
}

function reapplyRetainedDeletedLoadout(loadoutId: string): void {
  withTrustedResourceWrite(() => {
    const list = getDatabase().loadouts ?? []
    const index = list.findIndex((candidate) => candidate.id === loadoutId)
    if (index !== -1) list.splice(index, 1)
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

function reapplyLoadoutTouch(rollback: LoadoutTouchRollback, isTargetCurrent: (target: string) => boolean): void {
  withTrustedResourceWrite(() => {
    if (isTargetCurrent(pendingMutationLoadoutRowProjectionTarget(rollback.loadoutId))) {
      let loadout = getDatabase().loadouts?.find((item) => item.id === rollback.loadoutId)
      if (!loadout && rollback.attemptedRow) {
        const list = getDatabase().loadouts ?? []
        const index = Math.min(Math.max(rollback.previousIndex ?? list.length, 0), list.length)
        list.splice(index, 0, cloneJsonValue(rollback.attemptedRow))
        getDatabase().loadouts = list
        loadout = list[index]
      }
      if (loadout) {
        applyRetainedAttemptedFields({
          target: loadout as unknown as Record<string, unknown>,
          previous: rollback.previous as Record<string, unknown>,
          attempted: rollback.attempted as Record<string, unknown>,
          keys: Object.keys(rollback.attempted),
        })
      }
    }
    if (
      isTargetCurrent(pendingMutationSettingsFieldProjectionTarget('lastLoadedLoadoutName')) &&
      (getDatabase().lastLoadedLoadoutName === rollback.previousLastLoadedLoadoutName ||
        getDatabase().lastLoadedLoadoutName === rollback.attemptedLastLoadedLoadoutName)
    ) {
      getDatabase().lastLoadedLoadoutName = rollback.attemptedLastLoadedLoadoutName
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

function reapplyModuleMembership(
  rollback: LoadoutModuleMembershipRollback,
  isTargetCurrent: (target: string) => boolean,
): void {
  if (!isTargetCurrent(pendingMutationModuleEnabledProjectionTarget(rollback.moduleId))) return
  withTrustedResourceWrite(() => {
    const liveModules = Array.isArray(getDatabase().enabledModules) ? getDatabase().enabledModules : []
    if (snapshotJson(liveModules) === snapshotJson(rollback.attemptedModules)) return
    const liveEnabled = liveModules.includes(rollback.moduleId)
    if (liveEnabled !== rollback.previousEnabled && liveEnabled !== rollback.attemptedEnabled) return
    if (
      liveEnabled !== rollback.attemptedEnabled &&
      !hasSettingsGroupProjectionEpochChanged('modules', rollback.settingsProjectionEpoch)
    ) {
      return
    }

    let projected = liveModules
    if (rollback.attemptedEnabled && !liveEnabled) {
      projected = [...liveModules, rollback.moduleId]
    } else if (!rollback.attemptedEnabled && liveEnabled) {
      projected = liveModules.filter((moduleId) => moduleId !== rollback.moduleId)
    }

    const projectedIds = new Set(projected)
    const attemptedIds = new Set(rollback.attemptedModules)
    getDatabase().enabledModules =
      projectedIds.size === attemptedIds.size &&
      Array.from(projectedIds).every((moduleId) => attemptedIds.has(moduleId))
        ? cloneJsonValue(rollback.attemptedModules)
        : projected
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

function reapplyGlobalChatVariables(
  rollback: LoadoutGlobalVariablesRollback,
  isTargetCurrent: (target: string) => boolean,
): void {
  if (!isTargetCurrent(pendingMutationSettingsFieldProjectionTarget('globalChatVariables'))) return
  withTrustedResourceWrite(() => {
    applyRetainedAttemptedFields({
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
    previousSelectedPersonaId: nonBlankId(previous.personas?.[previous.selectedPersona]?.id),
    attemptedSelectedPersonaId: nonBlankId(attempted.personas?.[attempted.selectedPersona]?.id),
    previousMirror: personaMirrorSnapshot(previous),
    attemptedMirror: personaMirrorSnapshot(attempted),
  }
}

function reapplyPersonaSelection(
  rollback: LoadoutPersonaSelectionRollback,
  isTargetCurrent: (target: string) => boolean,
): void {
  withTrustedResourceWrite(() => {
    const personas = getDatabase().personas ?? []
    const currentSelectedId = nonBlankId(personas[getDatabase().selectedPersona]?.id)
    const attemptedIndex = rollback.attemptedSelectedPersonaId
      ? personas.findIndex((persona) => persona?.id === rollback.attemptedSelectedPersonaId)
      : -1

    for (const row of rollback.rows) {
      if (!isTargetCurrent(pendingMutationPersonaRowProjectionTarget(row.personaId))) continue
      const persona = personas.find((item) => item?.id === row.personaId)
      if (!persona) continue
      applyRetainedAttemptedFields({
        target: persona as unknown as Record<string, unknown>,
        previous: row.previous,
        attempted: row.attempted,
      })
    }
    for (const key of ['username', 'userIcon', 'personaPrompt', 'userNote'] as const) {
      if (!isTargetCurrent(pendingMutationSettingsFieldProjectionTarget(key))) continue
      applyRetainedAttemptedFields({
        target: getDatabase() as unknown as Record<string, unknown>,
        previous: rollback.previousMirror as Record<string, unknown>,
        attempted: rollback.attemptedMirror as Record<string, unknown>,
        keys: [key],
      })
    }
    if (
      attemptedIndex >= 0 &&
      isTargetCurrent(pendingMutationSelectionProjectionTarget('persona')) &&
      (currentSelectedId === rollback.previousSelectedPersonaId ||
        currentSelectedId === rollback.attemptedSelectedPersonaId) &&
      getDatabase().selectedPersona !== attemptedIndex
    ) {
      getDatabase().selectedPersona = attemptedIndex
    }
  })
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

function reapplyPresetFields(rollback: PresetFieldRollback | null, isTargetCurrent: (target: string) => boolean): void {
  if (!rollback) return
  if (!isTargetCurrent(pendingMutationPresetRowProjectionTarget('legacy', rollback.presetId))) return
  const preset = getDatabase().botPresets?.find((item) => item?.id === rollback.presetId)
  if (!preset) return
  applyRetainedAttemptedFields({
    target: preset as unknown as Record<string, unknown>,
    previous: rollback.previous,
    attempted: rollback.attempted,
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

function reapplyLegacyPresetSelection(
  rollback: LegacyPresetSelectionRollback,
  isTargetCurrent: (target: string) => boolean,
): void {
  withTrustedResourceWrite(() => {
    const currentSelectedId = currentBotPresetSelectedId()
    if (currentSelectedId !== rollback.previousSelectedId && currentSelectedId !== rollback.attemptedSelectedId) return
    const attemptedIndex = rollback.attemptedSelectedId
      ? (getDatabase().botPresets?.findIndex((preset) => preset?.id === rollback.attemptedSelectedId) ?? -1)
      : -1
    if (attemptedIndex < 0) return

    reapplyPresetFields(rollback.saveCurrentRollback, isTargetCurrent)
    const currentKeys = rollback.changedKeys.filter((key) =>
      isTargetCurrent(pendingMutationSettingsFieldProjectionTarget(key)),
    )
    applyRetainedAttemptedFields({
      target: getDatabase() as unknown as Record<string, unknown>,
      previous: (rollback.retainedPrevious ?? rollback.previous) as Record<string, unknown>,
      attempted: rollback.attempted as Record<string, unknown>,
      keys: currentKeys,
    })
    if (
      isTargetCurrent(pendingMutationSelectionProjectionTarget('legacyPreset')) &&
      getDatabase().botPresetsId !== attemptedIndex
    ) {
      getDatabase().botPresetsId = attemptedIndex
    }
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

function reapplySplitPresetSelection(
  rollback: SplitPresetSelectionRollback,
  isTargetCurrent: (target: string) => boolean,
): void {
  withTrustedResourceWrite(() => {
    const currentSelectedId = currentSplitPresetSelectedId(rollback.kind)
    if (currentSelectedId !== rollback.previousSelectedId && currentSelectedId !== rollback.attemptedSelectedId) return
    const attemptedIndex = rollback.attemptedSelectedId
      ? splitPresetList(rollback.kind).findIndex((preset) => preset?.id === rollback.attemptedSelectedId)
      : -1
    if (attemptedIndex < 0) return

    const currentKeys = rollback.changedKeys.filter((key) =>
      isTargetCurrent(pendingMutationSettingsFieldProjectionTarget(key)),
    )
    applyRetainedAttemptedFields({
      target: getDatabase() as unknown as Record<string, unknown>,
      previous: (rollback.retainedPrevious ?? rollback.previous) as Record<string, unknown>,
      attempted: rollback.attempted as Record<string, unknown>,
      keys: currentKeys,
    })
    if (
      isTargetCurrent(
        pendingMutationSelectionProjectionTarget(rollback.kind === 'model' ? 'modelPreset' : 'promptPreset'),
      ) &&
      currentSelectedId !== rollback.attemptedSelectedId
    ) {
      setSplitPresetSelectedIndex(rollback.kind, attemptedIndex)
    }
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

function reapplyAgentPresetSelection(
  rollback: AgentPresetSelectionRollback,
  isTargetCurrent: (target: string) => boolean,
): void {
  if (!isTargetCurrent(pendingMutationChatGenerationSettingsProjectionTarget(rollback.chatId))) return
  withTrustedResourceWrite(() => {
    const chat = findChatById(rollback.chatId, rollback.characterId)
    if (!chat) return
    const current = chat.generationSettings
    const previous = rollback.hadGenerationSettings ? rollback.previousGenerationSettings : undefined
    if (snapshotJson(current) === snapshotJson(rollback.attemptedGenerationSettings)) return
    if (
      snapshotJson(current) !== snapshotJson(previous) &&
      snapshotJson(current) !== snapshotJson(rollback.attemptedGenerationSettings)
    ) {
      return
    }
    chat.generationSettings = cloneJsonValue(rollback.attemptedGenerationSettings)
  })
}

function prepareLoadoutDurableStep(key: string, intent: DurableMutationIntent): PreparedLoadoutDurableStep | null {
  if (!canUseServerCommands()) return null
  const handle = stagePendingMutation(key, intent)
  return {
    handle,
    intent,
    wrapperStarted: false,
    wrapperFailed: false,
    initialPersistence: null,
    settlement: null,
    projectionTargets: new Set(pendingMutationProjectionTargets(intent)),
  }
}

function preparedLoadoutExecutionWrapper(prepared: PreparedLoadoutDurableStep): ServerCommandExecutionWrapper {
  return async <T extends Record<string, unknown>>(
    execute: () => Promise<ServerCommandResult<T>>,
  ): Promise<ServerCommandResult<T>> => {
    prepared.wrapperStarted = true
    try {
      const outcome = await executePreparedDurableMutationWithinQueue<T>(
        { handle: prepared.handle, intent: prepared.intent },
        execute,
      )
      prepared.handle = outcome.handle
      prepared.intent = outcome.intent
      for (const target of pendingMutationProjectionTargets(outcome.intent)) {
        prepared.projectionTargets.add(target)
      }
      recordPendingMutationProjectionTargets(prepared.handle, Array.from(prepared.projectionTargets))
      prepared.settlement = outcome.settlement
      return outcome.disposition === 'sent' ? outcome.result : { status: 'unavailable' }
    } catch (error) {
      // Once the exact row reached IndexedDB, an outbox/lock failure cannot
      // prove that it disappeared. Keep its projection for eventual replay.
      prepared.settlement = prepared.initialPersistence === 'persisted' ? 'retained' : 'unavailable'
      prepared.wrapperFailed = true
      throw error
    }
  }
}

function createLoadoutApplyStep(
  command: ServerCommandFactory,
  rollback: () => void,
  durability: PreparedLoadoutDurableStep | null = null,
  reapply?: (isTargetCurrent: (target: string) => boolean) => void,
  presetProjection?: PresetSettingsRollback,
): LoadoutApplyStep {
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
    reapply,
    presetProjection,
    ...(durability
      ? {
          executionWrapper: preparedLoadoutExecutionWrapper(durability),
          durability,
        }
      : {}),
  }
  return step
}

async function awaitPreparedLoadoutDurability(steps: readonly LoadoutApplyStep[]): Promise<void> {
  await Promise.all(
    steps.map(async (step) => {
      const durability = step.durability
      if (!durability || durability.initialPersistence !== null) return
      durability.initialPersistence = await durability.handle.ready
    }),
  )
}

function retainsDurableLoadoutProjection(durability: PreparedLoadoutDurableStep): boolean {
  if (durability.initialPersistence !== 'persisted') return false
  return (
    durability.settlement === null || durability.settlement === 'retained' || durability.settlement === 'unavailable'
  )
}

function failedLoadoutApplyStep(steps: readonly LoadoutApplyStep[]): LoadoutApplyStep | undefined {
  return steps.find(
    (step) =>
      step.durability?.wrapperFailed === true ||
      (!step.succeeded && (step.durability === undefined || step.durability.wrapperStarted)),
  )
}

function rebaseRetainedPresetProjection(
  retained: PresetSettingsRollback,
  discardedPredecessors: readonly PresetSettingsRollback[],
): void {
  const rebased = cloneJsonValue(retained.previous)
  for (const discarded of discardedPredecessors) {
    for (const key of SET_PRESET_ROLLBACK_KEYS) {
      if (snapshotJson(rebased[key]) !== snapshotJson(discarded.attempted[key])) continue
      if (Object.hasOwn(discarded.previous, key)) rebased[key] = cloneJsonValue(discarded.previous[key])
      else delete rebased[key]
    }
  }
  retained.retainedPrevious = rebased
}

async function settleFailedLoadoutApplySteps(
  steps: readonly LoadoutApplyStep[],
  rollbackIsCurrent: () => boolean,
): Promise<void> {
  const failedStep = failedLoadoutApplyStep(steps)
  const retainPersistedTail =
    failedStep?.durability !== undefined && retainsDurableLoadoutProjection(failedStep.durability)

  if (!retainPersistedTail) {
    const skippedDurableSteps = steps.filter(
      (step): step is LoadoutApplyStep & { durability: PreparedLoadoutDurableStep } =>
        !step.succeeded && step.durability !== undefined && !step.durability.wrapperStarted,
    )
    const discardResults = await Promise.all(
      skippedDurableSteps.map(async (step) => ({
        durability: step.durability,
        result: await discardPendingMutation(step.durability.handle),
      })),
    )
    for (const { durability, result } of discardResults) {
      durability.settlement =
        result === 'deleted' ? 'discarded' : result === 'superseded' ? 'superseded' : 'unavailable'
    }
  }

  // IndexedDB cleanup above can yield long enough for a destructive resource
  // refresh to replace the projection. Never apply this older reverse patch
  // after that authoritative refresh wins.
  if (!rollbackIsCurrent()) return

  // Preset projections overlap. Roll them back only after every skipped row's
  // deletion is known, and always in reverse projection order.
  const rolledBackPresetSteps: Array<{ index: number; projection: PresetSettingsRollback }> = []
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (step.succeeded) continue
    if (step.durability && retainsDurableLoadoutProjection(step.durability)) continue
    step.rollback()
    if (step.presetProjection) rolledBackPresetSteps.push({ index, projection: step.presetProjection })
  }

  if (rolledBackPresetSteps.length > 0) {
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index]
      if (!step?.presetProjection || !step.durability || !retainsDurableLoadoutProjection(step.durability)) continue
      const discardedPredecessors = rolledBackPresetSteps
        .filter((candidate) => candidate.index < index)
        .sort((left, right) => right.index - left.index)
        .map((candidate) => candidate.projection)
      if (discardedPredecessors.length > 0) {
        rebaseRetainedPresetProjection(step.presetProjection, discardedPredecessors)
      }
    }
  }
}

function reapplyRetainedLoadoutApplySteps(steps: readonly LoadoutApplyStep[]): void {
  const expectedFences = new Map<string, PendingMutationProjectionFence>()
  for (const step of steps) {
    const durability = step.durability
    if (!durability) continue
    for (const target of durability.projectionTargets) {
      const fence = pendingMutationProjectionFence(durability.handle, target)
      if (!fence) continue
      const previous = expectedFences.get(target)
      if (!previous || previous.ordinal < fence.ordinal) expectedFences.set(target, fence)
    }
  }
  const isTargetCurrent = (target: string): boolean => {
    const fence = expectedFences.get(target)
    return fence ? isPendingMutationProjectionFenceCurrent(fence) : false
  }

  for (const step of steps) {
    if (step.succeeded && step.durability?.wrapperFailed !== true) continue
    if (!step.durability || !retainsDurableLoadoutProjection(step.durability)) continue
    step.reapply?.(isTargetCurrent)
  }
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
): Promise<{ result: ServerCommandResult; projectionOwned: boolean } | null> {
  if (!canUseServerCommands()) return Promise.resolve(null)
  const attemptedLoadout = cloneJsonValue(loadout)
  const attemptedIndex = Math.max(
    0,
    getDatabase().loadouts.findIndex((candidate) => candidate.id === attemptedLoadout.id),
  )
  const intent: DurableMutationIntent = {
    version: 1,
    requests: [{ method: 'POST', path: '/loadouts', body: { loadout: toLoadoutSnapshot(attemptedLoadout) } }],
  }
  const handle = stagePendingMutation(loadoutOwnerMutationKey(loadout.id), intent)
  return dispatchDurableMutation(handle, intent, (transport) =>
    runServerCommand({
      command: (baseRevision) =>
        createLoadoutCommand(
          {
            baseRevision,
            loadout: toLoadoutSnapshot(attemptedLoadout),
            acknowledgeOptimistic,
            loadoutsProjectionEpoch,
          },
          transport.signal,
        ),
      rollback: () => rollbackCreatedLoadout(attemptedLoadout, loadoutsProjectionEpoch),
      ...transport,
    }),
  ).then((result) => {
    if (result.status !== 'ok' && isPendingLoadoutProjectionCurrent(handle, loadout.id)) {
      reapplyRetainedCreatedLoadout(attemptedLoadout, attemptedIndex)
    }
    return {
      result,
      projectionOwned:
        pendingMutationProjectionFence(handle, pendingMutationLoadoutRowProjectionTarget(loadout.id)) !== null,
    }
  })
}

function dispatchDeleteLoadout(
  loadoutId: string,
  previousLoadout: Loadout,
  previousIndex: number,
  acknowledgeOptimistic: boolean,
  loadoutsProjectionEpoch: number,
): void {
  if (!canUseServerCommands()) return
  const intent: DurableMutationIntent = {
    version: 1,
    requests: [{ method: 'DELETE', path: `/loadouts/${encodeURIComponent(loadoutId)}`, body: {} }],
  }
  const handle = stagePendingMutation(loadoutOwnerMutationKey(loadoutId), intent)
  void dispatchDurableMutation(handle, intent, (transport) =>
    runServerCommand({
      command: (baseRevision) =>
        deleteLoadoutCommand(
          {
            baseRevision,
            loadoutId,
            acknowledgeOptimistic,
            loadoutsProjectionEpoch,
          },
          transport.signal,
        ),
      rollback: () => rollbackDeletedLoadout(previousLoadout, previousIndex, loadoutsProjectionEpoch),
      ...transport,
    }),
  ).then((result) => {
    if (result.status !== 'ok' && isPendingLoadoutProjectionCurrent(handle, loadoutId)) {
      reapplyRetainedDeletedLoadout(loadoutId)
    }
  })
}

function dispatchFavoriteLoadout(rollback: LoadoutFavoriteRollback): void {
  if (!canUseServerCommands()) return
  const intent: DurableMutationIntent = {
    version: 1,
    requests: [
      {
        method: 'POST',
        path: `/loadouts/${encodeURIComponent(rollback.loadoutId)}/favorite`,
        body: { favorite: rollback.attemptedFavorite },
      },
    ],
  }
  const handle = stagePendingMutation(loadoutOwnerMutationKey(rollback.loadoutId), intent)
  void dispatchDurableMutation(handle, intent, (transport) =>
    runServerCommand({
      command: (baseRevision) =>
        favoriteLoadoutCommand(
          {
            baseRevision,
            loadoutId: rollback.loadoutId,
            favorite: rollback.attemptedFavorite,
            acknowledgeOptimistic: true,
            loadoutsProjectionEpoch: rollback.loadoutsProjectionEpoch,
          },
          transport.signal,
        ),
      rollback: () => rollbackLoadoutFavorite(rollback),
      ...transport,
    }),
  ).then((result) => {
    if (result.status !== 'ok' && isPendingLoadoutProjectionCurrent(handle, rollback.loadoutId)) {
      reapplyRetainedFavoriteLoadout(rollback)
    }
  })
}

export function toggleLoadoutFavorite(loadoutId: string): boolean {
  const previousIndex = getDatabase().loadouts?.findIndex((item) => item.id === loadoutId) ?? -1
  const loadout = previousIndex === -1 ? undefined : getDatabase().loadouts[previousIndex]
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
    attemptedRow: cloneJsonValue(getDatabase().loadouts[previousIndex]),
    previousIndex,
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
    const currentId = nonBlankId(preset.id) ?? createNonSecurityUuid()
    const nextId = seen.has(currentId) ? createNonSecurityUuid() : currentId
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

function changedModulePlans(previousModules: string[], nextModules: string[]): LoadoutModulePlan[] {
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
  ].map(({ moduleId, enabled }) => ({
    moduleId,
    enabled,
    durability: prepareLoadoutDurableStep(moduleOwnerMutationKey(moduleId), {
      version: 1,
      requests: [
        {
          method: 'POST',
          path: '/modules/enable',
          body: { moduleId, enabled },
        },
      ],
    }),
  }))
}

function changedModuleSteps(
  previousModules: string[],
  attemptedModules: string[],
  settingsProjectionEpoch: number,
  plans: readonly LoadoutModulePlan[],
): LoadoutApplyStep[] {
  const previousSet = new Set(previousModules)
  return plans.map(({ moduleId, enabled, durability }) => {
    const rollback: LoadoutModuleMembershipRollback = {
      moduleId,
      previousEnabled: previousSet.has(moduleId),
      attemptedEnabled: enabled,
      previousModules,
      attemptedModules,
      settingsProjectionEpoch,
    }
    return createLoadoutApplyStep(
      (baseRevision) =>
        enableModuleCommand({
          baseRevision,
          moduleId,
          enabled,
        }),
      () => rollbackModuleMembership(rollback),
      durability,
      (isTargetCurrent) => reapplyModuleMembership(rollback, isTargetCurrent),
    )
  })
}

let loadoutApplyIntent = 0
let loadoutApplyTail: Promise<void> | null = null

function runSerializedLoadoutApply<T>(task: () => Promise<T>): Promise<T> {
  const predecessor = loadoutApplyTail
  let release!: () => void
  const reservation = new Promise<void>((resolve) => {
    release = resolve
  })
  loadoutApplyTail = reservation

  const run = (): Promise<T> => {
    let result: Promise<T>
    try {
      // Start an uncontended apply in this task so its optimistic projection
      // remains synchronous for callers. Only followers wait for the previous
      // apply's complete projection/command/rollback lifecycle.
      result = task()
    } catch (error) {
      result = Promise.reject(error)
    }

    const finish = () => {
      release()
      if (loadoutApplyTail === reservation) loadoutApplyTail = null
    }
    return result.then(
      (value) => {
        finish()
        return value
      },
      (error) => {
        finish()
        throw error
      },
    )
  }

  return predecessor ? predecessor.then(run, run) : run()
}

export async function applyLoadout(
  loadout: Loadout,
  apply: LoadoutApplyOption[] = ['modules', 'globalVariables', 'preset', 'persona'],
): Promise<LoadoutApplyStatus> {
  const intent = ++loadoutApplyIntent
  const requested = new Set(apply)
  const activeChatAgentPresetTarget = requested.has('preset') ? currentActiveChatRecord() : null
  const currentCharacterId = getCurrentCharacter()?.chaId
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
  if (legacyPreset && !legacyPresetId) return 'preset-hydration-failed'
  if (legacyPresetId && !presetHasHydratedSettings(legacyPreset)) {
    const hydrated = await ensureBotPresetHydratedById(legacyPresetId)
    if (!hydrated) return 'preset-hydration-failed'
    if (
      intent !== loadoutApplyIntent ||
      legacySelectionIntent === null ||
      !isLegacyPresetSelectionIntentCurrent(legacySelectionIntent)
    ) {
      return 'superseded'
    }
    const status = await applyLoadoutNow(
      loadout,
      apply,
      legacyPresetId,
      intent,
      legacySelectionIntent,
      activeChatAgentPresetTarget,
      currentCharacterId,
    )
    return status
  }
  const status = await applyLoadoutNow(
    loadout,
    apply,
    legacyPresetId,
    intent,
    legacySelectionIntent,
    activeChatAgentPresetTarget,
    currentCharacterId,
  )
  return status
}

async function applyLoadoutNow(
  loadout: Loadout,
  apply: LoadoutApplyOption[],
  legacyPresetId: string | null,
  intent: number,
  legacySelectionIntent: number | null,
  activeChatAgentPresetTarget: ReturnType<typeof currentActiveChatRecord>,
  currentCharacterId: string | undefined,
): Promise<LoadoutApplyStatus> {
  return runSerializedLoadoutApply(() =>
    applyLoadoutNowExclusive(
      loadout,
      apply,
      legacyPresetId,
      intent,
      legacySelectionIntent,
      activeChatAgentPresetTarget,
      currentCharacterId,
    ),
  )
}

async function applyLoadoutNowExclusive(
  loadout: Loadout,
  apply: LoadoutApplyOption[],
  legacyPresetId: string | null,
  intent: number,
  legacySelectionIntent: number | null,
  activeChatAgentPresetTarget: ReturnType<typeof currentActiveChatRecord>,
  currentCharacterId: string | undefined,
): Promise<LoadoutApplyStatus> {
  if (intent !== loadoutApplyIntent) return 'superseded'
  if (legacySelectionIntent !== null && !isLegacyPresetSelectionIntentCurrent(legacySelectionIntent))
    return 'superseded'
  const requested = new Set(apply)
  const personaSelection = requested.has('persona') ? resolvePersonaSelection(loadout.personaId) : null
  const useSplitPresetSelection = requested.has('preset') && loadoutHasSplitPresetReference(loadout)
  const modelPresetSelection = useSplitPresetSelection
    ? resolveSplitPresetSelection(getDatabase().modelPresets, loadout.modelPresetId, loadout.modelPresetName)
    : null
  const promptPresetSelection = useSplitPresetSelection
    ? resolveSplitPresetSelection(getDatabase().promptPresets, loadout.promptPresetId, loadout.promptPresetName)
    : null
  const resolvedAgentPresetId = requested.has('preset') ? resolveLoadoutAgentPresetId(loadout) : undefined
  const presetIndex =
    requested.has('preset') && !useSplitPresetSelection
      ? (getDatabase().botPresets?.findIndex((preset) =>
          legacyPresetId ? preset.id === legacyPresetId : preset.name === loadout.presetName,
        ) ?? -1)
      : -1
  if (legacyPresetId && (presetIndex < 0 || !presetHasHydratedSettings(getDatabase().botPresets[presetIndex]))) {
    return 'superseded'
  }
  const previousModules = cloneJsonValue(getDatabase().enabledModules ?? [])
  const nextModules = cloneJsonValue(loadout.modules ?? [])
  const previousGlobalChatVariables = cloneJsonValue(getDatabase().globalChatVariables ?? {})
  const nextGlobalChatVariables = cloneJsonValue(loadout.globalVariables ?? {})
  const globalVariablesChanged = snapshotJson(previousGlobalChatVariables) !== snapshotJson(nextGlobalChatVariables)
  const resolvedLegacyPresetId =
    presetIndex >= 0 && presetHasHydratedSettings(getDatabase().botPresets[presetIndex])
      ? nonBlankId(getDatabase().botPresets[presetIndex]?.id)
      : null
  const previousPersona = personaSelection ? currentPersonaStateSnapshot() : null
  const previousPersonaId = previousPersona
    ? nonBlankId(previousPersona.personas?.[previousPersona.selectedPersona]?.id)
    : null
  const previousModelPresetId = modelPresetSelection
    ? nonBlankId(getDatabase().modelPresets?.[getDatabase().modelPresetsId]?.id)
    : null
  const previousPromptPresetId = promptPresetSelection
    ? nonBlankId(getDatabase().promptPresets?.[getDatabase().promptPresetsId]?.id)
    : null
  const preparedAgentGenerationSettings =
    activeChatAgentPresetTarget && resolvedAgentPresetId !== undefined
      ? createGenerationSettingsWithAgentPreset(
          activeChatAgentPresetTarget.chat.generationSettings,
          resolvedAgentPresetId,
        )
      : null
  const agentPresetChanged =
    !!activeChatAgentPresetTarget &&
    !!preparedAgentGenerationSettings &&
    snapshotJson(activeChatAgentPresetTarget.chat.generationSettings) !== snapshotJson(preparedAgentGenerationSettings)

  // Flush projection-owned timers while their outgoing owner is still live,
  // then reserve every exact structural correction before optimistic state
  // changes can make a later apply appear to be a no-op.
  if (personaSelection) void flushPendingSelectedPersonaUpdate()
  if (promptPresetSelection) flushPendingPromptTemplatePatches()
  if (modelPresetSelection || promptPresetSelection) flushPendingSplitPresetPatches()
  if (
    resolvedLegacyPresetId ||
    modelPresetSelection ||
    promptPresetSelection ||
    (requested.has('globalVariables') && globalVariablesChanged)
  ) {
    flushRegisteredPendingBridgePatch('settings', {})
  }

  const personaDurability = personaSelection
    ? prepareLoadoutDurableStep(PERSONA_SELECTION_MUTATION_KEY, {
        version: 1,
        dependencyKeys: Array.from(
          new Set(
            [previousPersonaId, personaSelection.personaId]
              .filter((personaId): personaId is string => personaId !== null)
              .map(personaOwnerMutationKey),
          ),
        ),
        requests: [
          {
            method: 'POST',
            path: '/personas/select',
            body: {
              personaId: personaSelection.personaId,
              mirrorLegacyProfile: true,
              saveCurrent: true,
            },
          },
        ],
      })
    : null
  const legacyPresetDurability = resolvedLegacyPresetId
    ? prepareLoadoutDurableStep(SETTINGS_BRIDGE_MUTATION_KEY, {
        version: 1,
        requests: [
          {
            method: 'POST',
            path: '/presets/select',
            body: { presetId: resolvedLegacyPresetId, apply: true, saveCurrent: true },
          },
        ],
      })
    : null
  const modelPresetDurability = modelPresetSelection
    ? prepareLoadoutDurableStep(SETTINGS_BRIDGE_MUTATION_KEY, {
        version: 1,
        dependencyKeys: Array.from(
          new Set(
            [previousModelPresetId, modelPresetSelection.presetId]
              .filter((presetId): presetId is string => presetId !== null)
              .map((presetId) => splitPresetMutationKey('model', presetId)),
          ),
        ),
        requests: [
          {
            method: 'POST',
            path: '/model-presets/select',
            body: { modelPresetId: modelPresetSelection.presetId },
          },
        ],
      })
    : null
  const promptPresetDurability = promptPresetSelection
    ? prepareLoadoutDurableStep(SETTINGS_BRIDGE_MUTATION_KEY, {
        version: 1,
        dependencyKeys: Array.from(
          new Set(
            [previousPromptPresetId, promptPresetSelection.presetId]
              .filter((presetId): presetId is string => presetId !== null)
              .map(promptTemplateOwnerMutationKey),
          ),
        ),
        requests: [
          {
            method: 'POST',
            path: '/prompt-presets/select',
            body: { promptPresetId: promptPresetSelection.presetId },
          },
        ],
      })
    : null
  const agentPresetDurability =
    activeChatAgentPresetTarget && agentPresetChanged && preparedAgentGenerationSettings
      ? prepareLoadoutDurableStep(
          chatResourceOwnerMutationKey(activeChatAgentPresetTarget.chatId, activeChatAgentPresetTarget.characterId),
          {
            version: 1,
            dependencyKeys: chatGenerationSettingsMutationDependencyKeys(preparedAgentGenerationSettings),
            requests: [
              {
                method: 'PUT',
                path: `/chats/${encodeURIComponent(activeChatAgentPresetTarget.chatId)}/generation-settings`,
                body: { generationSettings: cloneJsonValue(preparedAgentGenerationSettings) },
              },
            ],
          },
        )
      : null
  const modulePlans = requested.has('modules') ? changedModulePlans(previousModules, nextModules) : []
  const globalVariablesDurability =
    requested.has('globalVariables') && globalVariablesChanged
      ? prepareLoadoutDurableStep(SETTINGS_BRIDGE_MUTATION_KEY, {
          version: 1,
          requests: [
            {
              method: 'PATCH',
              path: '/settings/sidebar',
              body: { patch: { globalChatVariables: cloneJsonValue(nextGlobalChatVariables) } },
            },
          ],
        })
      : null
  const lastUsed = Date.now()
  const previousLoadoutIndex = getDatabase().loadouts?.findIndex((item) => item.id === loadout.id) ?? -1
  const previousLoadout = previousLoadoutIndex === -1 ? undefined : getDatabase().loadouts[previousLoadoutIndex]
  const shouldAddCurrentCharacter =
    !!currentCharacterId && !(previousLoadout?.characterIds ?? loadout.characterIds ?? []).includes(currentCharacterId)
  const touchCharacterId = shouldAddCurrentCharacter ? currentCharacterId : undefined
  const touchDurability = prepareLoadoutDurableStep(loadoutOwnerMutationKey(loadout.id), {
    version: 1,
    dependencyKeys: [SETTINGS_BRIDGE_MUTATION_KEY],
    requests: [
      {
        method: 'POST',
        path: `/loadouts/${encodeURIComponent(loadout.id)}/touch`,
        body: {
          lastUsed,
          ...(touchCharacterId ? { characterId: touchCharacterId } : {}),
        },
      },
    ],
  })
  const loadoutsProjectionEpoch = captureCollectionProjectionEpoch('loadouts')
  const modulesProjectionEpoch = captureSettingsGroupProjectionEpoch('modules')
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

  if (personaSelection && previousPersona) {
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
    if (touchCharacterId && !targetLoadout.characterIds.includes(touchCharacterId)) {
      targetLoadout.characterIds.push(touchCharacterId)
    }
    if (previousLoadout) {
      touchRollback.attempted = {
        lastUsed: targetLoadout.lastUsed,
        characterIds: cloneJsonValue(targetLoadout.characterIds ?? []),
      }
      touchRollback.attemptedRow = cloneJsonValue(targetLoadout)
      touchRollback.previousIndex = previousLoadoutIndex
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
        const attemptedSettings = snapshotPresetSettings()
        legacyPresetRollback = {
          previousSelectedId,
          attemptedSelectedId: currentBotPresetSelectedId(),
          previous: previousSettings,
          attempted: attemptedSettings,
          changedKeys: changedPresetSettingsKeys(previousSettings, attemptedSettings),
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
      const attemptedSettings = snapshotPresetSettings()
      modelPresetRollback = {
        kind: 'model',
        previousSelectedId,
        attemptedSelectedId: currentSplitPresetSelectedId('model'),
        previous: previousSettings,
        attempted: attemptedSettings,
        changedKeys: changedPresetSettingsKeys(previousSettings, attemptedSettings),
      }
    }

    if (promptPresetSelection) {
      const previousSelectedId = currentSplitPresetSelectedId('prompt')
      const previousSettings = snapshotPresetSettings()
      selectedPromptPresetId = promptPresetSelection.presetId
      getDatabase().promptPresetsId = promptPresetSelection.index
      applyPromptPresetFieldsToDatabase(getDatabase(), getDatabase().promptPresets[promptPresetSelection.index])
      const attemptedSettings = snapshotPresetSettings()
      promptPresetRollback = {
        kind: 'prompt',
        previousSelectedId,
        attemptedSelectedId: currentSplitPresetSelectedId('prompt'),
        previous: previousSettings,
        attempted: attemptedSettings,
        changedKeys: changedPresetSettingsKeys(previousSettings, attemptedSettings),
      }
    }

    if (activeChatAgentPresetTarget && resolvedAgentPresetId !== undefined) {
      const targetChat = findChatById(activeChatAgentPresetTarget.chatId, activeChatAgentPresetTarget.characterId)
      if (targetChat) {
        const hadGenerationSettings = Object.hasOwn(targetChat, 'generationSettings')
        const previousGenerationSettings = cloneJsonValue(targetChat.generationSettings)
        const nextGenerationSettings = preparedAgentGenerationSettings
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

  if (personaRollback) {
    registerPreparedLoadoutProjectionTargets(personaDurability, [
      ...personaRollback.rows.map((row) => pendingMutationPersonaRowProjectionTarget(row.personaId)),
      ...(['username', 'userIcon', 'personaPrompt', 'userNote'] as const)
        .filter(
          (key) =>
            snapshotJson(personaRollback.previousMirror[key]) !== snapshotJson(personaRollback.attemptedMirror[key]),
        )
        .map(pendingMutationSettingsFieldProjectionTarget),
    ])
  }
  if (legacyPresetRollback) {
    registerPreparedLoadoutProjectionTargets(legacyPresetDurability, [
      ...legacyPresetRollback.changedKeys.map(pendingMutationSettingsFieldProjectionTarget),
      ...(legacyPresetRollback.saveCurrentRollback
        ? [pendingMutationPresetRowProjectionTarget('legacy', legacyPresetRollback.saveCurrentRollback.presetId)]
        : []),
    ])
  }
  if (modelPresetRollback) {
    registerPreparedLoadoutProjectionTargets(
      modelPresetDurability,
      modelPresetRollback.changedKeys.map(pendingMutationSettingsFieldProjectionTarget),
    )
  }
  if (promptPresetRollback) {
    registerPreparedLoadoutProjectionTargets(
      promptPresetDurability,
      promptPresetRollback.changedKeys.map(pendingMutationSettingsFieldProjectionTarget),
    )
  }

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
        personaDurability,
        (isTargetCurrent) => reapplyPersonaSelection(personaRollback, isTargetCurrent),
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
        legacyPresetDurability,
        (isTargetCurrent) => reapplyLegacyPresetSelection(legacyPresetRollback, isTargetCurrent),
        legacyPresetRollback,
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
        modelPresetDurability,
        (isTargetCurrent) => reapplySplitPresetSelection(modelPresetRollback, isTargetCurrent),
        modelPresetRollback,
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
        promptPresetDurability,
        (isTargetCurrent) => reapplySplitPresetSelection(promptPresetRollback, isTargetCurrent),
        promptPresetRollback,
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
        agentPresetDurability,
        (isTargetCurrent) => reapplyAgentPresetSelection(rollback, isTargetCurrent),
      ),
    )
  }
  if (requested.has('modules')) {
    steps.push(...changedModuleSteps(previousModules, nextModules, modulesProjectionEpoch, modulePlans))
  }
  if (requested.has('globalVariables') && globalVariablesChanged) {
    const group = settingsGroupForKey('globalChatVariables')
    if (group) {
      const rollback: LoadoutGlobalVariablesRollback = {
        previous: previousGlobalChatVariables,
        attempted: nextGlobalChatVariables,
      }
      steps.push(
        createLoadoutApplyStep(
          (baseRevision) =>
            patchSettingsGroup({
              group,
              baseRevision,
              patch: {
                globalChatVariables: nextGlobalChatVariables,
              },
              acknowledgeOptimistic: true,
              optimisticProjectionEpoch: settingsProjectionEpoch,
            }),
          () => rollbackGlobalChatVariables(rollback),
          globalVariablesDurability,
          (isTargetCurrent) => reapplyGlobalChatVariables(rollback, isTargetCurrent),
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
          characterId: touchCharacterId,
          acknowledgeOptimistic: touchedLiveLoadoutName !== null,
          loadoutsProjectionEpoch,
          settingsProjectionEpoch,
          loadedName: touchedLiveLoadoutName ?? undefined,
        }),
      () => rollbackLoadoutTouch(touchRollback),
      touchDurability,
      (isTargetCurrent) => reapplyLoadoutTouch(touchRollback, isTargetCurrent),
    ),
  )

  // Reserve the global command queue synchronously with the optimistic
  // projection. The first queued step waits for every prepared row, so a
  // later user action can neither overtake this sequence nor make its first
  // request start before the retained tail is durable.
  const rollbackEpoch = captureDestructiveRefreshEpoch()
  const durabilityReady = awaitPreparedLoadoutDurability(steps)
  const sequenceEntries: ServerCommandSequenceEntry[] = steps.map((step, index) => {
    if (index !== 0) {
      return step.executionWrapper ? { command: step.command, executionWrapper: step.executionWrapper } : step.command
    }
    return {
      command: step.command,
      executionWrapper: async (execute) => {
        await durabilityReady
        return step.executionWrapper ? step.executionWrapper(execute) : execute()
      },
    }
  })
  const failure = await runServerCommandSequence(sequenceEntries, (rollbackIsCurrent) =>
    settleFailedLoadoutApplySteps(steps, rollbackIsCurrent),
  )
  if (failure !== null && !hasDestructiveRefreshEpochChanged(rollbackEpoch)) {
    reapplyRetainedLoadoutApplySteps(steps)
  }
  if (failure === null) return 'applied'
  return steps.some((step) => !step.succeeded && step.durability && retainsDurableLoadoutProjection(step.durability))
    ? 'queued'
    : 'persistence-failed'
}

export async function saveCurrentLoadout(name: string): Promise<Loadout | null> {
  const loadout = makeLoadout({ name })
  const acknowledgeOptimistic = isCanonicalLoadoutCollection(getDatabase().loadouts) && isCanonicalLoadout(loadout)
  const loadoutsProjectionEpoch = captureCollectionProjectionEpoch('loadouts')
  withTrustedResourceWrite(() => {
    getDatabase().loadouts.push(loadout)
  })
  const result = await dispatchCreateLoadout(loadout, acknowledgeOptimistic, loadoutsProjectionEpoch)
  return result === null || result.result.status === 'ok' || result.projectionOwned ? loadout : null
}
